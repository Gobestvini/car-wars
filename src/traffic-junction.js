import { footprintsOverlap } from './traffic-spawn.js';

const conflictCache = new Map();
const direction = heading => ({ x: Math.sin(heading), z: Math.cos(heading) });

export function junctionMovement(incoming, outgoing, node, width) {
  if (!incoming || !outgoing) return null;
  const a = direction(incoming.heading), b = direction(outgoing.heading);
  const cross = a.x * b.z - a.z * b.x, dot = a.x * b.x + a.z * b.z;
  const turn = dot < -0.9 ? 'u-turn' : Math.abs(cross) < 0.1 ? 'straight' : cross > 0 ? 'right' : 'left';
  const reach = width / 2 + 3, lane = Math.min(5.2, width / 4);
  const start = { x: -a.x * reach - a.z * lane, z: -a.z * reach + a.x * lane };
  const end = { x: b.x * reach - b.z * lane, z: b.z * reach + b.x * lane };
  const points = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48, u = 1 - t;
    let x, z;
    if (turn === 'straight') { x = start.x * u + end.x * t; z = start.z * u + end.z * t; }
    else if (turn === 'u-turn') {
      const lead = reach - lane, arc = Math.PI * lane, distance = t * (2 * lead + arc);
      let forward, side;
      if (distance < lead) { forward = -reach + distance; side = lane; }
      else if (distance <= lead + arc) {
        const angle = (distance - lead) / lane;
        forward = -lane + lane * Math.sin(angle); side = lane * Math.cos(angle);
      } else { forward = -lane - (distance - lead - arc); side = -lane; }
      x = a.x * forward - a.z * side;
      z = a.z * forward + a.x * side;
    } else {
      const along = ((end.x - start.x) * b.z - (end.z - start.z) * b.x) / cross;
      const control = { x: start.x + a.x * along, z: start.z + a.z * along };
      x = u * u * start.x + 2 * u * t * control.x + t * t * end.x;
      z = u * u * start.z + 2 * u * t * control.z + t * t * end.z;
    }
    points.push({ x: node.x + x, z: node.z + z });
  }
  let length = 0;
  points.forEach((point, index) => {
    const next = points[Math.min(index + 1, points.length - 1)], previous = points[Math.max(0, index - 1)];
    point.heading = Math.atan2(next.x - previous.x, next.z - previous.z);
    if (index) length += Math.hypot(point.x - previous.x, point.z - previous.z);
    point.distance = length;
  });
  return { from: incoming.from, nodeId: node.id, to: outgoing.to, heading: incoming.heading, turn, points,
    key: `${width}:${Math.round(incoming.heading * 1000)}:${Math.round(outgoing.heading * 1000)}`, node };
}

export function movementsConflict(a, b) {
  if (!a || !b) return true;
  if (a.key === b.key) return false; // Same-lane platoons are separated by longitudinal following.
  // Diverging cars from one approach keep their following gap instead of owning the entire junction.
  if (Math.cos(a.heading - b.heading) > 0.99 && a.turn !== 'u-turn' && b.turn !== 'u-turn') return false;
  const key = [a.key, b.key].sort().join('|');
  if (conflictCache.has(key)) return conflictCache.get(key);
  const local = movement => movement.points.map(p => ({ ...p, x: p.x - movement.node.x, z: p.z - movement.node.z }));
  const first = local(a), second = local(b);
  const conflict = first.some(p => second.some(q => Math.hypot(p.x - q.x, p.z - q.z) < 5
    && footprintsOverlap(p, q, 0.35)));
  conflictCache.set(key, conflict);
  return conflict;
}

export function yieldsToOncoming(a, b) {
  return a?.turn === 'left' && b && ['straight', 'right'].includes(b.turn)
    && Math.cos(a.heading - b.heading) < -0.9;
}

export function pathProgress(car, movement) {
  const points = movement.points;
  let best = Infinity, progress = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
    const squared = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((car.x - a.x) * dx + (car.z - a.z) * dz) / squared));
    const distance = (car.x - a.x - dx * t) ** 2 + (car.z - a.z - dz * t) ** 2;
    if (distance < best) { best = distance; progress = a.distance + (b.distance - a.distance) * t; }
  }
  if (progress < 1e-6) {
    const start = points[0], along = (car.x - start.x) * Math.sin(start.heading) + (car.z - start.z) * Math.cos(start.heading);
    if (along < 0) return along;
  }
  if (progress > points.at(-1).distance - 1e-6) {
    const end = points.at(-1), along = (car.x - end.x) * Math.sin(end.heading) + (car.z - end.z) * Math.cos(end.heading);
    if (along > 0) return end.distance + along;
  }
  return progress;
}

export function pathTarget(car, movement, lookahead = 2.5) {
  const distance = pathProgress(car, movement) + lookahead, points = movement.points;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (b.distance < distance) continue;
    const t = Math.max(0, (distance - a.distance) / (b.distance - a.distance));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
  return points.at(-1);
}
