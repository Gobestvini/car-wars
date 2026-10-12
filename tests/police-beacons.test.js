import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { beaconPulse, BEACON_RADIUS, createPoliceBeaconAssets } from '../src/police-beacons.js';
import { createTrafficAssets, makeTrafficCar } from '../src/vehicle-visuals.js';

test('alternating double pulses have dark gaps, continuous time and periodicity', () => {
  for (const t of [.03,.17]) { assert.equal(beaconPulse(t),1); assert.equal(beaconPulse(t,1),0); }
  for (const t of [.43,.57]) { assert.equal(beaconPulse(t,1),1); assert.equal(beaconPulse(t),0); }
  for (const t of [.1,.3,.5,.7]) assert.equal(beaconPulse(t),0);
  for (let frame=0;frame<120;frame++) for (const color of [0,1]) {
    const t=frame/60;
    assert.ok(Math.abs(beaconPulse(t,color)-beaconPulse(t+8,color))<1e-10);
    if(frame%2===0) assert.equal(beaconPulse(t,color),beaconPulse(frame/2/30,color));
  }
  assert.equal(beaconPulse(.1),0); assert.equal(beaconPulse(.17),1);
  assert.equal(beaconPulse(NaN),0);
});
test('pooled cars share bounded volumes and dispose the asset owner once', () => {
  const assets=createTrafficAssets();
  const a=makeTrafficCar(THREE,assets,0,'police'),b=makeTrafficCar(THREE,assets,1,'police');
  const volumes=a.children.filter(node=>node.name.includes('scattering'));
  assert.equal(volumes.length,2);
  assert.equal(volumes[0].geometry,b.children.find(node=>node.name.includes('scattering')).geometry);
  assert.ok(BEACON_RADIUS<=4);
  for(const mesh of volumes) {
    const position=mesh.geometry.attributes.position;
    for(let i=0;i<position.count;i++) assert.ok(new THREE.Vector3().fromBufferAttribute(position,i).multiply(mesh.scale).length()<=4);
  }
  assets.animate(.03,'low'); assert.equal(volumes[0].material.uniforms.pulse.value,1);
  assert.equal(volumes[1].material.uniforms.pulse.value,0);
  assert.equal(volumes[0].material.uniforms.samples.value,8);
  let disposed=0; volumes[0].geometry.addEventListener('dispose',()=>disposed++);
  a.removeFromParent(); assert.equal(disposed,0);
  assets.dispose(); assert.equal(disposed,1);
});
