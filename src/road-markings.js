import { getStopLineLayout } from './signal-layout.js';

const DASH_LENGTH = 2.2;
const SOLID_APPROACH_LENGTH = 12;

export function createRoadMarkings(roadCenters, bounds, roadWidth, spacing = 6, endMargin = 6) {
  if (!Array.isArray(roadCenters) && roadCenters.roadSegments) {
    const marks = [];
    const degree = new Map();
    for (const edge of roadCenters.roadNetwork?.edges || []) {
      for (const id of [edge.from, edge.to]) degree.set(id, (degree.get(id) || 0) + 1);
    }
    for (const { from, to } of roadCenters.roadSegments) {
      const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
      if (length === 0) continue;
      const margin = roadWidth / 2 + 3;
      const controlledFrom = degree.get(from.id) >= 4, controlledTo = degree.get(to.id) >= 4;
      const stopDistance = getStopLineLayout(from, {
        forwardX: dx / length, forwardZ: dz / length, rightX: -dz / length, rightZ: dx / length,
      }, roadWidth).distanceFromNode;
      const start = controlledFrom ? stopDistance : margin;
      const end = length - (controlledTo ? stopDistance : margin);
      if (end <= start) continue;
      const solids = [];
      if (controlledFrom) solids.push([start, Math.min(end, start + SOLID_APPROACH_LENGTH)]);
      if (controlledTo) {
        const interval = [Math.max(start, end - SOLID_APPROACH_LENGTH), end];
        if (solids.length && interval[0] <= solids[0][1]) solids[0][1] = end;
        else solids.push(interval);
      }
      const add = (min, max, kind) => {
        if (max - min < 1e-8) return;
        const along = (min + max) / 2;
        marks.push({ x: from.x + dx * along / length, z: from.z + dz * along / length,
          yaw: dx ? Math.PI / 2 : 0, axis: dx ? 'x' : 'z', length: max - min, kind });
      };
      for (const [min, max] of solids) add(min, max, 'solid');
      // Keep the old dash rhythm, clipping strokes at solid transitions rather
      // than painting overlapping coplanar instances or leaving holes in solids.
      for (let along = margin + DASH_LENGTH / 2; along <= length - margin - DASH_LENGTH / 2; along += spacing) {
        let min = Math.max(start, along - DASH_LENGTH / 2);
        const max = Math.min(end, along + DASH_LENGTH / 2);
        for (const [solidStart, solidEnd] of solids) {
          if (solidStart >= max) break;
          if (solidEnd <= min) continue;
          add(min, Math.min(max, solidStart), 'dash');
          min = Math.max(min, solidEnd);
        }
        add(min, max, 'dash');
      }
    }
    return marks;
  }
  if(!Array.isArray(roadCenters)) roadCenters=roadCenters.roads;
  const marks = [];
  for (const road of roadCenters) {
    for (let offset = -bounds + endMargin; offset <= bounds - endMargin; offset += spacing) {
      if (roadCenters.some(cross => Math.abs(offset - cross) < roadWidth / 2 + 3)) continue;
      marks.push({ x: road, z: offset, yaw: 0, axis: 'z' });
      marks.push({ x: offset, z: road, yaw: Math.PI / 2, axis: 'x' });
    }
  }
  return marks;
}
