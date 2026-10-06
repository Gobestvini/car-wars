import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoadSurfacePositions, createRoadSurfaceRectangles } from '../src/road-surface.js';
import { ROAD_CENTRES, ROAD_WIDTH_LIMITS } from '../src/city-generator.js';

test('road grid and spawn plaza form a continuous, non-overlapping surface', () => {
  for (const width of [12, 15, 20, 30]) {
    const plazaSpan = 50;
    const tiles = createRoadSurfaceRectangles(ROAD_CENTRES, 210, width,
      { centerX: 0, centerZ: 0, width: plazaSpan, depth: plazaSpan });
    assert.ok(tiles.length > 0);
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j];
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      assert.ok(overlapX <= 1e-8 || overlapZ <= 1e-8, `coplanar road tiles overlap at width${width}`);
    }
    const covers = (x, z) => tiles.some(tile => x >= tile.minX - 1e-8 && x <= tile.maxX + 1e-8
      && z >= tile.minZ - 1e-8 && z <= tile.maxZ + 1e-8);
    for (let x = -200; x <= 200; x += 2.5) for (let z = -200; z <= 200; z += 2.5) {
      const onStreet = ROAD_CENTRES.some(center => Math.abs(x - center) <= width / 2 || Math.abs(z - center) <= width / 2);
      const onPlaza = Math.abs(x) <= plazaSpan / 2 && Math.abs(z) <= plazaSpan / 2;
      assert.equal(covers(x, z), onStreet || onPlaza, `surface coverage mismatch at ${x},${z}, width${width}`);
    }
    const positions = createRoadSurfacePositions(tiles);
    assert.equal(positions.length, tiles.length * 18);
    assert.ok(positions.every(Number.isFinite));
  }
  assert.deepEqual(ROAD_WIDTH_LIMITS, { min: 12, max: 30, step: 1 });
});
