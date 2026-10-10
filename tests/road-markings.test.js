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
