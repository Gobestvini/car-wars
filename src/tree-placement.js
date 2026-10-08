import { createRoadSurfaceRectangles, createSidewalkRectangles } from './road-surface.js';

export const TREE_PLACEMENT = Object.freeze({
  maxTrees: 96,
  minSpacing: 6.5,
  signalClearance: 3,
  roadClearance: 0.05,
  sidewalkInset: 1.72,
  canopyRadius: Object.freeze({ min: 1.08, max: 1.3 }),
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

function obstacleBounds([x, z, width, depth, , yaw = 0]) {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const halfX = c * width / 2 + s * depth / 2;
  const halfZ = s * width / 2 + c * depth / 2;
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

/** Place one deterministically ranked tree on a road-side sidewalk per street segment. */
export function createTreePlacements(plan, { damageObstacles = [], signals = [] } = {}) {
  const { maxTrees, minSpacing, signalClearance, roadClearance, sidewalkInset, canopyRadius } = TREE_PLACEMENT;
  const plazaSpan = plan.blockPitch;
  const plaza = { centerX: 0, centerZ: 0, width: plazaSpan, depth: plazaSpan };
  const sidewalks = createSidewalkRectangles(plan.roads, plan.bounds, plan.roadWidth, plan.sidewalkWidth, plaza);
  const roads = createRoadSurfaceRectangles(plan.roads, plan.bounds, plan.roadWidth, plaza);
  const buildings = plan.buildings.map(({ x, z, width, depth }) => ({
    minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2,
  }));
  const obstacles = damageObstacles.map(obstacleBounds);
  const ranked = [];

  for (const edge of plan.roadNetwork.edges) {
    const from = plan.roadNetwork.intersections.find(node => node.id === edge.from);
    const to = plan.roadNetwork.intersections.find(node => node.id === edge.to);
    if (!from || !to) continue;
    const horizontal = Math.abs(to.x - from.x) > Math.abs(to.z - from.z);
    const midpointX = (from.x + to.x) / 2;
    const midpointZ = (from.z + to.z) / 2;
    const token = hash(plan.seed >>> 0, (Math.abs(from.x) * 8191 + Math.abs(from.z) * 127
      + Math.abs(to.x) * 17 + Math.abs(to.z)) | 0);
    const sign = token & 1 ? 1 : -1;
    const x = horizontal ? midpointX : from.x + sign * (plan.roadWidth / 2 + sidewalkInset);
    const z = horizontal ? from.z + sign * (plan.roadWidth / 2 + sidewalkInset) : midpointZ;
    const radius = canopyRadius.min + ((token >>> 8) % 1000) / 1000 * (canopyRadius.max - canopyRadius.min);
    const stemRadius = 0.21;

    if (Math.hypot(x, z) < plazaSpan / 2 + radius || !rootInside(sidewalks, x, z, stemRadius)) continue;
    if (roads.some(rect => circleTouchesRect(x, z, radius + roadClearance, rect))) continue;
    if (buildings.some(rect => circleTouchesRect(x, z, radius + 0.2, rect))) continue;
    if (obstacles.some(rect => circleTouchesRect(x, z, radius + 0.2, rect))) continue;
    if (signals.some(signal => Math.hypot(x - signal.x, z - signal.z) < signalClearance + radius)) continue;
    ranked.push({ x, z, radius, token });
  }

  ranked.sort((a, b) => a.token - b.token || a.x - b.x || a.z - b.z);
  const accepted = [];
  for (const candidate of ranked) {
    if (accepted.some(tree => Math.hypot(candidate.x - tree.x, candidate.z - tree.z) < minSpacing)) continue;
    accepted.push({ ...candidate, id: accepted.length });
    if (accepted.length === maxTrees) break;
  }
  return accepted;
}
