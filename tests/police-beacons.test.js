import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { beaconPulse, beaconAngle, BEACON_PERIOD, BEACON_RADIUS, createPoliceBeaconAssets } from '../src/police-beacons.js';
import { createTrafficAssets, makeTrafficCar } from '../src/vehicle-visuals.js';

test('rotor beacons sweep slowly with broad smooth peaks, no hard blackouts and stable time', () => {
  assert.equal(beaconPulse(0),1);assert.equal(beaconPulse(BEACON_PERIOD/2,1),1);
  assert.ok(Math.abs(beaconPulse(BEACON_PERIOD/2)-.16)<1e-10);
  let broad=0;
  for (let frame=0;frame<120;frame++) for (const color of [0,1]) {
    const t=frame/60;
    assert.ok(Math.abs(beaconPulse(t,color)-beaconPulse(t+BEACON_PERIOD*10,color))<1e-10);
    assert.ok(beaconPulse(t,color)>=.16&&beaconPulse(t,color)<=1);
    assert.ok(Math.abs(beaconPulse(t+1/60,color)-beaconPulse(t,color))<.065,'no abrupt flash between frames');
    if(color===0&&t<BEACON_PERIOD&&beaconPulse(t,color)>.5)broad++;
    if(frame%2===0) assert.equal(beaconPulse(t,color),beaconPulse(frame/2/30,color));
  }
  assert.ok(broad>30,'bright sweep lasts more than half a second');
  assert.ok(Math.abs(beaconAngle(BEACON_PERIOD/4)-Math.PI/2)<1e-10);
  assert.ok(Math.abs(beaconAngle(BEACON_PERIOD/2)-Math.PI)<1e-10);
  assert.ok(Math.abs(beaconAngle(BEACON_PERIOD))<1e-10);
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
  assets.animate(.03,'low'); assert.equal(volumes[0].material.uniforms.pulse.value,beaconPulse(.03));
  assert.equal(volumes[1].material.uniforms.pulse.value,beaconPulse(.03,1));
  assert.equal(volumes[0].material.uniforms.angle.value,beaconAngle(.03));
  const before=volumes[0].material.uniforms.angle.value;
  assets.animate(.03+BEACON_PERIOD/4,'high');
  assert.ok(Math.abs(volumes[0].material.uniforms.angle.value-before-Math.PI/2)<1e-10);
  assets.animate(.03,'low');
  assert.equal(volumes[0].material.uniforms.samples.value,8);
  let disposed=0; volumes[0].geometry.addEventListener('dispose',()=>disposed++);
  a.removeFromParent(); assert.equal(disposed,0);
  assets.dispose(); assert.equal(disposed,1);
});
