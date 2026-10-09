import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TireSmoke, TIRE_SMOKE_CONFIG, tireSmokeAlpha, tireSmokeIntensity } from '../src/tire-smoke.js';

const wheel = (overrides = {}) => ({ grounded: true, detached: false, longitudinal: 18, lateral: 12,
  contact: { x: 0, y: 0.15, z: 0 }, ...overrides });

test('tire smoke requires a stronger grounded slip than ordinary track skidding', () => {
  assert.ok(tireSmokeIntensity(wheel()) > 0);
  assert.equal(tireSmokeIntensity(wheel({ longitudinal: 0, lateral: 0 })), 0);
  assert.equal(tireSmokeIntensity(wheel({ grounded: false })), 0);
  assert.equal(tireSmokeIntensity(wheel({ detached: true })), 0);
  assert.equal(tireSmokeIntensity(wheel({ lateral: NaN })), 0);
  assert.equal(tireSmokeIntensity(wheel({ contact: { x: Infinity, y: 0, z: 0 } })), 0);
});

test('cloud particles fade in alpha while growing instead of shrinking into points', () => {
  assert.equal(tireSmokeAlpha(0), 0);
  assert.ok(tireSmokeAlpha(.06) > 0 && tireSmokeAlpha(.06) < 1);
  assert.equal(tireSmokeAlpha(.12), 1);
  assert.ok(tireSmokeAlpha(.75) > 0 && tireSmokeAlpha(.75) < 1);
  assert.equal(tireSmokeAlpha(1), 0);
  const smoke = new TireSmoke(new THREE.Scene(), { capacity: 2, seed: 1 });
  smoke.emit({ x: 0, y: 0, z: 0 });
  const base = smoke.particles[0].size;
  smoke.update(.2, new THREE.PerspectiveCamera());
  const earlyAlpha = smoke.alpha.getX(0), earlyMatrix = new THREE.Matrix4();
  smoke.mesh.getMatrixAt(0, earlyMatrix);
  smoke.update(.3, new THREE.PerspectiveCamera());
  const lateAlpha = smoke.alpha.getX(0), lateMatrix = new THREE.Matrix4();
  smoke.mesh.getMatrixAt(0, lateMatrix);
  assert.ok(earlyAlpha > 0 && lateAlpha > 0);
  assert.ok(lateMatrix.elements[0] > earlyMatrix.elements[0]);
  assert.ok(earlyMatrix.elements[0] > base);
  smoke.reset();
  assert.equal(smoke.alpha.getX(0), 0);
  smoke.dispose();
});

test('emitters confirm slip, honor role/distance budgets, and retain particles when sources vanish', () => {
  const scene = new THREE.Scene(), smoke = new TireSmoke(scene);
  const wheels = Array.from({ length: 4 }, () => wheel());
  for (let i = 0; i < 72; i++) smoke.sample([{ id: 'player', role: 'player', wheels },
    { id: 'cop', role: 'police', wheels, x: 5, z: 0 }, { id: 'civ', role: 'civilian', wheels, x: 8, z: 0 }], 1 / 120,
  { quality: 'high', cameraPosition: { x: 0, y: 5, z: 0 } });
  assert.equal(smoke.snapshot().emitters, 3);
  assert.ok(smoke.activeCount > 0);
  assert.equal(smoke.snapshot().highWater, smoke.activeCount);
  const extant = smoke.activeCount;
  smoke.sample([], 1 / 120);
  assert.equal(smoke.activeCount, extant);
  assert.equal(smoke.snapshot().emitters, 0);
  smoke.reset();
  assert.equal(smoke.activeCount, 0);
  smoke.dispose();
});

test('low quality and invalid/distant emitters stay within fixed particle budgets', () => {
  const smoke = new TireSmoke(new THREE.Scene(), { capacity: 512 });
  const wheels = Array.from({ length: 4 }, () => wheel());
  const sources = Array.from({ length: 30 }, (_, index) => ({ id: `npc-${index}`, role: 'civilian', wheels, x: index, z: 0 }));
  for (let i = 0; i < 240; i++) smoke.sample(sources, 1 / 120,
    { quality: 'low', cameraPosition: { x: 0, y: 0, z: 0 } });
  const stats = smoke.update(0, null, { quality: 'low' });
  assert.ok(stats.active <= TIRE_SMOKE_CONFIG.lowCapacity);
  assert.ok(stats.sourceCount <= TIRE_SMOKE_CONFIG.lowSources);
  assert.ok(smoke.particles.length <= 512);
  smoke.dispose();
});
