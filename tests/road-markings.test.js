import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoadMarkings } from '../src/road-markings.js';
import * as THREE from 'three';
import { createCityPlan } from '../src/city-generator.js';
import { createCityScene } from '../src/city-scene.js';
import { createSurfaceHeightSampler, ROAD_SURFACE_HEIGHTS } from '../src/road-surface.js';

test('dashes align their long axis with both directions of the street grid', () => {
  const marks = createRoadMarkings([-75, -25, 25, 75], 110, 22);
  const alongZ = marks.find(mark => mark.axis === 'z');
  const alongX = marks.find(mark => mark.axis === 'x');
  assert.ok(alongZ && alongX);
  assert.equal(alongZ.yaw, 0);
  assert.equal(alongX.yaw, Math.PI / 2);

  const localLongAxis = [0, 1]; // local X/Z projection of the dash's local +Z axis
  const worldZ = [Math.sin(alongZ.yaw), Math.cos(alongZ.yaw)];
  const worldX = [Math.sin(alongX.yaw), Math.cos(alongX.yaw)];
  assert.ok(Math.abs(worldZ[1]) > Math.abs(worldZ[0]));
  assert.ok(Math.abs(worldX[0]) > Math.abs(worldX[1]));
  assert.deepEqual(localLongAxis, [0, 1]);
});

test('mark spacing, bounds, and junction gaps derive from the current road plan', () => {
  const roads = [-75, -25, 25, 75];
  const marks = createRoadMarkings(roads, 110, 20);
  assert.ok(marks.length > 0);
  assert.ok(marks.every(mark => Math.abs(mark.x) <= 104 && Math.abs(mark.z) <= 104));
  for (const mark of marks) {
    const offset = mark.axis === 'z' ? mark.z : mark.x;
    assert.ok(roads.every(cross => Math.abs(offset - cross) >= 13), `junction gap at ${offset}`);
  }
  assert.notEqual(marks.length, createRoadMarkings(roads, 80, 20).length);
});

test('real-city solids reach controlled stop planes on both axes without overlapping dashes or junctions', () => {
  for (const roadWidth of [12, 15, 30]) {
    const plan = createCityPlan(5, { roadWidth });
    const before = JSON.stringify(plan);
    const marks = createRoadMarkings(plan, plan.bounds, roadWidth);
    const degree = id => plan.roadNetwork.edges.filter(e => e.from === id || e.to === id).length;
    assert.ok(marks.some(m => m.kind === 'dash'));
    for (const axis of ['x', 'z']) assert.ok(marks.some(m => m.kind === 'solid' && m.axis === axis));
    for (const { from, to } of plan.roadSegments) {
      const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
      const intervals = marks.filter(m => dx ? Math.abs(m.z - from.z) < 1e-8 && m.axis === 'x'
        : Math.abs(m.x - from.x) < 1e-8 && m.axis === 'z').map(m => {
        const along = ((m.x - from.x) * dx + (m.z - from.z) * dz) / length;
        return { min: along - m.length / 2, max: along + m.length / 2, kind: m.kind };
      }).filter(m => m.min > 0 && m.max < length).sort((a, b) => a.min - b.min);
      for (let i = 0; i < intervals.length; i++) {
        assert.ok(intervals[i].min >= roadWidth / 2 + 1.5 - 1e-8);
        assert.ok(intervals[i].max <= length - roadWidth / 2 - 1.5 + 1e-8);
        if (i) assert.ok(intervals[i].min >= intervals[i - 1].max - 1e-8, 'no overlapping paint');
      }
      const solids = intervals.filter(m => m.kind === 'solid');
      if (degree(from.id) >= 4 && degree(to.id) >= 4 && length - roadWidth - 3 <= 24) {
        assert.equal(solids.length, 1);
        assert.ok(Math.abs(solids[0].min - (roadWidth / 2 + 1.5)) < 1e-8);
        assert.ok(Math.abs(solids[0].max - (length - roadWidth / 2 - 1.5)) < 1e-8);
        continue;
      }
      assert.equal(solids.length, Number(degree(from.id) >= 4) + Number(degree(to.id) >= 4));
      if (degree(from.id) >= 4) {
        assert.ok(Math.abs(solids[0].min - (roadWidth / 2 + 1.5)) < 1e-8);
        assert.ok(Math.abs(solids[0].max - solids[0].min - 12) < 1e-8);
      }
      if (degree(to.id) >= 4) {
        const last = solids.at(-1);
        assert.ok(Math.abs(last.max - (length - roadWidth / 2 - 1.5)) < 1e-8);
        assert.ok(Math.abs(last.max - last.min - 12) < 1e-8);
      }
    }
    assert.equal(JSON.stringify(plan), before, 'paint does not mutate routing or city layout');
  }
});

test('short controlled segments merge solid intervals; uncontrolled and degenerate segments stay safe', () => {
  const fixture = (length, controlled = true) => ({
    roadSegments: [{ from: { id: 'a', x: 0, z: 0 }, to: { id: 'b', x: 0, z: length } }],
    roadNetwork: { edges: [{ from: 'a', to: 'b' }, ...(controlled ? ['a', 'b'].flatMap(from =>
      [1, 2, 3].map(i => ({ from, to: `${from}${i}` }))) : [])] },
  });
  const merged = createRoadMarkings(fixture(35), 100, 15);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].kind, 'solid');
  assert.equal(merged[0].z, 17.5);
  assert.equal(merged[0].length, 17);
  assert.deepEqual(createRoadMarkings(fixture(18), 100, 15), []);
  assert.deepEqual(createRoadMarkings(fixture(0), 100, 15), []);
  assert.ok(createRoadMarkings(fixture(50, false), 100, 15).every(m => m.kind === 'dash' && Math.abs(m.length - 2.2) < 1e-8));
});

test('both paint batches receive shadows below continuous tire decals in either road direction', () => {
  const plan = createCityPlan(), sample = createSurfaceHeightSampler(plan);
  const city = createCityScene(new THREE.Scene(), { addStaticBox: s => s, removeStaticBox() {} }, plan);
  for (const batch of [city.dashes, city.stopLines]) {
    assert.ok(batch.receiveShadow && batch.material.depthTest);
    const transform = new THREE.Matrix4();
    for (let i = 0; i < batch.count; i++) {
      batch.getMatrixAt(i, transform);
      const vertex = new THREE.Vector3();
      for (let v = 0; v < batch.geometry.attributes.position.count; v++) {
        vertex.fromBufferAttribute(batch.geometry.attributes.position, v).applyMatrix4(transform);
        assert.ok(vertex.y > ROAD_SURFACE_HEIGHTS.road);
        assert.ok(vertex.y < sample(vertex.x, vertex.z));
      }
      const x = transform.elements[12], z = transform.elements[14];
      // Crossing paint does not raise the strip or change its sampled surface.
      assert.equal(sample(x, z), sample(x + .3, z));
      assert.equal(sample(x, z), sample(x, z + .3));
    }
  }
  assert.ok(sample(-66.5, -5) > ROAD_SURFACE_HEIGHTS.sidewalkVisual);
  city.dispose();
});
