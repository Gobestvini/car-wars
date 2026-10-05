import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan, CITY_BOUNDS, ROAD_WIDTH, ROAD_CENTRES, BUILDING_SETBACK } from '../src/city-generator.js';

test('city plan is deterministic for a seed and changes for another seed', () => {
  assert.deepEqual(createCityPlan(123), createCityPlan(123));
  assert.notDeepEqual(createCityPlan(123).buildings, createCityPlan(124).buildings);
});

test('buildings stay inside the finite district, avoid the start and road corridors', () => {
  const plan = createCityPlan();
  assert.ok(plan.buildings.length >= 24);
  assert.equal(plan.landmarks.length, 3);
  for (const b of plan.buildings) {
    assert.ok(Number.isFinite(b.x + b.z + b.height));
    assert.ok(Math.abs(b.x) + b.width / 2 < CITY_BOUNDS - 5);
    assert.ok(Math.abs(b.z) + b.depth / 2 < CITY_BOUNDS - 5);
    const clearX = Math.max(0, Math.abs(b.x) - b.width / 2);
    const clearZ = Math.max(0, Math.abs(b.z) - b.depth / 2);
    assert.ok(Math.hypot(clearX, clearZ) > 4.5);
    for (const road of plan.roads) {
      const xClear = Math.abs(b.x - road) - b.width / 2;
      const zClear = Math.abs(b.z - road) - b.depth / 2;
      assert.ok(Math.max(xClear, zClear) >= ROAD_WIDTH / 2 + BUILDING_SETBACK);
    }
  }
});

test('wide connected street grid, setbacks, open spawn, and landmarks stay coherent', () => {
  const plan = createCityPlan();
  assert.equal(ROAD_WIDTH, 22);
  assert.deepEqual(ROAD_CENTRES, [-75, -25, 25, 75]);
  assert.equal(plan.buildings.length, 32);
  assert.equal(plan.landmarks.length, 3);
  assert.ok(plan.buildings.every(b => Math.hypot(b.x, b.z) > 20));
  assert.ok(Math.max(...plan.buildings.flatMap(b => [Math.abs(b.x) + b.width / 2, Math.abs(b.z) + b.depth / 2])) < CITY_BOUNDS - 5);
});
