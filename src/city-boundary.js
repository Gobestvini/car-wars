import { seededRandom } from './city-layout.js';

// Clear space between foundations; ordinary city rows use a one metre gap.
export const BOUNDARY_HOUSE_GAP = 0.6;
const normalSign = edge => edge.side === 'north' || edge.side === 'west' ? 1 : -1;

/** Coordinate both rows at each re-entrant corner instead of overlapping houses. */
export function createCityBoundary(plan) {
  if (!plan.contour) return [];
  const random = seededRandom(plan.seed ^ 0x613f5b), buildings = [];
  const gap = BOUNDARY_HOUSE_GAP;
  const vertices = new Map();
  const trims = plan.contour.map(() => [gap / 2, gap / 2]);
  for (const [segment, edge] of plan.contour.entries()) {
    for (const [end, along] of [edge.min, edge.max].entries()) {
      const x = edge.axis === 'x' ? along : edge.value;
      const z = edge.axis === 'x' ? edge.value : along;
      const key = `${x}:${z}`;
      if (!vertices.has(key)) vertices.set(key, { x, z, edges: [] });
      vertices.get(key).edges.push({ segment, edge, end, direction: end === 0 ? 1 : -1 });
    }
  }
  const add = data => buildings.push({ id: 10000 + buildings.length, ...data,
    height: (2 + Math.floor(random() * 3)) * (2.7 + random() * 0.16),
    color: '#a5ccdc', style: Math.floor(random() * 3), landmark: false, boundary: true });
  for (const vertex of vertices.values()) {
    const h = vertex.edges.find(item => item.edge.axis === 'x');
    const v = vertex.edges.find(item => item.edge.axis === 'z');
    if (!h || !v || h.direction !== normalSign(v.edge) || v.direction !== normalSign(h.edge)) continue;
    // Only the exterior quadrant is empty at a concave join. One shared house
    // occupies it, and the two rows stop a full gap short of that house.
    const size = Math.min(11, (h.edge.max - h.edge.min - gap) / 2,
      (v.edge.max - v.edge.min - gap) / 2);
    if (!(size > 0)) continue;
    add({ x: vertex.x + h.direction * size / 2, z: vertex.z + v.direction * size / 2,
      width: size, depth: size, segment: h.segment, segments: [h.segment, v.segment], slot: -1, corner: true });
    trims[h.segment][h.end] = size + gap;
    trims[v.segment][v.end] = size + gap;
  }
  for (const [segment, edge] of plan.contour.entries()) {
    const start = edge.min + trims[segment][0], end = edge.max - trims[segment][1];
    if (!(end > start)) continue;
    const length = end - start;
    const count = Math.max(1, Math.round((length + gap) / (11 + gap)));
    const span = (length - (count - 1) * gap) / count;
    const depth = 11;
    // An isolated short contour fixture still receives a full-sized house.
    const width = Math.max(10, span);
    for (let slot = 0; slot < count; slot++) {
      const along = start + span / 2 + slot * (span + gap);
      const normal = edge.value + normalSign(edge) * depth / 2;
      add({ segment, slot, x: edge.axis === 'x' ? along : normal,
        z: edge.axis === 'x' ? normal : along, width: edge.axis === 'x' ? width : depth,
        depth: edge.axis === 'x' ? depth : width });
    }
  }
  // A sub-metre isolated segment cannot be inset at both ends. Cover it with
  // an ordinary house rather than manufacturing a sliver of a building.
  if (!buildings.length && plan.contour.length === 1) {
    const edge = plan.contour[0], along = (edge.min + edge.max) / 2;
    const normal = edge.value + normalSign(edge) * 5;
    add({ segment: 0, slot: 0, x: edge.axis === 'x' ? along : normal,
      z: edge.axis === 'x' ? normal : along, width: 10, depth: 10 });
  }
  return buildings;
}
