import { findRoadRoute, laneTarget, nearestRoadNode } from './traffic-ai.js';
import { driveControl } from './traffic-planner.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distanceBetween = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

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

  return {
    targetId,
    onContact(time) { lastContactAt = time; },
    reset() {
      state = 'pursue'; stateSince = 0; lastContactAt = -Infinity;
      previousDistance = Infinity; noProgressTime = 0; recoveryUntil = 0; targetStoppedTime = 0;
    },
    update({ car, target, graph, obstacles = [], occupants = [], time = 0, dt = 0.1 }) {
      if (!target || target.id !== targetId) return { state: 'recover', reason: 'missing-target', control: { steer: 0, throttle: 0, brake: 1 } };
      const previousState = state;
      if (target.id !== lastTargetId) { lastTargetId = target.id; this.reset(); }
      const distance = distanceBetween(car, target);
      if (distance < previousDistance - 0.12) noProgressTime = Math.max(0, noProgressTime - dt * 2);
      else noProgressTime += dt;
      previousDistance = distance;
      const targetSpeed = Math.hypot(target.vx || 0, target.vz || 0);
      targetStoppedTime = targetSpeed < 0.5 ? targetStoppedTime + dt : 0;
      const sightBlocked = corridorBlocked(car, target, obstacles);
      const targetRecentlyHit = time - lastContactAt < 6;
      const targetFx = Math.sin(target.heading || 0), targetFz = Math.cos(target.heading || 0);
      const relativeForward = (car.x - target.x) * targetFx + (car.z - target.z) * targetFz;
      let desired = { x: target.x + (target.vx || 0) * 0.55, z: target.z + (target.vz || 0) * 0.55 };
      let reason = null;

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
      } else if (distance <= 50 && (targetRecentlyHit || lastContactAt > -Infinity && targetStoppedTime > 0)) {
        state = 'maintain-block';
      } else if (distance <= 12) {
        state = 'ram';
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
      const speed = Math.hypot(car.vx || 0, car.vz || 0);
      const contactLimit = Math.min(14, Math.sqrt(2 * 5.5 * Math.max(0, distance - 4.2)) + 1);
      const targetSpeedLimit = state === 'maintain-block'
        ? targetSpeed > 1.5 && relativeForward < 3 ? 14 : 0
        : distance < 40 ? contactLimit : 50;
      const control = driveControl(desired.x - car.x, desired.z - car.z, car.heading, speed, targetSpeedLimit);
      // Police use the same physical throttle and tire model as the player, with no civilian 8/16 m/s cap.
      if (speed < targetSpeedLimit - 0.4) control.throttle = 1;
      if (state !== previousState) stateSince = time;
      return { state, reason, control, distance, targetSpeed, targetStoppedTime, sightBlocked, targetId };
    },
    diagnostics() { return { state, stateSince, targetId, lastContactAt, noProgressTime, recoveryUntil, targetStoppedTime }; },
  };
}
