import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan, CITY_BOUNDS, ROAD_WIDTH, ROAD_CENTRES, BUILDING_SETBACK, CITY_CONFIG } from '../src/city-generator.js';

test('city plans are deterministic for a seed and vary with seed/road width', () => {
  assert.deepEqual(createCityPlan(123), createCityPlan(123));
  assert.notDeepEqual(createCityPlan(123).buildings, createCityPlan(124).buildings);
  assert.notDeepEqual(createCityPlan(123, { roadWidth: 12 }).buildings, createCityPlan(123, { roadWidth: 30 }).buildings);
});

test('default district expands to a deterministic grid with connected street intersections', () => {
  const plan = createCityPlan();
  assert.equal(CITY_BOUNDS, 210);
  assert.equal(plan.bounds * 2, 420);
  assert.equal(ROAD_WIDTH, 15);
  assert.deepEqual(ROAD_CENTRES, [-175, -125, -75, -25, 25, 75, 125, 175]);
  assert.equal(plan.buildings.length, 192);
  assert.equal(plan.landmarks.length, 3);
  assert.equal(plan.roadNetwork.intersections.length, 64);
  assert.equal(plan.roadNetwork.edges.length, 112);
  assert.ok(plan.roadNetwork.edges.every(edge => edge.length === 50));
  assert.deepEqual(plan.roadNetwork.horizontal, plan.roads);
  assert.deepEqual(plan.roadNetwork.vertical, plan.roads);
  assert.ok(plan.buildings.every(building => Math.hypot(building.x, building.z) > 20));
});

test('buildings fit their blocks, stay inside walls, and clear streets at all supported widths', () => {
  for (const roadWidth of [12, 15, 20, 30]) {
    const plan = createCityPlan(20261005, { roadWidth });
    assert.equal(plan.roadWidth, roadWidth);
    for (const building of plan.buildings) {
      assert.ok(Number.isFinite(building.x + building.z + building.height));
      assert.ok(Math.abs(building.x) + building.width / 2 < plan.bounds - 5);
      assert.ok(Math.abs(building.z) + building.depth / 2 < plan.bounds - 5);
      assert.ok(Math.hypot(building.width, building.depth) > 0);
      for (const road of plan.roads) {
        const xClearance = Math.abs(building.x - road) - building.width / 2;
        const zClearance = Math.abs(building.z - road) - building.depth / 2;
        assert.ok(Math.max(xClearance, zClearance) >= roadWidth / 2 + BUILDING_SETBACK - 1e-8,
          `building ${building.id} enters a ${roadWidth}m road corridor`);
      }
    }
  }
});

test('invalid width options fail before a city plan can be used', () => {
  for (const roadWidth of [NaN, 11, 31, Infinity]) {
    assert.throws(() => createCityPlan(1, { roadWidth }), RangeError);
  }
  assert.throws(() => createCityPlan(Number.NaN), TypeError);
});

test('city dimensions are configurable and wider footprints keep seeded heights stable', () => {
  const base = createCityPlan(20261005);
  const wider = createCityPlan(20261005, { config: { ...CITY_CONFIG, buildingFootprint: { min: 10, max: 12 } } });
  assert.equal(wider.sidewalkWidth, 2);
  assert.ok(wider.buildings.every(building => building.width >= 10 && building.width <= 12));
  assert.deepEqual(wider.buildings.map(building => building.height), base.buildings.map(building => building.height));
  assert.deepEqual(base.buildings.slice(0, 8).map(building => building.height),
    [23, 5.677488787397743, 5.488524606302381, 8.194505616500974, 5.708790482878685, 5.700746128633619, 5.6394354119151835, 11.108622681498527]);
  assert.throws(() => createCityPlan(1, { config: { ...CITY_CONFIG, sidewalkWidth: -1 } }), RangeError);
  assert.throws(() => createCityPlan(1, { config: { ...CITY_CONFIG, buildingFootprint: { min: 12, max: 10 } } }), RangeError);
});
