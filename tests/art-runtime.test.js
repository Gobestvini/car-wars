import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCityPlan } from '../src/city-generator.js';
import { createCityScene } from '../src/city-scene.js';
import { buildingArt } from '../src/art-direction.js';
import { createTrafficAssets, makeTrafficCar } from '../src/vehicle-visuals.js';
import { createSurfaceHeightSampler } from '../src/road-surface.js';

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
  const entry=city.entries.find(e=>e.artFamily===1);
  city.occlusion.startProxy(entry,entry.caps);
  const matrix=new THREE.Matrix4();
  const plinth=city.group.getObjectByName('Building plinths');
  plinth.getMatrixAt(entry.index,matrix);assert.ok(matrix.elements[0]>0);
  assert.equal(entry.proxy.children.filter(c=>c.userData.roofDetail).length,1);
  const depth=entry.proxy.children.find(c=>c.userData.buildingDepth);
  const highCount=depth.geometry.index.count; let depthDisposed=0;
  depth.geometry.addEventListener('dispose',()=>depthDisposed++);
  city.updateSignals({phase:()=>({color:'red'})},0,null,'low');
  assert.equal(depthDisposed,1); assert.equal(highCount-depth.geometry.index.count,36);
  for(const e of city.entries) {
    const plant=e.art.parts.find(p=>p.batch===5);
    assert.equal(Boolean(plant),e.artFamily===1);
    if(plant) {
      const bounds=new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5)).applyMatrix4(plant.matrix);
      assert.ok(Math.abs(bounds.min.y-(e.height+.2))<1e-6);
    }
  }
  assert.equal(entry.proxy.children.find(c=>c.userData.roofDetail).visible,false);
  let geometryDisposed=0;
  entry.proxy.children.forEach(c=>c.geometry.addEventListener('dispose',()=>geometryDisposed++));
  let disposed=0;
  entry.proxy.children.forEach(c=>c.material.addEventListener('dispose',()=>disposed++));
  const expected=entry.proxy.children.length;
  city.occlusion.finishProxy(entry,entry.caps);
  assert.equal(disposed,expected);assert.equal(geometryDisposed,expected);assert.equal(entry.proxy,null);
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

test('varied street trees connect to their trunks, use four batches, protect the car and dispose',()=>{
  const scene=new THREE.Scene(),removed=[];
  const city=createCityScene(scene,{addStaticBox:spec=>spec,removeStaticBox:body=>removed.push(body)},createCityPlan());
  const {trees}=city;
  assert.ok(trees.count>=192 && trees.count<=320);
  assert.equal(trees.trunks.count,trees.count);
  assert.equal(trees.crownBatches.length,3);
  assert.equal(trees.crownBatches.reduce((sum,batch)=>sum+batch.count,0),trees.count);
  const treeMeshes=[trees.trunks,...trees.crownBatches];
  assert.ok(treeMeshes.every(mesh=>mesh.isInstancedMesh));
  assert.ok(treeMeshes.reduce((sum,mesh)=>sum+mesh.count*(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0)<18000);
  const surface=createSurfaceHeightSampler(createCityPlan(),0),heightRange=[];
  for(const tree of trees.placements) {
    const transform=new THREE.Matrix4();
    trees.trunks.getMatrixAt(tree.id,transform);
    trees.trunks.geometry.computeBoundingBox();
    const stem=trees.trunks.geometry.boundingBox.clone().applyMatrix4(transform);
    const batch=trees.crownBatches[tree.crownType];
    batch.getMatrixAt(tree.crownIndex,transform);
    const canopy=new THREE.Box3();
    const vertex=new THREE.Vector3();
    for(let i=0;i<batch.geometry.attributes.position.count;i++) {
      vertex.fromBufferAttribute(batch.geometry.attributes.position,i).applyMatrix4(transform);
      canopy.expandByPoint(vertex);
    }
    assert.ok(Math.abs(stem.min.y-surface(tree.x,tree.z))<1e-5);
    assert.ok(stem.max.y>canopy.min.y+(canopy.max.y-canopy.min.y)*.45,'stem ends inside the canopy');
    assert.ok(stem.max.y<canopy.max.y,'stem does not poke out above the canopy');
    assert.ok(Math.max(Math.abs(canopy.min.x-tree.x),Math.abs(canopy.max.x-tree.x),
      Math.abs(canopy.min.z-tree.z),Math.abs(canopy.max.z-tree.z))<=tree.radius+1e-4);
    heightRange.push(canopy.max.y-canopy.min.y);
  }
  assert.ok(Math.max(...heightRange)-Math.min(...heightRange)>2,'tree volumes should vary');
  const blocker=trees.placements[0];
  const blockerBatch=trees.crownBatches[blocker.crownType];
  const blockerMatrix=new THREE.Matrix4();
  blockerBatch.getMatrixAt(blocker.crownIndex,blockerMatrix);
  const camera=new THREE.PerspectiveCamera(45,1,.1,100);
  camera.position.set(blocker.x,blockerMatrix.elements[13]*2-.5,blocker.z+18);
  const car=new THREE.Object3D();car.position.set(blocker.x,.5,blocker.z-18);
  trees.updateVisibility(camera,car,1/60,'follow');
  let hidden=new THREE.Matrix4();blockerBatch.getMatrixAt(blocker.crownIndex,hidden);
  assert.equal(hidden.elements[0],0);
  camera.position.x+=100;
  trees.updateVisibility(camera,car,.1,'follow');
  blockerBatch.getMatrixAt(blocker.crownIndex,hidden);assert.equal(hidden.elements[0],0);
  trees.updateVisibility(camera,car,.1,'follow');
  blockerBatch.getMatrixAt(blocker.crownIndex,hidden);assert.notEqual(hidden.elements[0],0);
  const geometryDisposals=treeMeshes.map(mesh=>mesh.geometry).map(geometry=>{
    let count=0;geometry.addEventListener('dispose',()=>count++);return ()=>count;
  });
  const initialChildren=scene.children.length;
  city.dispose();
  assert.equal(scene.children.length,initialChildren-1);
  assert.ok(removed.length>0);
  assert.deepEqual(geometryDisposals.map(read=>read()),[1,1,1,1]);
  for(let rebuild=0;rebuild<10;rebuild++) {
    const nextCity=createCityScene(scene,{addStaticBox:spec=>spec,removeStaticBox:body=>removed.push(body)},createCityPlan());
    const disposed=[nextCity.trees.trunks,...nextCity.trees.crownBatches].map(mesh=>mesh.geometry).map(geometry=>{
      let count=0;geometry.addEventListener('dispose',()=>count++);return ()=>count;
    });
    nextCity.dispose();
    assert.equal(scene.children.length,initialChildren-1,`city rebuild ${rebuild} left a scene child`);
    assert.deepEqual(disposed.map(read=>read()),[1,1,1,1],`city rebuild ${rebuild} did not dispose each tree geometry once`);
  }
});
