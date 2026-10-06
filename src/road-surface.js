const appendCut = (cuts, value, bounds) => cuts.push(Math.max(-bounds, Math.min(bounds, value)));

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
