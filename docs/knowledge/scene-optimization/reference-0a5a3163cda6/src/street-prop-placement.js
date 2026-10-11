import { createRoundedSidewalkLayout, createRoadSurfaceRectangles } from './road-surface.js';

export const STREET_PROPS = Object.freeze({
  lamp: Object.freeze({ maxCount: 160, spacing: 12, radius: .96, height: 3.9 }),
  bin: Object.freeze({ maxCount: 80, spacing: 8, radius: .4, height: .9 }),
});
const hash = (seed, token) => {
  let value = (seed ^ Math.imul(token + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x85ebca6b);
  return (value ^ value >>> 13) >>> 0;
};
const distanceToRect = (x, z, r) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX),
  Math.max(r.minZ - z, 0, z - r.maxZ));
const bounds = (x, z, width, depth, yaw = 0) => {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const hx = c * width / 2 + s * depth / 2, hz = s * width / 2 + c * depth / 2;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
};

/** Bounded, seeded setup-time placement. The radius encloses the entire model, including lamp arms. */
export function createStreetPropPlacements(plan, { signals = [], trees = [], damageObstacles = [] } = {}) {
  const plaza = { centerX: 0, centerZ: 0, width: plan.blockPitch, depth: plan.blockPitch };
  const layout = createRoundedSidewalkLayout(plan.roads, plan.bounds, plan.roadWidth, plan.sidewalkWidth, plaza);
  const roads = createRoadSurfaceRectangles(plan.roads, plan.bounds, plan.roadWidth, plaza);
  const obstacles = [...plan.buildings.map(b => bounds(b.x, b.z, b.width, b.depth)),
    ...damageObstacles.map(([x, z, width, depth, , yaw]) => bounds(x, z, width, depth, yaw))];
  const nodes = new Map(plan.roadNetwork.intersections.map(node => [node.id, node]));
  const candidates = [];
  for (const [edgeIndex, edge] of plan.roadNetwork.edges.entries()) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!from || !to) continue;
    const horizontal = Math.abs(to.x - from.x) > Math.abs(to.z - from.z);
    for (const [typeIndex, type] of ['lamp', 'bin'].entries()) for (let slot = 0; slot < 3; slot++) for (const side of [-1,1]) {
      const spec = STREET_PROPS[type];
      if (plan.sidewalkWidth < spec.radius * 2 + .04) continue;
      const token = hash(plan.seed, edgeIndex * 24 + typeIndex * 6 + slot * 2 + (side + 1) / 2);
      const along = .2 + slot * .3 + (token % 1000 / 1000 - .5) * .1;
      const inset = spec.radius + .02 + ((token >>> 12) % 1000 / 1000) * (plan.sidewalkWidth - spec.radius * 2 - .04);
      const x = from.x + (to.x - from.x) * along + (horizontal ? 0 : side * (plan.roadWidth / 2 + inset));
      const z = from.z + (to.z - from.z) * along + (horizontal ? side * (plan.roadWidth / 2 + inset) : 0);
      const r = spec.radius;
      // A whole enclosing disk must fit one real sidewalk tile. Corner/plaza pockets are skipped.
      if (!layout.rectangles.some(b => x - r >= b.minX && x + r <= b.maxX && z - r >= b.minZ && z + r <= b.maxZ)) continue;
      if (roads.some(b => distanceToRect(x, z, b) < r + .01)) continue;
      if (obstacles.some(b => distanceToRect(x, z, b) < r + .15)) continue;
      if (trees.some(t => Math.hypot(x - t.x, z - t.z) < r + t.radius + .25)) continue;
      if (signals.some(s => Math.hypot(x - s.x, z - s.z) < r + 3)) continue;
      candidates.push({ type, x, z, radius: r, yaw: horizontal ? (side < 0 ? 0 : Math.PI) : (side < 0 ? Math.PI / 2 : -Math.PI / 2), token });
    }
  }
  candidates.sort((a, b) => a.token - b.token || a.x - b.x || a.z - b.z);
  const counts = { lamp: 0, bin: 0 }, accepted = [];
  for (const candidate of candidates) {
    const spec = STREET_PROPS[candidate.type];
    if (counts[candidate.type] >= spec.maxCount) continue;
    if (accepted.some(p => Math.hypot(p.x - candidate.x, p.z - candidate.z) <
      (p.type === candidate.type ? spec.spacing : p.radius + candidate.radius + .4))) continue;
    accepted.push({ ...candidate, id: accepted.length }); counts[candidate.type]++;
  }
  return accepted;
}
