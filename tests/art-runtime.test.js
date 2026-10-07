import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCityPlan } from '../src/city-generator.js';
import { createCityScene } from '../src/city-scene.js';
import { buildingArt } from '../src/art-direction.js';
import { createTrafficAssets, makeTrafficCar } from '../src/vehicle-visuals.js';

test('art variation never mutates the plan or physical city dimensions',()=>{
  const plan=createCityPlan(), before=JSON.stringify(plan), physical=[];
  const city=createCityScene(new THREE.Scene(),{addStaticBox: spec=>{physical.push(spec);return spec;},removeStaticBox(){}},plan);
  assert.equal(JSON.stringify(plan),before);
  assert.deepEqual(new Set(city.entries.map(e=>e.artFamily)),new Set([0,1,2]));
  assert.deepEqual(new Set(city.entries.map(e=>e.artDistrict)),new Set([0,1,2]));
  for(let i=0;i<plan.buildings.length;i++) {
    const b=plan.buildings[i];assert.equal(physical[i].halfX,b.width/2);assert.equal(physical[i].halfY,b.height/2);
    assert.deepEqual(buildingArt(b,plan.seed),buildingArt(b,plan.seed));
  }
  city.dispose();
});

test('batched decoration fades with its building and returns after fade; low hides optional proxies',()=>{
  const plan=createCityPlan(),scene=new THREE.Scene();
  const city=createCityScene(scene,{addStaticBox: spec=>spec,removeStaticBox(){}},plan);
  const entry=city.entries[0];
  city.occlusion.startProxy(entry,entry.caps);
  const matrix=new THREE.Matrix4();
  const plinth=city.group.getObjectByName('Building plinths');
  plinth.getMatrixAt(entry.index,matrix);assert.equal(matrix.elements[0],0);
  assert.equal(entry.proxy.children.filter(c=>c.userData.roofDetail).length,1);
  city.updateSignals({phase:()=>({color:'red'})},0,null,'low');
  assert.equal(entry.proxy.children.find(c=>c.userData.roofDetail).visible,false);
  let disposed=0;
  entry.proxy.children.forEach(c=>c.material.addEventListener('dispose',()=>disposed++));
  const expected=entry.proxy.children.length;
  city.occlusion.finishProxy(entry,entry.caps);
  assert.equal(disposed,expected);assert.equal(entry.proxy,null);
  plinth.getMatrixAt(entry.index,matrix);assert.ok(matrix.elements[0]>0);
  city.dispose();assert.equal(scene.children.length,0);
});

test('traffic art reuses geometry and stays inside its original collision footprint',()=>{
  const assets=createTrafficAssets();
  const cars=[makeTrafficCar(THREE,assets,0),makeTrafficCar(THREE,assets,6),makeTrafficCar(THREE,assets,1),makeTrafficCar(THREE,assets,0,'police')];
  assert.equal(cars[0].children[0].geometry,cars[1].children[0].geometry);
  assert.equal(cars[0].children.length,1);assert.equal(cars[3].children.length,3);
  for(const car of cars) {
    const bounds=new THREE.Box3().setFromObject(car);
    assert.ok(bounds.max.x<=1.01 && bounds.min.x>=-1.01);
    assert.ok(bounds.max.z<=1.94 && bounds.min.z>=-1.94);
  }
  assets.animate(1);assets.dispose();
});
