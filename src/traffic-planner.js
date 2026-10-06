import { footprintsOverlap, TRAFFIC_SPAWN } from './traffic-spawn.js';

const { halfLength, halfWidth, braking } = TRAFFIC_SPAWN;
export const TRAFFIC_FOLLOW = Object.freeze({ minimumGap: 1.1, timeHeadway: 0.55 });
const { minimumGap, timeHeadway } = TRAFFIC_FOLLOW;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function projectedExtent(item, x, z) {
  const fx = Math.sin(item.heading), fz = Math.cos(item.heading);
  return halfLength * Math.abs(fx * x + fz * z) + halfWidth * Math.abs(fz * x - fx * z);
}

export function followingLimit(car, other, fx, fz) {
  const ahead = (other.x - car.x) * fx + (other.z - car.z) * fz;
  const lateral = Math.abs((other.x - car.x) * fz - (other.z - car.z) * fx);
  if (ahead <= 0 || ahead > 30 || lateral > halfWidth + projectedExtent(other, fz, -fx) + 0.25) return Infinity;
  const ownSpeed = Math.max(0, car.vx * fx + car.vz * fz);
  const leadSpeed = Math.max(0, other.vx * fx + other.vz * fz);
  const gap = ahead - projectedExtent(car, fx, fz) - projectedExtent(other, fx, fz);
  const available = Math.max(0, gap - minimumGap - Math.max(0, ownSpeed - leadSpeed) * 0.1);
  // Solve v*T + v^2/(2*b) <= gap + leader stopping distance.
  return Math.max(0, Math.sqrt((braking * timeHeadway) ** 2 + leadSpeed ** 2 + 2 * braking * available)
    - braking * timeHeadway);
}

export function edgeProgress(point, edge) {
  const fx = (edge.end.x - edge.start.x) / edge.length, fz = (edge.end.z - edge.start.z) / edge.length;
  return (point.x - edge.start.x) * fx + (point.z - edge.start.z) * fz;
}

export function trackProgress(ai, point, edge, dt, legalWait) {
  const progress = edgeProgress(point, edge), key = `${edge.from}>${edge.to}`;
  if (ai.progressEdge !== key || !Number.isFinite(ai.progressAnchor)) {
    ai.progressEdge = key; ai.progressAnchor = progress; ai.progressElapsed = 0;
  }
  ai.progressAlong = progress;
  ai.progressElapsed += dt;
  if (legalWait) { ai.noProgressTime = 0; ai.progressAnchor = progress; ai.progressElapsed = 0; }
  else if (ai.progressElapsed >= 1) {
    ai.noProgressTime = progress - ai.progressAnchor < 0.2 ? (ai.noProgressTime || 0) + ai.progressElapsed : 0;
    ai.progressAnchor = progress; ai.progressElapsed = 0;
  }
}

export function occupiesJunction(car, node, roadWidth) {
  return Math.abs(car.x - node.x) < roadWidth / 2 + projectedExtent(car, 1, 0)
    && Math.abs(car.z - node.z) < roadWidth / 2 + projectedExtent(car, 0, 1);
}

/** Check the entire return corridor, with moving neighbors projected up to three seconds. */
export function sweptPathIsSafe(car, points, occupants, obstacles = [], speed = 4) {
  let elapsed = 0;
  const initialOverlap = new Map(occupants.filter(other => other.id !== car.id && footprintsOverlap(car, other, 0.15))
    .map(other => [other.id, Math.hypot(other.x - car.x, other.z - car.z)]));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const heading = b.reverse ? car.heading : Math.atan2(b.x - a.x, b.z - a.z);
    for (let step = 1, count = Math.ceil(distance / 0.35); step <= count; step++) {
      const fraction = step / count;
      const time = Math.min(3, elapsed + distance * fraction / speed);
      const candidate = { x: a.x + (b.x - a.x) * fraction, z: a.z + (b.z - a.z) * fraction, heading };
      if (obstacles.some(obstacle => footprintsOverlap(candidate, obstacle, 0.2))) return false;
      for (const other of occupants) {
        if (other.id === car.id) continue;
        const predicted = { ...other, x: other.x + other.vx * time, z: other.z + other.vz * time };
        if (!footprintsOverlap(candidate, predicted, 0.3)) { initialOverlap.delete(other.id); continue; }
        const previous = initialOverlap.get(other.id);
        const separation = Math.hypot(predicted.x - candidate.x, predicted.z - candidate.z);
        if (previous === undefined || separation + 1e-6 < previous) return false;
        initialOverlap.set(other.id, separation);
      }
    }
    elapsed += distance / speed;
  }
  return true;
}

export function planPassing(car, blocker, edge, roadWidth, occupants, obstacles = []) {
  if (!blocker || edge.length - edgeProgress(car, edge) < 24) return null;
  const fx = Math.sin(edge.heading), fz = Math.cos(edge.heading), rx = -fz, rz = fx;
  const along = edgeProgress(car, edge);
  const lateral = (car.x - edge.start.x) * rx + (car.z - edge.start.z) * rz;
  const blockedAhead = (blocker.x - car.x) * fx + (blocker.z - car.z) * fz;
  const lane = Math.min(5.2, roadWidth / 4);
  const edgeLimit = roadWidth / 2 - halfWidth - 0.35;
  const reverse = blockedAhead < 9 ? 4 : 0;
  const start = { x: car.x, z: car.z };
  const at = (distance, offset, backwards = false) => ({
    x: edge.start.x + fx * (along + distance) + rx * offset,
    z: edge.start.z + fz * (along + distance) + rz * offset, reverse: backwards,
  });
  for (const offset of [Math.min(2.6, edgeLimit - lane), -2.6, -2 * Math.min(5.2, lane)]) {
    if (Math.abs(offset) < 1.8 || Math.abs(lane + offset) > edgeLimit) continue;
    const returnAt = Math.max(blockedAhead + 8, 12);
    const points = [start];
    if (reverse) points.push(at(-reverse, lateral, true));
    points.push(at(3, offset), at(returnAt, offset), at(returnAt + 7, 0));
    if (along + returnAt + 7 > edge.length - roadWidth / 2 - 1.5 - halfLength - 0.35) continue;
    const fitsRoad = points.slice(1).every((point, index) => {
      const previous = points[index];
      const heading = point.reverse ? car.heading : Math.atan2(point.x - previous.x, point.z - previous.z);
      const extent = projectedExtent({ heading }, rx, rz) + 0.35;
      return [previous, point].every(end => Math.abs(lane + (end.x - edge.start.x) * rx
        + (end.z - edge.start.z) * rz) + extent <= roadWidth / 2);
    });
    if (!fitsRoad) continue;
    if (sweptPathIsSafe(car, points, occupants, obstacles)) return { offset, blocker: blocker.id, points, index: 1 };
  }
  return null;
}

export function driveControl(dx, dz, heading, speed, targetSpeed, reverse = false) {
  const desired = Math.atan2(dx, dz) + (reverse ? Math.PI : 0);
  const error = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
  const steer = clamp(error * 1.9 * (reverse ? -1 : 1), -1, 1);
  if (targetSpeed === 0) return { steer, throttle: 0, brake: 1 };
  const direction = reverse ? -1 : 1;
  const alongSpeed = speed * direction;
  return { steer, throttle: direction * clamp((Math.abs(targetSpeed) - alongSpeed) * 0.42, 0, 0.76),
    brake: alongSpeed < -0.4 ? 1 : clamp((alongSpeed - Math.abs(targetSpeed) - 0.3) * 0.4, 0, 1) };
}

export function corridorFootprints(car, points, owner) {
  const footprints = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], distance = Math.hypot(b.x - a.x, b.z - a.z);
    const heading = b.reverse ? car.heading : Math.atan2(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(distance));
    for (let j = 0; j <= steps; j++) footprints.push({ x: a.x + (b.x - a.x) * j / steps,
      z: a.z + (b.z - a.z) * j / steps, heading, owner });
  }
  return footprints;
}
