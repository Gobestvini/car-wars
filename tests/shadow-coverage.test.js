import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { updateShadowCoverage } from '../src/shadow-coverage.js';
import { ART_LIGHT } from '../src/art-direction.js';

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

test('current art sun covers road receivers and high casters after camera and city translations', () => {
  for (const aspect of [390/844,1440/900]) for (const resolution of [512,1024]) for (const distance of [1,2]) {
    const {light,camera}=setup();
    camera.aspect=aspect;camera.updateProjectionMatrix();
    const target=new THREE.Vector3(-78,0,-65);
    camera.position.set(12,20,-17).multiplyScalar(distance*1.4).add(target);
    camera.lookAt(target);camera.updateMatrixWorld(true);
    light.target.position.copy(target);light.position.copy(target).add(new THREE.Vector3(...ART_LIGHT.offset));
    updateShadowCoverage(light,camera,{resolution,casterHeight:24});
    light.shadow.updateMatrices(light);
    for(const x of [-1,1]) for(const y of [-1,1]) {
      const ray=new THREE.Vector3(x,y,.5).unproject(camera).sub(camera.position).normalize();
      const ground=camera.position.clone().addScaledVector(ray,-camera.position.y/ray.y);
      for(const height of [0,24]) {
        const p=ground.clone();p.y=height;p.project(light.shadow.camera);
        assert.ok(Math.abs(p.x)<=1.01 && Math.abs(p.y)<=1.01,`shadow plane clips receiver/caster: ${p.toArray()}`);
        assert.ok(p.z>=-1.01 && p.z<=1.01,`shadow depth clips receiver/caster: ${p.toArray()}`);
      }
    }
  }
});
