import test from 'node:test';
import assert from 'node:assert/strict';
import { occludedBuildingIds, segmentIntersectsAabb, distanceToBuildingXZ, proximityVisibility, smoothBuildingOpacity, BuildingOcclusion } from '../src/building-occlusion.js';
import * as THREE from 'three';

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

test('proximity measures distance to a wide facade and corner, ignoring height', () => {
  const bounds = { min: { x: 0, z: 0 }, max: { x: 100, z: 20 } };
  assert.equal(distanceToBuildingXZ({ x: 50, y: 100, z: -2 }, bounds), 2);
  assert.equal(distanceToBuildingXZ({ x: -3, z: -4 }, bounds), 5);
  assert.equal(distanceToBuildingXZ({ x: 50, z: 10 }, bounds), 0);
});
test('near state has independent 6/8m hysteresis and a continuous 2..6m fade', () => {
  assert.equal(proximityVisibility(6).near, false);
  assert.equal(proximityVisibility(5.99).near, true);
  assert.equal(proximityVisibility(7, true).near, true);
  assert.equal(proximityVisibility(8, true).near, false);
  assert.equal(proximityVisibility(2).opacity, .22);
  assert.ok(Math.abs(proximityVisibility(4).opacity - .61) < 1e-9);
  assert.equal(proximityVisibility(6, true).opacity, 1);
});
test('fade smoothing has equal results at 30/60/120fps', () => {
  for (const [start, target] of [[1, .22], [.22, 1]]) {
    const results = [30, 60, 120].map(fps => {
      let opacity = start;
      for (let i = 0; i < fps; i++) opacity = smoothBuildingOpacity(opacity, target, 1 / fps);
      return opacity;
    });
    assert.ok(Math.max(...results) - Math.min(...results) < 1e-12);
  }
});
test('near-only fade precedes occlusion, then returns instances and landmark caps', () => {
  const geometry = new THREE.BoxGeometry(), scene = new THREE.Scene();
  const instanced = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial(), 1);
  const cap = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); cap.position.set(5, 9, 0);
  const entry = { ...box, index: 0, x: 5, z: 0, height: 8, width: 2, depth: 2, opacity: 1, caps: [cap], color: '#888888' };
  const fade = new BuildingOcclusion(THREE, scene, instanced, geometry, [entry]);
  const camera = new THREE.PerspectiveCamera(), car = new THREE.Group();
  car.position.set(5, 0, -6); camera.position.set(5, 3, -10);
  for (let i = 0; i < 120; i++) fade.update(camera, car, 1 / 60);
  assert.equal(entry.wasOccluded, undefined); assert.equal(entry.nearCar, true);
  assert.ok(entry.opacity < 1); assert.ok(entry.proxy); assert.equal(cap.visible, false);
  car.position.set(20, 0, 0); camera.position.set(0, 3, 0);
  for (let i = 0; i < 120; i++) fade.update(camera, car, 1 / 60);
  assert.ok(Math.abs(entry.opacity - .22) < .001); assert.equal(entry.nearCar, false);
  car.position.set(20, 0, -20); camera.position.set(20, 3, -25);
  for (let i = 0; i < 180; i++) fade.update(camera, car, 1 / 60);
  assert.equal(entry.opacity, 1); assert.equal(entry.proxy, null); assert.equal(cap.visible, true);
  fade.dispose(); geometry.dispose(); instanced.material.dispose(); cap.material.dispose();
});
