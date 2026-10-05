import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarDeformation } from '../src/car-deformation.js';

test('deformation is local in metres across rotated nonuniform transforms and restores exactly', () => {
  const geometry = new THREE.BufferGeometry();
  const original = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]);
  geometry.setAttribute('position', new THREE.BufferAttribute(original.slice(), 3));
  geometry.setIndex([0, 1, 2, 3, 2, 1]); geometry.computeVertexNormals();
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(2, 0.2, 1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.37, 0)), new THREE.Vector3(1.25, 1.15, 4.45));
  const deformation = new CarDeformation(geometry, matrix);
  const point = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix);
  const event = { point: { x: point.x, y: point.y, z: point.z }, normal: { x: 0, y: 0, z: -1 }, impact: { radius: 0.72, depth: 0.12 } };
  deformation.apply([event]);
  const positions = geometry.getAttribute('position');
  const movedA = new THREE.Vector3().fromBufferAttribute(positions, 0).applyMatrix4(matrix);
  const movedDuplicate = new THREE.Vector3().fromBufferAttribute(positions, 3).applyMatrix4(matrix);
  const unchanged = new THREE.Vector3().fromBufferAttribute(positions, 1).applyMatrix4(matrix);
  assert.ok(movedA.distanceTo(point) > 0.1);
  assert.ok(movedA.distanceTo(movedDuplicate) < 1e-5);
  assert.ok(unchanged.distanceTo(new THREE.Vector3(1, 0, 0).applyMatrix4(matrix)) < 1e-5);
  assert.ok(positions.array.every(Number.isFinite));
  deformation.apply([{ ...event, impact: { radius: 0.72, depth: 0.2 } }, { ...event, impact: { radius: 0.72, depth: 0.2 } }]);
  const capped = new THREE.Vector3().fromBufferAttribute(positions, 0).applyMatrix4(matrix);
  assert.ok(capped.distanceTo(point) <= 0.3001);
  deformation.restore();
  assert.deepEqual(Array.from(positions.array), Array.from(original));
});
