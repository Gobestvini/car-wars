import test from 'node:test';
import assert from 'node:assert/strict';
import { occludedBuildingIds, segmentIntersectsAabb } from '../src/building-occlusion.js';

const box = { id: 1, bounds: { min: { x: 4, y: 0, z: -1 }, max: { x: 6, y: 8, z: 1 } } };
test('camera segment detects a building only in front of its endpoint', () => {
  assert.equal(segmentIntersectsAabb({ x: 0, y: 2, z: 0 }, { x: 10, y: 2, z: 0 }, box.bounds), true);
  assert.equal(segmentIntersectsAabb({ x: 0, y: 10, z: 0 }, { x: 10, y: 10, z: 0 }, box.bounds), false);
  const behind = { ...box, bounds: { min: { x: 12, y: 0, z: -1 }, max: { x: 14, y: 8, z: 1 } } };
  assert.equal(occludedBuildingIds([behind], { x: 0, y: 2, z: 0 }, [{ x: 10, y: 2, z: 0 }]).size, 0);
});
test('any visible vehicle sample detects the blocker; unrelated buildings remain opaque', () => {
  const side = { ...box, id: 2, bounds: { min: { x: 4, y: 0, z: 9 }, max: { x: 6, y: 8, z: 11 } } };
  const ids = occludedBuildingIds([box, side], { x: 0, y: 2, z: 0 }, [{ x: 10, y: 2, z: 0 }]);
  assert.deepEqual([...ids], [1]);
});
