import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { preparePlayerModel, PLAYER_WHEEL_NAMES } from '../src/player-model.js';
import { CarDeformation } from '../src/car-deformation.js';
import { CarSimulation } from '../src/vehicle.js';

async function loadAsset() {
  const bytes = await readFile(new URL('../public/models/player-sedan.glb', import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return preparePlayerModel((await new GLTFLoader().parseAsync(data, '')).scene);
}

test('authored GLB fits simulation mounts, uses five single-material meshes and no textures', async () => {
  const { model, body, wheels } = await loadAsset();
  const sim = new CarSimulation();
  const meshes = [body, ...wheels];
  assert.equal(model.children.length, 5);
  assert.deepEqual(wheels.map(wheel => wheel.name), PLAYER_WHEEL_NAMES);
  assert.equal(new Set(meshes.map(mesh => mesh.material)).size, 1);
  let triangles = 0;
  for (const mesh of meshes) {
    assert.ok(!Array.isArray(mesh.material));
    assert.equal(mesh.material.map, null);
    assert.equal(mesh.material.vertexColors, true);
    assert.equal(mesh.material.side, THREE.FrontSide);
    assert.ok(mesh.geometry.attributes.color);
    assert.ok(mesh.geometry.attributes.normal.array.every(Number.isFinite));
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    assert.deepEqual(mesh.scale.toArray(), [1, 1, 1]);
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
  }
  assert.ok(triangles <= 2500, `Triangle budget: ${triangles}`);
  body.geometry.computeBoundingBox();
  const bounds = body.geometry.boundingBox;
  assert.ok(bounds.min.z >= -2.18 && bounds.max.z <= 2.18);
  assert.ok(bounds.max.y <= .90 && bounds.min.y >= -.48);
  assert.ok(bounds.max.x <= 1.06 && bounds.min.x >= -1.06);
  for (const [i, wheel] of wheels.entries()) {
    assert.ok(Math.abs(wheel.position.x - sim.wheels[i].mount.x) < 1e-5);
    assert.ok(Math.abs(wheel.position.z - sim.wheels[i].mount.z) < 1e-5);
    wheel.geometry.computeBoundingBox();
    const size = wheel.geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y / 2 - sim.wheels[i].radius) < 1e-5);
    assert.ok(Math.abs(size.z / 2 - sim.wheels[i].radius) < 1e-5);
    assert.ok(size.x <= .32);
    assert.ok(wheel.geometry.boundingBox.getCenter(new THREE.Vector3()).length() < 1e-5);
  }
});

test('authored body has local impact geometry and restores exact positions and normals', async () => {
  const { body, wheels } = await loadAsset();
  const geometry = body.geometry;
  const before = geometry.attributes.position.array.slice();
  const normals = geometry.attributes.normal.array.slice();
  const wheelBefore = wheels.map(wheel => wheel.geometry.attributes.position.array.slice());
  const deformation = new CarDeformation(geometry, body.matrixWorld);
  deformation.apply([{ point: { x: .6, y: .1, z: 2.07 }, normal: { x: 0, y: 0, z: -1 },
    impact: { depth: .22, radius: .8 } }]);
  assert.ok(geometry.attributes.position.array.some((value, i) => Math.abs(value - before[i]) > .01));
  assert.ok(geometry.attributes.position.array.every(Number.isFinite));
  for (const [i, wheel] of wheels.entries()) assert.deepEqual(wheel.geometry.attributes.position.array, wheelBefore[i]);
  deformation.restore();
  assert.deepEqual(geometry.attributes.position.array, before);
  assert.deepEqual(geometry.attributes.normal.array, normals);
});
