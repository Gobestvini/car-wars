import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { updateShadowCoverage } from '../src/shadow-coverage.js';

function setup() {
  const light = new THREE.DirectionalLight();
  light.position.set(-14, 24, 10);
  light.target.position.set(0, 0, 0);
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera = new THREE.OrthographicCamera(-16, 16, 16, -16, 1, 70);
  const camera = new THREE.PerspectiveCamera(38, 1.5, 0.1, 200);
  camera.position.set(12, 20, -17);
  camera.lookAt(0, 0.5, 0);
  camera.updateMatrixWorld(true);
  return { light, camera };
}

test('shadow coverage contains the visible ground footprint plus caster margin', () => {
  const { light, camera } = setup();
  const coverage = updateShadowCoverage(light, camera);
  assert.equal(coverage.frustumCorners, 4);
  assert.ok(coverage.width > 32 && coverage.height > 32);
  assert.ok(coverage.margin >= 16);
  assert.ok(coverage.far > 24 && Number.isFinite(coverage.far));
  assert.ok(light.shadow.camera.right > light.shadow.camera.left);
  assert.ok(light.shadow.camera.top > light.shadow.camera.bottom);
});

test('shadow centre snaps to stable world-space texels as the camera moves', () => {
  const { light, camera } = setup();
  const first = { ...updateShadowCoverage(light, camera) };
  camera.position.x += 0.0001;
  camera.updateMatrixWorld(true);
  const subTexel = { ...updateShadowCoverage(light, camera) };
  assert.equal(subTexel.centreX, first.centreX);
  assert.equal(subTexel.centreY, first.centreY);
  camera.position.x += 100;
  camera.updateMatrixWorld(true);
  const moved = { ...updateShadowCoverage(light, camera) };
  assert.ok(moved.centreX > first.centreX + 50);
  assert.ok(Number.isFinite(moved.far));
});
