export const REPAIR_PICKUP_CONFIG = Object.freeze({ count: 12, radius: 2, minSpacing: 20,
  junctionClearance: 8, spawnClearance: 3, verticalTolerance: 1, visualSize: 1.2 });

const hash = (seed, value) => {
  let n = (seed ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0;
  n = Math.imul(n ^ n >>> 16, 0x85ebca6b);
  n = Math.imul(n ^ n >>> 13, 0xc2b2ae35);
  return (n ^ n >>> 16) >>> 0;
};

function obstacleBounds([x, z, width, depth, , yaw = 0]) {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const halfX = c * width / 2 + s * depth / 2, halfZ = s * width / 2 + c * depth / 2;
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

const pointRectDistance = (x, z, rect) => Math.hypot(Math.max(rect.minX - x, 0, x - rect.maxX),
  Math.max(rect.minZ - z, 0, z - rect.maxZ));

export function createRepairPickupPlacements(plan, obstacles = []) {
  const config = REPAIR_PICKUP_CONFIG;
  const nodes = new Map(plan.roadNetwork.intersections.map(node => [node.id, node]));
  const buildings = plan.buildings.map(({ x, z, width, depth }) => ({ minX: x - width / 2, maxX: x + width / 2,
    minZ: z - depth / 2, maxZ: z + depth / 2 }));
  const blocked = [...buildings, ...obstacles.map(obstacleBounds)];
  const candidates = [];
  for (const [edgeIndex, edge] of plan.roadNetwork.edges.entries()) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!from || !to) continue;
    for (const [sample, t] of [0.2, 0.35, 0.5, 0.65, 0.8].entries()) {
      const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
      if (Math.hypot(x, z) < plan.blockPitch / 2 + config.radius + config.spawnClearance) continue;
      if (blocked.some(rect => pointRectDistance(x, z, rect) < config.radius + 0.9)) continue;
      const sectionX = Math.min(2, Math.max(0, Math.floor((x + plan.bounds) / (plan.bounds * 2) * 3)));
      const sectionZ = Math.min(2, Math.max(0, Math.floor((z + plan.bounds) / (plan.bounds * 2) * 3)));
      candidates.push({ x, z, edgeIndex, token: hash(plan.seed ^ plan.roadWidth, edgeIndex * 5 + sample),
        section: `${sectionX}:${sectionZ}` });
    }
  }
  candidates.sort((a, b) => a.token - b.token || a.edgeIndex - b.edgeIndex || a.x - b.x);
  const selected = [];
  const accept = candidate => {
    if (selected.some(item => Math.hypot(item.x - candidate.x, item.z - candidate.z) < config.minSpacing)) return false;
    selected.push(candidate); return true;
  };
  const sections = new Map();
  for (const candidate of candidates) {
    if (!sections.has(candidate.section)) sections.set(candidate.section, []);
    sections.get(candidate.section).push(candidate);
  }
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
    const available = sections.get(`${x}:${z}`) || [];
    const chosen = available.find(accept);
    if (!chosen) continue;
  }
  for (const candidate of candidates) {
    if (selected.length >= config.count) break;
    accept(candidate);
  }
  return selected.map(({ token, ...pickup }, id) => ({ id, ...pickup, status: 'available' }));
}

function segmentDistanceSquared(point, start, end) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 > 1e-10 ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / length2)) : 0;
  return { distance2: (point.x - start.x - t * dx) ** 2 + (point.z - start.z - t * dz) ** 2, t };
}

export class RepairPickupManager {
  constructor(plan, obstacles = [], { disabled = false } = {}) {
    this.disabledReason = disabled ? 'damage-test' : null;
    this.placements = disabled ? [] : createRepairPickupPlacements(plan, obstacles);
    this.repairs = 0;
  }
  reset() { for (const pickup of this.placements) pickup.status = 'available'; this.repairs = 0; }
  collectSegment(start, end, { enabled = true, damaged = false, detachedWheels = false,
    bodyY = 0.96, expectedBodyY = 0.96 } = {}) {
    if (!enabled || (!damaged && !detachedWheels) || Math.abs(bodyY - expectedBodyY) > REPAIR_PICKUP_CONFIG.verticalTolerance) return null;
    const candidates = this.placements.filter(pickup => pickup.status === 'available')
      .map(pickup => ({ pickup, ...segmentDistanceSquared(pickup, start, end) }))
      .filter(item => item.distance2 <= REPAIR_PICKUP_CONFIG.radius ** 2).sort((a, b) => a.t - b.t);
    if (!candidates.length) return null;
    const pickup = candidates[0].pickup;
    pickup.status = 'consumed'; this.repairs++;
    return pickup;
  }
  snapshot() { return { pickups: this.placements.map(({ id, x, z, section, status }) => ({ id, x, z, section, status })),
    repairs: this.repairs, unavailableReason: this.disabledReason
      || (this.placements.length < REPAIR_PICKUP_CONFIG.count ? 'limited-road-space' : null) }; }
}
