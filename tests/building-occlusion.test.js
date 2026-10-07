import test from 'node:test';
import assert from 'node:assert/strict';
import { occludedBuildingIds, segmentIntersectsAabb, smoothBuildingOpacity, BuildingOcclusion } from '../src/building-occlusion.js';
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
test('nearby clear buildings stay opaque; actual blockers fade and restore as a whole', () => {
  const geometry = new THREE.BoxGeometry(), scene = new THREE.Scene();
  const instanced = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial(), 1);
  const cap = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); cap.position.set(5, 9, 0);
  const entry = { ...box, index: 0, x: 5, z: 0, height: 8, width: 2, depth: 2, opacity: 1, caps: [cap], color: '#888888' };
  const fade = new BuildingOcclusion(THREE, scene, instanced, geometry, [entry]);
  const camera = new THREE.PerspectiveCamera(), car = new THREE.Group();
  car.position.set(5, 0, -6); camera.position.set(5, 3, -10);
  for (let i = 0; i < 120; i++) fade.update(camera, car, 1 / 60);
  assert.equal(entry.wasOccluded, undefined);
  assert.equal(entry.opacity, 1); assert.equal(entry.proxy, undefined); assert.equal(cap.visible, true);
  car.position.set(20, 0, 0); camera.position.set(0, 3, 0);
  for (let i = 0; i < 120; i++) fade.update(camera, car, 1 / 60);
  assert.ok(Math.abs(entry.opacity - .22) < .001);
  assert.equal(cap.visible, false);
  const depth = entry.proxy.children.find(child => child.userData.buildingDepth);
  assert.ok(depth.material.colorWrite === false && depth.material.depthWrite);
  for (const surface of entry.proxy.children.filter(child => child !== depth)) {
    assert.equal(surface.material.opacity, entry.opacity);
    assert.ok(surface.renderOrder > depth.renderOrder);
  }
  car.position.set(20, 0, -20); camera.position.set(20, 3, -25);
  for (let i = 0; i < 180; i++) fade.update(camera, car, 1 / 60);
  assert.equal(entry.opacity, 1); assert.equal(entry.proxy, null); assert.equal(cap.visible, true);
  fade.dispose(); geometry.dispose(); instanced.material.dispose(); cap.material.dispose();
});
