import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TireSmoke } from '../src/tire-smoke.js';
import { CarDamageEffects } from '../src/car-damage-effects.js';

const camera = new THREE.PerspectiveCamera();

test('tire smoke draws only living particles, keeps slot order and stops empty uploads', () => {
  const smoke = new TireSmoke(new THREE.Scene(), { capacity: 4 });
  for (let i = 0; i < 4; i++) smoke.emit({ x: i * 10, y: 0, z: 0 });
  smoke.particles[0].life = smoke.particles[2].life = .01;
  smoke.update(.02, camera);
  assert.equal(smoke.mesh.count, 2);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 2; i++) {
    smoke.mesh.getMatrixAt(i, matrix);
    assert.ok(Math.abs(matrix.elements[12] - smoke.particles[i * 2 + 1].x) < 1e-5);
    assert.ok(smoke.alpha.getX(i) > 0);
  }
  smoke.update(10, camera);
  assert.equal(smoke.mesh.count, 0);
  assert.equal(smoke.mesh.visible, false);
  const version = smoke.mesh.instanceMatrix.version;
  smoke.update(.02, camera);
  assert.equal(smoke.mesh.instanceMatrix.version, version);
  smoke.emit({ x: 100, y: 0, z: 0 });
  smoke.update(.02, camera);
  assert.equal(smoke.mesh.count, 1);
  smoke.reset();
  assert.equal(smoke.mesh.count, 0);
  smoke.dispose();
});

test('damage particles preserve sparse slot order, expire and restart after reset', () => {
  const effects = new CarDamageEffects(new THREE.Scene());
  const pool = effects.smokePool;
  pool.emit(new THREE.Vector3(10, 0, 0), 'smoke', .4);
  pool.emit(new THREE.Vector3(20, 0, 0), 'smoke', .6);
  pool.particles[0].life = .01;
  assert.equal(pool.update(.02, camera, pool.capacity), 1);
  assert.equal(pool.mesh.count, 1);
  const matrix = new THREE.Matrix4();
  pool.mesh.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[12] - pool.particles[1].position.x) < 1e-5);
  assert.ok(pool.alpha.getX(0) > 0);
  assert.equal(pool.update(10, camera, pool.capacity), 0);
  const versions = [pool.mesh.instanceMatrix.version, pool.mesh.instanceColor.version, pool.alpha.version];
  pool.update(.02, camera, pool.capacity);
  assert.deepEqual([pool.mesh.instanceMatrix.version, pool.mesh.instanceColor.version, pool.alpha.version], versions);
  effects.reset();
  assert.equal(pool.mesh.count, 0);
  pool.emit(new THREE.Vector3(), 'smoke', 0);
  assert.equal(pool.update(.02, camera, pool.capacity), 1);
  effects.dispose();
});
