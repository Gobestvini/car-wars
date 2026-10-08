import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan } from '../src/city-generator.js';
import { createRepairPickupPlacements, REPAIR_PICKUP_CONFIG, RepairPickupManager } from '../src/repair-pickups.js';

test('12 deterministic road pickups cover all nine map sectors at each supported road width', () => {
  for (const roadWidth of [12, 15, 30]) {
    const plan = createCityPlan(20261005, { roadWidth });
    const first = createRepairPickupPlacements(plan), second = createRepairPickupPlacements(plan);
    assert.deepEqual(first, second);
    assert.equal(first.length, REPAIR_PICKUP_CONFIG.count);
    assert.equal(new Set(first.map(item => item.section)).size, 9);
    for (let i = 0; i < first.length; i++) for (let j = i + 1; j < first.length; j++) {
      assert.ok(Math.hypot(first[i].x - first[j].x, first[i].z - first[j].z) >= REPAIR_PICKUP_CONFIG.minSpacing);
    }
    assert.ok(first.every(item => Math.hypot(item.x, item.z) > plan.blockPitch / 2 + 5));
  }
});

test('swept pickup trigger catches high speed crossings, rejects healthy/high/flying/inactive cases, and consumes once', () => {
  const plan = createCityPlan();
  const manager = new RepairPickupManager(plan);
  const pickup = manager.placements[0];
  const start = { x: pickup.x - 10, z: pickup.z }, end = { x: pickup.x + 10, z: pickup.z };
  assert.equal(manager.collectSegment(start, end, { damaged: false }), null);
  assert.equal(manager.collectSegment(start, end, { damaged: true, enabled: false }), null);
  assert.equal(manager.collectSegment(start, end, { damaged: true, bodyY: 3, expectedBodyY: 1 }), null);
  assert.equal(manager.collectSegment(start, end, { damaged: true, bodyY: 1, expectedBodyY: 1 }), pickup);
  assert.equal(manager.collectSegment(start, end, { damaged: false, bodyY: 1, expectedBodyY: 1 }), null);
  assert.equal(manager.repairs, 1);
  manager.reset();
  assert.ok(manager.placements.every(item => item.status === 'available'));
});
