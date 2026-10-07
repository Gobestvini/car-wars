import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficSpawnSlots, distributeTrafficSpawnSlots, footprintsOverlap, isTrafficSpawnSafe, TRAFFIC_SPAWN } from '../src/traffic-spawn.js';
import { createCityPlan } from '../src/city-generator.js';
import { createRoadGraph } from '../src/traffic-ai.js';

test('spawn slots stay clear of intersections and are spread across directed lanes deterministically', () => {
  const edges = [0, 1].map(lane => ({ length: 50, heading: lane ? Math.PI : 0,
    start: { x: lane * 7, z: 0 }, end: { x: lane * 7, z: 50 } }));
  const slots = createTrafficSpawnSlots(edges);
  assert.equal(slots.length, 6);
  assert.deepEqual(slots.slice(0, 4).map(slot => slot.t), [0.30, 0.30, 0.44, 0.44]);
  assert.ok(slots.every(slot => slot.t * 50 >= TRAFFIC_SPAWN.endpointClearance
    && slot.t * 50 <= 50 - TRAFFIC_SPAWN.endpointClearance));
  assert.deepEqual(slots, createTrafficSpawnSlots(edges));
});

test('oriented spawn footprint rejects collision and preserves a two-metre same-lane gap', () => {
  const candidate = { x: 0, z: 0, heading: 0, vx: 0, vz: 0 };
  const overlap = { x: 0, z: 3, heading: 0, vx: 0, vz: 0 };
  const underGap = { x: 0, z: 2 * TRAFFIC_SPAWN.halfLength + 1.9, heading: 0, vx: 0, vz: 0 };
  const clear = { ...underGap, z: underGap.z + 0.2 };
  assert.equal(footprintsOverlap(candidate, overlap), true);
  assert.equal(isTrafficSpawnSafe(candidate, [overlap]), false);
  assert.equal(isTrafficSpawnSafe(candidate, [underGap]), false);
  assert.equal(isTrafficSpawnSafe(candidate, [clear]), true);
});

test('a fast follower needs braking space and static obstacle footprints block insertion', () => {
  const candidate = { x: 0, z: 0, heading: 0, vx: 0, vz: 0 };
  const slowFollower = { x: 0, z: -9, heading: 0, vx: 0, vz: 2 };
  const fastFollower = { x: 0, z: -9, heading: 0, vx: 0, vz: 8 };
  assert.equal(isTrafficSpawnSafe(candidate, [slowFollower]), true);
  assert.equal(isTrafficSpawnSafe(candidate, [fastFollower]), false);
  assert.equal(isTrafficSpawnSafe(candidate, [], [{ x: 0, z: 0, halfX: 2, halfZ: 3 }]), false);
});

test('deterministic spawn allocation fits 6, 60 and 300 cars without footprint conflicts at widths 12, 15 and 30', () => {
  for (const width of [12, 15, 30]) {
    const plan = createCityPlan(undefined, { roadWidth: width });
    const graph = createRoadGraph(plan.roadNetwork, Math.min(5.2, width * 0.25));
    const nodes = [...graph.nodes.values()];
    const bounds = { minX: Math.min(...nodes.map(node => node.x)), maxX: Math.max(...nodes.map(node => node.x)),
      minZ: Math.min(...nodes.map(node => node.z)), maxZ: Math.max(...nodes.map(node => node.z)) };
    const slots = distributeTrafficSpawnSlots(createTrafficSpawnSlots(graph.directed), bounds);
    const buildings = plan.buildings.map(building => ({ x: building.x, z: building.z,
      halfX: building.width / 2, halfZ: building.depth / 2 }));
    const occupied = [];
    for (const count of [6, 60, 300]) {
      while (occupied.length < count) {
        const slot = slots.find(candidate => isTrafficSpawnSafe(candidate, occupied, buildings));
        assert.ok(slot, `width ${width} exhausted spawn slots at ${occupied.length}/${count}`);
        occupied.push(slot);
      }
      const ordered = occupied.map(slot => ({ x: slot.x, z: slot.z, heading: slot.heading }));
      assert.equal(new Set(ordered.map(item => `${item.x.toFixed(3)}:${item.z.toFixed(3)}:${item.heading.toFixed(3)}`)).size, count);
      assert.ok(ordered.every((item, index) => buildings.every(building => !footprintsOverlap(item, building, 0.2))
        && ordered.slice(0, index).every(other => !footprintsOverlap(item, other, TRAFFIC_SPAWN.minimumGap))));
      if (count === 60) {
        const sector = (value, min, max) => Math.max(0, Math.min(2, Math.floor((value - min) / (max - min) * 3)));
        const available = Array(9).fill(0), placed = Array(9).fill(0);
        for (const slot of slots) available[sector(slot.z, bounds.minZ, bounds.maxZ) * 3
          + sector(slot.x, bounds.minX, bounds.maxX)]++;
        for (const slot of occupied) placed[sector(slot.z, bounds.minZ, bounds.maxZ) * 3
          + sector(slot.x, bounds.minX, bounds.maxX)]++;
        assert.ok(placed.every(value => value > 0), `width ${width} did not fill every available sector: ${placed}`);
        assert.ok(placed.every((value, index) => Math.abs(value - 60 * available[index] / slots.length)
          <= Math.max(2, 0.25 * 60 * available[index] / slots.length)), `width ${width} missed sector quotas: ${placed}`);
      }
    }
  }
});

test('city-wide spawn slots use every available sector and are deterministic', () => {
  const plan = createCityPlan(), graph = createRoadGraph(plan.roadNetwork);
  const nodes = [...graph.nodes.values()];
  const bounds = { minX: Math.min(...nodes.map(node => node.x)), maxX: Math.max(...nodes.map(node => node.x)),
    minZ: Math.min(...nodes.map(node => node.z)), maxZ: Math.max(...nodes.map(node => node.z)) };
  const all = createTrafficSpawnSlots(graph.directed);
  const distributed = distributeTrafficSpawnSlots(all, bounds);
  assert.equal(distributed.length, all.length);
  assert.deepEqual(distributed, distributeTrafficSpawnSlots(all, bounds));
  const sector = (value, min, max) => Math.max(0, Math.min(2, Math.floor((value - min) / (max - min) * 3)));
  const sectors = new Set(distributed.slice(0, 60).map(slot => `${sector(slot.x, bounds.minX, bounds.maxX)}:${sector(slot.z, bounds.minZ, bounds.maxZ)}`));
  assert.equal(sectors.size, 9);
  assert.equal(distributeTrafficSpawnSlots(all, null).length, all.length);
});
