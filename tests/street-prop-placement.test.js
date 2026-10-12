import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCityPlan, CITY_CONFIG } from '../src/city-generator.js';
import { createCityScene } from '../src/city-scene.js';
import { createTreePlacements } from '../src/tree-placement.js';
import { createStreetPropPlacements, STREET_PROPS } from '../src/street-prop-placement.js';
import { createRoadSurfaceRectangles, createSurfaceHeightSampler } from '../src/road-surface.js';

const distance = (p, r) => Math.hypot(Math.max(r.minX-p.x,0,p.x-r.maxX),Math.max(r.minZ-p.z,0,p.z-r.maxZ));
const simulation = () => ({ addStaticBox: s=>s, addStaticConvex: s=>s, removeStaticBox() {} });

test('whole prop footprints fit sidewalks and avoid roads, buildings, signals, trees and rotated obstacles', () => {
  for (const seed of [1,20261005,928172]) for (const roadWidth of [12,15,30]) {
    const plan = createCityPlan(seed,{roadWidth}), original=JSON.stringify(plan);
    const trees = createTreePlacements(plan), signals = trees.slice(0,10).map(p=>({x:p.x+4,z:p.z}));
    const damageObstacles = [[-66,-5,4,8,2,Math.PI/4]];
    const args={trees,signals,damageObstacles};
    const placements=createStreetPropPlacements(plan,args);
    assert.deepEqual(placements,createStreetPropPlacements(plan,args)); assert.equal(JSON.stringify(plan),original);
    const roads=createRoadSurfaceRectangles(plan,plan.bounds,roadWidth,{centerX:0,centerZ:0,width:50,depth:50});
    const sample=createSurfaceHeightSampler(plan,0);
    for(const type of ['lamp','bin']) {
      const selected=placements.filter(p=>p.type===type); assert.ok(selected.length>10 && selected.length<=STREET_PROPS[type].maxCount);
      assert.ok(selected.some(p=>p.x<0) && selected.some(p=>p.x>0) && selected.some(p=>p.z<0) && selected.some(p=>p.z>0));
    }
    for(const p of placements) {
      for(let angle=0;angle<Math.PI*2;angle+=Math.PI/16) assert.equal(sample(p.x+Math.cos(angle)*p.radius,p.z+Math.sin(angle)*p.radius),.155);
      assert.ok(roads.every(r=>distance(p,r)>=p.radius));
      assert.ok(plan.buildings.every(b=>distance(p,{minX:b.x-b.width/2,maxX:b.x+b.width/2,minZ:b.z-b.depth/2,maxZ:b.z+b.depth/2})>=p.radius+.15));
      assert.ok(trees.every(t=>Math.hypot(p.x-t.x,p.z-t.z)>=p.radius+t.radius+.25));
      assert.ok(signals.every(s=>Math.hypot(p.x-s.x,p.z-s.z)>=p.radius+3));
      const hx=(4+8)/2/Math.sqrt(2),hz=hx;
      assert.ok(distance(p,{minX:-66-hx,maxX:-66+hx,minZ:-5-hz,maxZ:-5+hz})>=p.radius+.15);
      for(const other of placements.slice(0,p.id)) assert.ok(Math.hypot(p.x-other.x,p.z-other.z)>=
        (p.type===other.type?STREET_PROPS[p.type].spacing:p.radius+other.radius+.4));
    }
  }
});

test('narrow and completely occupied sidewalks skip impossible placements',()=>{
  for(const sidewalkWidth of [0,.3,.8]) {
    const plan=createCityPlan(1,{config:{...CITY_CONFIG,sidewalkWidth}});
    assert.deepEqual(createStreetPropPlacements(plan),[]);
  }
  assert.deepEqual(createStreetPropPlacements(createCityPlan(),{damageObstacles:[[0,0,1000,1000]]}),[]);
});

test('eight shared model batches fit declared envelopes, stand on the surface, and dispose once over ten rebuilds',()=>{
  const scene=new THREE.Scene(),plan=createCityPlan(),sample=createSurfaceHeightSampler(plan,0);
  let expected;
  for(let cycle=0;cycle<10;cycle++) {
    const city=createCityScene(scene,simulation(),plan),props=city.streetProps;
    expected ||= props.counts; assert.deepEqual(props.counts,expected);
    assert.equal(props.batches.length,8); assert.ok(props.counts.lamp>0 && props.counts.bin>0);
    assert.ok(props.batches.every(b=>b.isInstancedMesh && b.material.depthTest));
    assert.equal(props.batches.filter(b=>b.name.includes('lamp')).length,5);
    for(const type of ['lamp','bin']) {
      const poses=props.placements.filter(p=>p.type===type),batches=props.batches.filter(b=>b.name.includes(type));
      const vertex=new THREE.Vector3(),matrix=new THREE.Matrix4();
      for(const [index,p] of poses.entries()) {
        let minY=Infinity,maxY=-Infinity;
        for(const batch of batches) {
          batch.getMatrixAt(index,matrix);
          for(let i=0;i<batch.geometry.attributes.position.count;i++) {
            vertex.fromBufferAttribute(batch.geometry.attributes.position,i).applyMatrix4(matrix);
            assert.ok(Math.hypot(vertex.x-p.x,vertex.z-p.z)<=p.radius+1e-5);
            minY=Math.min(minY,vertex.y);maxY=Math.max(maxY,vertex.y);
          }
        }
        assert.ok(Math.abs(minY-sample(p.x,p.z))<1e-5);
        assert.ok(maxY-minY<=STREET_PROPS[type].height && maxY-minY>(type==='lamp'?3.5:.7));
      }
    }
    const resources=new Set(props.batches.flatMap(b=>[b.geometry,b.material,b]));
    const disposed=new Map([...resources].map(r=>[r,0]));
    for(const r of resources) r.addEventListener('dispose',()=>disposed.set(r,disposed.get(r)+1));
    city.dispose(); assert.equal(scene.children.length,0);
    assert.ok([...disposed.values()].every(n=>n===1));
  }
});
