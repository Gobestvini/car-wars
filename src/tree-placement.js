import { createRoadSurfaceRectangles, createRoundedSidewalkLayout } from './road-surface.js';

export const TREE_PLACEMENT = Object.freeze({
  maxTrees: 320,
  minSpacing: 4.5,
  signalClearance: 3,
  roadClearance: 0.05,
  canopyRadius: Object.freeze({ min: 0.78, max: 1.5 }),
});

function hash(seed, value) {
  let result = (seed ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0;
  result = Math.imul(result ^ result >>> 16, 0x85ebca6b);
  result = Math.imul(result ^ result >>> 13, 0xc2b2ae35);
  return (result ^ result >>> 16) >>> 0;
}

function circleTouchesRect(x, z, radius, rect) {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return dx * dx + dz * dz < radius * radius;
}

function rootInside(rectangles, x, z, radius) {
  return rectangles.some(rect => x - radius >= rect.minX - 1e-7 && x + radius <= rect.maxX + 1e-7
    && z - radius >= rect.minZ - 1e-7 && z + radius <= rect.maxZ + 1e-7);
}

function rootInsideRounded(layout, x, z, radius) {
  if (rootInside(layout.rectangles, x, z, radius)) return true;
  return layout.corners.some(corner => {
    const dx = (x - corner.x) * corner.sx, dz = (z - corner.z) * corner.sz;
    return dx >= radius && dz >= radius && Math.hypot(dx, dz) <= corner.radius - radius;
  });
}

function obstacleBounds([x, z, width, depth, , yaw = 0]) {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const halfX = c * width / 2 + s * depth / 2;
  const halfZ = s * width / 2 + c * depth / 2;
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

/** Seeded candidates on both sidewalks, with varied longitudinal and curb offsets. */
export function createTreePlacements(plan, { damageObstacles = [], signals = [] } = {}) {
  const { maxTrees, minSpacing, signalClearance, roadClearance, canopyRadius } = TREE_PLACEMENT;
  const plazaSpan = plan.blockPitch;
  const plaza = { centerX: 0, centerZ: 0, width: plazaSpan, depth: plazaSpan };
  const sidewalks = createRoundedSidewalkLayout(plan.roads, plan.bounds, plan.roadWidth, plan.sidewalkWidth, plaza);
  const roads = createRoadSurfaceRectangles(plan.roads, plan.bounds, plan.roadWidth, plaza);
  const buildings = plan.buildings.map(({ x, z, width, depth }) => ({
    minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2,
  }));
  const obstacles = damageObstacles.map(obstacleBounds);
  const ranked = [];
  const nodes = new Map(plan.roadNetwork.intersections.map(node => [node.id, node]));

  for (const [edgeIndex, edge] of plan.roadNetwork.edges.entries()) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const horizontal = Math.abs(to.x - from.x) > Math.abs(to.z - from.z);
    for (let slot = 0; slot < 4; slot++) for (const side of [-1, 1]) {
      const token = hash(plan.seed >>> 0, edgeIndex * 8 + slot * 2 + (side === 1 ? 1 : 0));
      const random = salt => hash(token, salt) / 4294967296;
      const radius = canopyRadius.min + random(1) * (canopyRadius.max - canopyRadius.min);
      const stemRadius = 0.21;
      const minInset = radius + roadClearance + 0.02;
      const maxInset = plan.sidewalkWidth - stemRadius - 0.02;
      if (maxInset < minInset) continue;
      const inset = minInset + random(2) * (maxInset - minInset);
      const along = 0.15 + slot * 0.2 + random(3) * 0.1;
      const x = from.x + (to.x - from.x) * along + (horizontal ? 0 : side * (plan.roadWidth / 2 + inset));
      const z = from.z + (to.z - from.z) * along + (horizontal ? side * (plan.roadWidth / 2 + inset) : 0);

      if (Math.hypot(x, z) < plazaSpan / 2 + radius || !rootInsideRounded(sidewalks, x, z, stemRadius)) continue;
      if (roads.some(rect => circleTouchesRect(x, z, radius + roadClearance, rect))) continue;
      if (buildings.some(rect => circleTouchesRect(x, z, radius + 0.2, rect))) continue;
      if (obstacles.some(rect => circleTouchesRect(x, z, radius + 0.2, rect))) continue;
      if (signals.some(signal => Math.hypot(x - signal.x, z - signal.z) < signalClearance + radius)) continue;
      ranked.push({ x, z, radius, token, crownType: hash(token, 4) % 3 });
    }
  }

  ranked.sort((a, b) => a.token - b.token || a.x - b.x || a.z - b.z);
  const accepted = [];
  const cells = new Map();
  for (const candidate of ranked) {
    const cx = Math.floor(candidate.x / minSpacing), cz = Math.floor(candidate.z / minSpacing);
    let crowded = false;
    for (let dx = -1; dx <= 1 && !crowded; dx++) for (let dz = -1; dz <= 1 && !crowded; dz++) {
      crowded = (cells.get(`${cx + dx}:${cz + dz}`) || []).some(tree =>
        (candidate.x - tree.x) ** 2 + (candidate.z - tree.z) ** 2 < minSpacing ** 2);
    }
    if (crowded) continue;
    accepted.push({ ...candidate, id: accepted.length });
    const key = `${cx}:${cz}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(candidate);
    if (accepted.length === maxTrees) break;
  }
  return accepted;
}
