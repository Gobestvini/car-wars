import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan } from '../src/city-generator.js';
import { createRoadSurfaceRectangles } from '../src/road-surface.js';
import { createTreePlacements } from '../src/tree-placement.js';

const distanceToRect = (x, z, rect) => Math.hypot(Math.max(rect.minX - x, 0, x - rect.maxX),
  Math.max(rect.minZ - z, 0, z - rect.maxZ));

test('tree placements are deterministic, spread across town and do not mutate the city plan', () => {
  for (const seed of [1, 20261005, 928172]) {
    const plan = createCityPlan(seed);
    const before = JSON.stringify(plan);
    const first = createTreePlacements(plan);
    assert.deepEqual(first, createTreePlacements(plan));
    assert.equal(JSON.stringify(plan), before);
    assert.ok(first.length >= 32 && first.length <= 96, `seed ${seed} produced ${first.length} trees`);
    assert.ok(first.some(tree => tree.x < -70) && first.some(tree => tree.x > 70));
    assert.ok(first.some(tree => tree.z < -70) && first.some(tree => tree.z > 70));
    assert.ok(first.every((tree, i) => tree.id === i && first.slice(0, i).every(other =>
      Math.hypot(tree.x - other.x, tree.z - other.z) >= 6.5)));
  }
});

test('tree crowns and trunks fit sidewalk pockets clear of asphalt, buildings, spawn and signals', () => {
  for (const roadWidth of [12, 15, 30]) {
    const plan = createCityPlan(20261005, { roadWidth });
    const center = Math.floor(plan.roads.length / 2);
    const plazaSpan = Math.abs(plan.roads[center] - plan.roads[center - 1]);
    const plaza = { centerX: 0, centerZ: 0, width: plazaSpan, depth: plazaSpan };
    const roads = createRoadSurfaceRectangles(plan.roads, plan.bounds, plan.roadWidth, plaza);
    const signals = plan.roadNetwork.intersections.map(node => ({ x: node.x, z: node.z }));
    const placements = createTreePlacements(plan, { signals });
    for (const tree of placements) {
      assert.ok(!roads.some(rect => distanceToRect(tree.x, tree.z, rect) < tree.radius + .05),
        `tree ${tree.id} crown overlaps road at width ${roadWidth}`);
      assert.ok(plan.buildings.every(building => distanceToRect(tree.x, tree.z, {
        minX: building.x - building.width / 2, maxX: building.x + building.width / 2,
        minZ: building.z - building.depth / 2, maxZ: building.z + building.depth / 2,
      }) >= tree.radius + .2), `tree ${tree.id} overlaps a building at width ${roadWidth}`);
      assert.ok(Math.hypot(tree.x, tree.z) > plazaSpan / 2 + tree.radius);
      assert.ok(signals.every(signal => Math.hypot(tree.x - signal.x, tree.z - signal.z) >= 3 + tree.radius));
    }
    assert.ok(placements.length >= 12, `width ${roadWidth} placed only ${placements.length} trees`);
  }
});

test('rotated damage obstacles exclude nearby tree crowns', () => {
  const plan = createCityPlan();
  const first = createTreePlacements(plan)[0];
  const obstacles = [[first.x, first.z, 4, 2, 1, Math.PI / 4]];
  const withoutObstacle = createTreePlacements(plan);
  const withObstacle = createTreePlacements(plan, { damageObstacles: obstacles });
  assert.ok(!withObstacle.some(tree => Math.hypot(tree.x - first.x, tree.z - first.z) < 3.5));
  assert.ok(withoutObstacle.length >= withObstacle.length);
});
