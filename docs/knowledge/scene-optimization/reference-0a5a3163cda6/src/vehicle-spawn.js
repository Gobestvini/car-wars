import { footprintsOverlap, isTrafficSpawnSafe, TRAFFIC_SPAWN } from './traffic-spawn.js';

const SURFACE_TOLERANCE = 0.65;
const FOOTPRINT_CLEARANCE = 0.2;

function footprintAt(position, yaw) {
  return { x: position.x, z: position.z, heading: yaw,
    halfLength: TRAFFIC_SPAWN.halfLength, halfWidth: TRAFFIC_SPAWN.halfWidth };
}

export function validateSpawnGeometry({ position, yaw = 0, bounds, obstacles = [], surfaceHeight = () => 0 }) {
  if (!position || ![position.x, position.y, position.z, yaw].every(Number.isFinite)) {
    return { ok: false, reason: 'invalid-pose' };
  }
  const footprint = footprintAt(position, yaw);
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const halfX = TRAFFIC_SPAWN.halfLength * Math.abs(fx) + TRAFFIC_SPAWN.halfWidth * Math.abs(rx);
  const halfZ = TRAFFIC_SPAWN.halfLength * Math.abs(fz) + TRAFFIC_SPAWN.halfWidth * Math.abs(rz);
  if (bounds && (position.x - halfX < bounds.minX || position.x + halfX > bounds.maxX
    || position.z - halfZ < bounds.minZ || position.z + halfZ > bounds.maxZ)) {
    return { ok: false, reason: 'out-of-bounds' };
  }
  const height = surfaceHeight(position.x, position.z);
  if (!Number.isFinite(height) || Math.abs(position.y - height) > SURFACE_TOLERANCE) {
    return { ok: false, reason: 'unsupported-surface' };
  }
  if (obstacles.some(obstacle => footprintsOverlap(footprint, obstacle, FOOTPRINT_CLEARANCE))) {
    return { ok: false, reason: 'blocked-by-building' };
  }
  return { ok: true, pose: { x: position.x, y: height, z: position.z, yaw } };
}

export function findSafeSpawnPose(request, { bounds, obstacles = [], occupants = [], surfaceHeight = () => 0,
  maxDistance = 40, step = 3, ownerId = null } = {}) {
  const { position, yaw = 0 } = request || {};
  if (!position || ![position.x, position.y, position.z, yaw].every(Number.isFinite)) {
    return { status: 'rejected', reason: 'invalid-pose' };
  }
  const geometry = validateSpawnGeometry({ position, yaw, bounds, obstacles, surfaceHeight });
  const nearestRequested = request.options?.placement === 'nearest-safe';
  if (!geometry.ok && !(nearestRequested && geometry.reason === 'blocked-by-building')) {
    return { status: 'rejected', reason: geometry.reason };
  }
  const surface = surfaceHeight(position.x, position.z);
  const originPose = geometry.ok ? geometry.pose : { x: position.x, y: surface, z: position.z, yaw };
  const others = occupants.filter(item => item.id !== ownerId);
  const isSafe = pose => isTrafficSpawnSafe(footprintAt(pose, yaw), others, [], TRAFFIC_SPAWN.minimumGap);
  if (geometry.ok && isSafe(geometry.pose)) return { status: 'created', pose: geometry.pose, distance: 0 };
  if (!nearestRequested && geometry.ok) return { status: 'pending', reason: 'occupied' };

  const candidates = [];
  for (let radius = step; radius <= Math.min(maxDistance, 80); radius += step) {
    const count = Math.max(8, Math.ceil(2 * Math.PI * radius / step));
    for (let index = 0; index < count; index++) {
      const angle = index * Math.PI * 2 / count;
      const candidatePosition = { x: position.x + Math.cos(angle) * radius,
        y: surface, z: position.z + Math.sin(angle) * radius };
      const checked = validateSpawnGeometry({ position: candidatePosition, yaw, bounds, obstacles, surfaceHeight });
      if (checked.ok && isSafe(checked.pose)) candidates.push({ pose: checked.pose, distance: radius, index });
    }
    if (candidates.length) break;
  }
  candidates.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return candidates.length ? { status: 'created', pose: candidates[0].pose, distance: candidates[0].distance }
    : { status: 'pending', reason: 'no-nearby-safe-pose' };
}
