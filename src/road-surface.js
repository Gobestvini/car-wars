const appendCut = (cuts, value, bounds) => cuts.push(Math.max(-bounds, Math.min(bounds, value)));

export const ROAD_SURFACE_HEIGHTS = Object.freeze({
  ground: 0,
  road: 0.005,
  sidewalk: 0.15,
  sidewalkVisual: 0.155,
  sidewalkCapWidth: 0.12,
  sidewalkBottom: -0.015,
});

/** Partition the road grid and spawn plaza into non-overlapping horizontal tiles. */
export function createRoadSurfaceRectangles(roadCenters, bounds, roadWidth, plaza = null) {
  const cuts = [-bounds, bounds];
  const halfRoad = roadWidth / 2;
  for (const center of roadCenters) {
    appendCut(cuts, center - halfRoad, bounds);
    appendCut(cuts, center + halfRoad, bounds);
  }
  if (plaza) {
    appendCut(cuts, plaza.centerZ - plaza.depth / 2, bounds);
    appendCut(cuts, plaza.centerZ + plaza.depth / 2, bounds);
  }
  cuts.sort((a, b) => a - b);
  const zCuts = cuts.filter((value, index) => index === 0 || value - cuts[index - 1] > 1e-8);
  const rectangles = [];

  for (let i = 0; i < zCuts.length - 1; i++) {
    const minZ = zCuts[i], maxZ = zCuts[i + 1];
    const middleZ = (minZ + maxZ) / 2;
    const intervals = [];
    if (roadCenters.some(center => Math.abs(middleZ - center) < halfRoad)) intervals.push([-bounds, bounds]);
    for (const center of roadCenters) intervals.push([Math.max(-bounds, center - halfRoad), Math.min(bounds, center + halfRoad)]);
    if (plaza && Math.abs(middleZ - plaza.centerZ) < plaza.depth / 2) {
      intervals.push([Math.max(-bounds, plaza.centerX - plaza.width / 2), Math.min(bounds, plaza.centerX + plaza.width / 2)]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [minX, maxX] of intervals) {
      const last = merged.at(-1);
      if (last && minX <= last[1] + 1e-8) last[1] = Math.max(last[1], maxX);
      else merged.push([minX, maxX]);
    }
    for (const [minX, maxX] of merged) if (maxX - minX > 1e-8) rectangles.push({ minX, maxX, minZ, maxZ });
  }
  return rectangles;
}

export function createRoadSurfacePositions(rectangles, y = 0.005) {
  const positions = [];
  for (const { minX, maxX, minZ, maxZ } of rectangles) {
    positions.push(minX, y, minZ, minX, y, maxZ, maxX, y, maxZ,
      minX, y, minZ, maxX, y, maxZ, maxX, y, minZ);
  }
  return new Float32Array(positions);
}

const contains = (rectangles, x, z) => rectangles.some(rect => x > rect.minX && x < rect.maxX
  && z > rect.minZ && z < rect.maxZ);
const containsSurface = (rectangles, x, z) => rectangles.some(rect => x >= rect.minX && x <= rect.maxX
  && z >= rect.minZ && z <= rect.maxZ);

/** Find the perimeter of a rectangle union, split into exposed segments. */
export function createRectangleUnionEdges(rectangles) {
  const edges = [];
  const epsilon = 1e-7;
  const cutsX = [...new Set(rectangles.flatMap(({ minX, maxX }) => [minX, maxX]))].sort((a, b) => a - b);
  const cutsZ = [...new Set(rectangles.flatMap(({ minZ, maxZ }) => [minZ, maxZ]))].sort((a, b) => a - b);

  for (const z of cutsZ) for (let index = 0; index < cutsX.length - 1; index++) {
    const minX = cutsX[index], maxX = cutsX[index + 1];
    if (maxX - minX < epsilon) continue;
    const middleX = (minX + maxX) / 2;
    const north = contains(rectangles, middleX, z - epsilon);
    const south = contains(rectangles, middleX, z + epsilon);
    if (north !== south) edges.push({ axis: 'x', value: z, min: minX, max: maxX, side: north ? 'north' : 'south' });
  }
  for (const x of cutsX) for (let index = 0; index < cutsZ.length - 1; index++) {
    const minZ = cutsZ[index], maxZ = cutsZ[index + 1];
    if (maxZ - minZ < epsilon) continue;
    const middleZ = (minZ + maxZ) / 2;
    const west = contains(rectangles, x - epsilon, middleZ);
    const east = contains(rectangles, x + epsilon, middleZ);
    if (west !== east) edges.push({ axis: 'z', value: x, min: minZ, max: maxZ, side: west ? 'west' : 'east' });
  }

  const merged = [];
  for (const edge of edges) {
    const last = merged.find(item => item.axis === edge.axis && item.value === edge.value
      && item.side === edge.side && Math.abs(item.max - edge.min) < epsilon);
    if (last) last.max = edge.max;
    else merged.push({ ...edge });
  }
  return merged;
}

/** Build vertical quads along union edges; road-facing edges become visible curb faces. */
export function createSidewalkWallPositions(edges, bottom = ROAD_SURFACE_HEIGHTS.sidewalkBottom,
  top = ROAD_SURFACE_HEIGHTS.sidewalkVisual) {
  const positions = [];
  for (const { axis, value, min, max } of edges) {
    if (axis === 'x') positions.push(min, bottom, value, max, bottom, value, max, top, value,
      min, bottom, value, max, top, value, min, top, value);
    else positions.push(value, bottom, min, value, bottom, max, value, top, max,
      value, bottom, min, value, top, max, value, top, min);
  }
  return new Float32Array(positions);
}

export function createRoadFacingSidewalkEdges(edges, roadRects) {
  const epsilon = 1e-4;
  return edges.filter(({ axis, value, min, max, side }) => {
    const along = (min + max) / 2;
    const x = axis === 'x' ? along : value + (side === 'west' ? epsilon : -epsilon);
    const z = axis === 'x' ? value + (side === 'north' ? epsilon : -epsilon) : along;
    return contains(roadRects, x, z);
  });
}

/** Narrow markings lie on the top surface and only follow the road-facing perimeter. */
export function createSidewalkCapPositions(edges, width = ROAD_SURFACE_HEIGHTS.sidewalkCapWidth,
  y = ROAD_SURFACE_HEIGHTS.sidewalkVisual + 0.001) {
  const positions = [];
  for (const { axis, value, min, max, side } of edges) {
    if (axis === 'x') {
      const innerZ = value + (side === 'north' ? width : -width);
      positions.push(min, y, value, min, y, innerZ, max, y, innerZ,
        min, y, value, max, y, innerZ, max, y, value);
    } else {
      const innerX = value + (side === 'west' ? width : -width);
      positions.push(value, y, min, innerX, y, min, innerX, y, max,
        value, y, min, innerX, y, max, value, y, max);
    }
  }
  return new Float32Array(positions);
}

export function createSidewalkSupportBoxes(rectangles, bottom = ROAD_SURFACE_HEIGHTS.sidewalkBottom,
  top = ROAD_SURFACE_HEIGHTS.sidewalk) {
  return rectangles.filter(({ minX, maxX, minZ, maxZ }) => maxX - minX > 1e-8 && maxZ - minZ > 1e-8)
    .map(({ minX, maxX, minZ, maxZ }) => ({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2,
      y: (bottom + top) / 2, halfX: (maxX - minX) / 2, halfY: (top - bottom) / 2,
      halfZ: (maxZ - minZ) / 2, wheelSupport: true }));
}

/** The difference between expanded streets and asphalt forms disjoint sidewalk tiles. */
export function createSidewalkRectangles(roadCenters, bounds, roadWidth, sidewalkWidth, plaza = null) {
  const outer = createRoadSurfaceRectangles(roadCenters, bounds, roadWidth + 2 * sidewalkWidth);
  const roads = createRoadSurfaceRectangles(roadCenters, bounds, roadWidth, plaza);
  let tiles = outer;
  for (const road of roads) {
    tiles = tiles.flatMap(tile => {
      const x0 = Math.max(tile.minX, road.minX), x1 = Math.min(tile.maxX, road.maxX);
      const z0 = Math.max(tile.minZ, road.minZ), z1 = Math.min(tile.maxZ, road.maxZ);
      if (x0 >= x1 || z0 >= z1) return [tile];
      return [
        { ...tile, maxX: x0 }, { ...tile, minX: x1 },
        { minX: x0, maxX: x1, minZ: tile.minZ, maxZ: z0 },
        { minX: x0, maxX: x1, minZ: z1, maxZ: tile.maxZ },
      ].filter(part => part.maxX - part.minX > 1e-8 && part.maxZ - part.minZ > 1e-8);
    });
  }
  return tiles;
}

/** Match the layered city surfaces so decals use the topmost visible surface height. */
export function createSurfaceHeightSampler(plan, offset = 0.004) {
  const centreIndex = Math.floor(plan.roads.length / 2);
  const plazaSpan = Math.abs(plan.roads[centreIndex] - plan.roads[centreIndex - 1]);
  const plaza = { centerX: 0, centerZ: 0, width: plazaSpan, depth: plazaSpan };
  const roads = createRoadSurfaceRectangles(plan.roads, plan.bounds, plan.roadWidth, plaza);
  const sidewalks = createSidewalkRectangles(plan.roads, plan.bounds, plan.roadWidth, plan.sidewalkWidth, plaza);
  return (x, z) => {
    if (containsSurface(sidewalks, x, z)) return ROAD_SURFACE_HEIGHTS.sidewalkVisual + offset;
    if (containsSurface(roads, x, z)) return ROAD_SURFACE_HEIGHTS.road + offset;
    return -0.015 + offset;
  };
}
