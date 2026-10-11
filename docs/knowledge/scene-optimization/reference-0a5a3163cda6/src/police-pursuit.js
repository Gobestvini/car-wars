import { findRoadRoute, laneTarget, nearestRoadNode } from './traffic-ai.js';
import { driveControl, sweptPathIsSafe } from './traffic-planner.js';
import { TRAFFIC_SPAWN } from './traffic-spawn.js';
import { getPoliceIntensity } from './police-intensity.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distanceBetween = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

// Permit retreat from existing contact only while the overlap gets shallower.
function overlapDepth(a, b, padding = 0.3) {
  const extent = (item, x, z) => {
    const heading = item.heading || 0;
    return (item.halfLength ?? item.halfZ ?? TRAFFIC_SPAWN.halfLength)
      * Math.abs(Math.sin(heading) * x + Math.cos(heading) * z)
      + (item.halfWidth ?? item.halfX ?? TRAFFIC_SPAWN.halfWidth)
      * Math.abs(Math.cos(heading) * x - Math.sin(heading) * z);
  };
  return Math.min(...[a.heading || 0, b.heading || 0].flatMap(heading =>
    [[Math.sin(heading), Math.cos(heading)], [Math.cos(heading), -Math.sin(heading)]]
      .map(([x, z]) => extent(a, x, z) + extent(b, x, z) + padding
        - Math.abs((b.x - a.x) * x + (b.z - a.z) * z))));
}

function retreatIsSafe(car, end, occupants, obstacles) {
  const neighbors = [...obstacles, ...occupants.filter(other => other.id !== car.id)];
  const depths = neighbors.map(other => overlapDepth(car, other));
  const distance = distanceBetween(car, end), steps = Math.max(1, Math.ceil(distance / 0.25));
  for (let step = 1; step <= steps; step++) {
    const fraction = step / steps, time = Math.min(3, distance * fraction / 2.5);
    const pose = { ...car, x: car.x + (end.x - car.x) * fraction, z: car.z + (end.z - car.z) * fraction };
    for (let i = 0; i < neighbors.length; i++) {
      const other = neighbors[i];
      const depth = overlapDepth(pose, { ...other,
        x: other.x + (other.vx || 0) * time, z: other.z + (other.vz || 0) * time });
      if (depth > 0 && (depths[i] <= 0 || depth > depths[i] + 1e-6)) return false;
      depths[i] = depth;
    }
  }
  return true;
}

function toLocal(point, obstacle) {
  const dx = point.x - obstacle.x, dz = point.z - obstacle.z, heading = obstacle.heading || 0;
  const c = Math.cos(heading), s = Math.sin(heading);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

export function corridorBlocked(start, end, obstacles, padding = 1.1) {
  for (const obstacle of obstacles) {
    const a = toLocal(start, obstacle), b = toLocal(end, obstacle);
    const minX = -obstacle.halfX - padding, maxX = obstacle.halfX + padding;
    const minZ = -obstacle.halfZ - padding, maxZ = obstacle.halfZ + padding;
    let enter = 0, exit = 1;
    for (const [origin, delta, min, max] of [[a.x, b.x - a.x, minX, maxX], [a.z, b.z - a.z, minZ, maxZ]]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < min || origin > max) { enter = 2; break; }
      } else {
        let first = (min - origin) / delta, last = (max - origin) / delta;
        if (first > last) [first, last] = [last, first];
        enter = Math.max(enter, first); exit = Math.min(exit, last);
        if (enter > exit) { enter = 2; break; }
      }
    }
    if (enter <= exit && exit >= 0 && enter <= 1) return true;
  }
  return false;
}

function reachableApproachPoint(graph, car, target, obstacles) {
  const start = nearestRoadNode(graph, car), nodes = [...graph.nodes.values()];
  let best = null;
  for (const node of nodes) {
    if (corridorBlocked(node, target, obstacles)) continue;
    const route = findRoadRoute(graph, start, node.id);
    if (!route) continue;
    const cost = route.length * graph.laneOffset + distanceBetween(node, target);
    if (!best || cost < best.cost) best = { route, cost, node };
  }
  if (!best) return null;
  if (best.route.length > 1) return laneTarget(graph, best.route[0], best.route[1], 0.72);
  return { x: best.node.x, z: best.node.z };
}

export function createPolicePursuit({ targetId = 'player' } = {}) {
  let state = 'pursue', stateSince = 0, lastContactAt = -Infinity, lastTargetId = targetId;
  let previousDistance = Infinity, noProgressTime = 0, recoveryUntil = 0, recoverySide = 1;
  let targetStoppedTime = 0;
  let motionAnchor = null, stalledTime = 0, lastThrottle = 0, escape = null;
  let appliedProfile = getPoliceIntensity(0), desiredSpeedLimit = 0;

  return {
    targetId,
    onContact(time) { lastContactAt = time; },
    reset() {
      state = 'pursue'; stateSince = 0; lastContactAt = -Infinity;
      previousDistance = Infinity; noProgressTime = 0; recoveryUntil = 0; targetStoppedTime = 0;
      motionAnchor = null; stalledTime = 0; lastThrottle = 0; escape = null; recoverySide = 1;
      appliedProfile = getPoliceIntensity(0); desiredSpeedLimit = 0;
    },
    update({ car, target, graph, obstacles = [], occupants = [], time = 0, dt = 0.1, wantedLevel } = {}) {
      appliedProfile = getPoliceIntensity(wantedLevel);
      if (appliedProfile.level === 0) {
        state = 'idle'; desiredSpeedLimit = 0;
        return { state, reason: 'no-wanted-level', control: { steer: 0, throttle: 0, brake: 1 },
          targetId, wantedLevel: appliedProfile.level, targetSpeedLimit: 0 };
      }
      if (!target || target.id !== targetId) return { state: 'recover', reason: 'missing-target', control: { steer: 0, throttle: 0, brake: 1 } };
      const previousState = state;
      if (target.id !== lastTargetId) {
        lastTargetId = target.id;
        this.reset();
        appliedProfile = getPoliceIntensity(wantedLevel);
      }
      const distance = distanceBetween(car, target);
      const speed = Math.hypot(car.vx || 0, car.vz || 0);
      const fx = Math.sin(car.heading || 0), fz = Math.cos(car.heading || 0);
      const signedSpeed = (car.vx || 0) * fx + (car.vz || 0) * fz;
      if (!motionAnchor || distanceBetween(car, motionAnchor) >= 0.5 || speed > 1.2 || lastThrottle < 0.2) {
        motionAnchor = { x: car.x, z: car.z }; stalledTime = 0;
      } else if (!escape) stalledTime += dt;
      if (!escape && stalledTime >= 1.2) {
        recoverySide *= -1;
        const rear = [4, 2, 1].map(length => ({ x: car.x - fx * length, z: car.z - fz * length }))
          .find(end => retreatIsSafe(car, end, occupants, obstacles));
        escape = { phase: rear ? 'reverse' : 'turn', end: rear, until: time + (rear ? 3 : 1.2) };
        recoveryUntil = 0; noProgressTime = 0; stalledTime = 0;
      }
      if (escape) {
        if (escape.phase === 'reverse' && (time >= escape.until || distanceBetween(car, escape.end) < 0.5)) {
          escape = { phase: 'turn', until: time + 1.2 };
        }
        if (time >= escape.until) {
          escape = null; motionAnchor = { x: car.x, z: car.z }; stalledTime = 0;
          previousDistance = Infinity; noProgressTime = 0;
        } else {
          let control = { steer: 0, throttle: 0, brake: 1 }, reason = 'escape-blocked';
          if (escape.phase === 'reverse') {
            if (retreatIsSafe(car, escape.end, occupants, obstacles)) {
              control = signedSpeed > 0.4 ? control : driveControl(-fx, -fz, car.heading, signedSpeed, -2.5, true);
              reason = 'unstuck-reverse';
            }
          } else {
            for (const side of [recoverySide, -recoverySide]) {
              const end = { x: car.x + fx * 3 + fz * side * 3, z: car.z + fz * 3 - fx * side * 3 };
              if (sweptPathIsSafe(car, [car, end], occupants, obstacles, 3)) {
                control = signedSpeed < -0.4 ? control : driveControl(end.x - car.x, end.z - car.z,
                  car.heading, signedSpeed, 3);
                recoverySide = side; reason = 'unstuck-turn'; break;
              }
            }
          }
          state = 'recover'; if (state !== previousState) stateSince = time;
          lastThrottle = control.throttle;
          return { state, reason, control, distance, targetId };
        }
      }
      if (distance < previousDistance - 0.12) noProgressTime = Math.max(0, noProgressTime - dt * 2);
      else noProgressTime += dt;
      previousDistance = distance;
      const targetSpeed = Math.hypot(target.vx || 0, target.vz || 0);
      targetStoppedTime = targetSpeed < 0.5 ? targetStoppedTime + dt : 0;
      const sightBlocked = corridorBlocked(car, target, obstacles);
      const targetRecentlyHit = time - lastContactAt < 6;
      const targetFx = Math.sin(target.heading || 0), targetFz = Math.cos(target.heading || 0);
      const relativeForward = (car.x - target.x) * targetFx + (car.z - target.z) * targetFz;
      let desired = { x: target.x + (target.vx || 0) * appliedProfile.leadSeconds,
        z: target.z + (target.vz || 0) * appliedProfile.leadSeconds };
      let reason = null;
      if (appliedProfile.level < 3) {
        const followDistance = 6;
        desired = { x: target.x + (car.x - target.x) / Math.max(distance, 1e-6) * followDistance
          + (target.vx || 0) * appliedProfile.leadSeconds,
        z: target.z + (car.z - target.z) / Math.max(distance, 1e-6) * followDistance
          + (target.vz || 0) * appliedProfile.leadSeconds };
      }

      if (time < recoveryUntil) {
        state = 'recover';
        const fx = Math.sin(target.heading || 0), fz = Math.cos(target.heading || 0);
        desired = { x: target.x + fx * 13 + fz * recoverySide * 5,
          z: target.z + fz * 13 - fx * recoverySide * 5 };
        reason = 'bounded-recovery';
      } else if (noProgressTime >= 3 && distance > 9) {
        state = 'recover'; stateSince = time; recoveryUntil = time + 2.5; recoverySide *= -1;
        desired = { x: target.x + (target.vx || 0) * 0.6 + recoverySide * 6,
          z: target.z + (target.vz || 0) * 0.6 - recoverySide * 6 };
        noProgressTime = 0; reason = 'no-progress-replan';
      } else if (appliedProfile.canMaintainBlock && distance <= 50
        && (targetRecentlyHit || lastContactAt > -Infinity && targetStoppedTime > 0)) {
        state = 'maintain-block';
      } else if (appliedProfile.ramDistance > 0 && distance <= appliedProfile.ramDistance) {
        state = 'ram';
      } else if (appliedProfile.level < 3) {
        state = 'follow';
      } else if (distance <= 85 || targetSpeed > 1.5) {
        state = 'intercept';
      } else state = 'pursue';
      if (state === 'maintain-block') {
        if (targetSpeed < 1.5) {
          desired = { x: target.x - targetFx * 4.2, z: target.z - targetFz * 4.2 };
        } else if (relativeForward < 3) {
          const side = (car.x - target.x) * targetFz - (car.z - target.z) * targetFx < 0 ? -1 : 1;
          desired = { x: target.x + targetFx * 10 + targetFz * side * 4.5,
            z: target.z + targetFz * 10 - targetFx * side * 4.5 };
        } else desired = { x: target.x + targetFx * 4.2, z: target.z + targetFz * 4.2 };
      }
      if (sightBlocked && state !== 'recover') {
        const waypoint = reachableApproachPoint(graph, car, desired, obstacles);
        if (waypoint) desired = waypoint;
        else reason = 'no-visible-road-approach';
        if (state === 'pursue') state = 'intercept';
      }
      if (state === 'maintain-block' && targetStoppedTime >= 2) reason = 'target-held';
      const contactLimit = Math.min(14, Math.sqrt(2 * 5.5 * Math.max(0, distance - 4.2)) + 1);
      const targetSpeedLimit = appliedProfile.level < 3
        ? distance <= 6 ? 0 : Math.min(appliedProfile.maxSpeed, Math.sqrt(2 * 5.5 * (distance - 6)))
        : state === 'maintain-block'
        ? targetSpeed > 1.5 && relativeForward < 3 ? 14 : 0
        : distance < 40 ? contactLimit : appliedProfile.maxSpeed;
      desiredSpeedLimit = targetSpeedLimit;
      const control = driveControl(desired.x - car.x, desired.z - car.z, car.heading, speed, targetSpeedLimit);
      // Police use the same physical throttle and tire model as the player, with no civilian 8/16 m/s cap.
      if (speed < targetSpeedLimit - 0.4) control.throttle = 1;
      if (signedSpeed < -0.4) { control.throttle = 0; control.brake = 1; }
      lastThrottle = control.throttle;
      if (state !== previousState) stateSince = time;
      return { state, reason, control, distance, targetSpeed, targetSpeedLimit, targetStoppedTime, sightBlocked,
        targetId, wantedLevel: appliedProfile.level };
    },
    diagnostics() { return { state, stateSince, targetId, lastContactAt, noProgressTime, recoveryUntil,
      targetStoppedTime, stalledTime, escapePhase: escape?.phase || null,
      wantedLevel: appliedProfile.level, profile: appliedProfile, desiredSpeedLimit }; },
  };
}
