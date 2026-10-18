import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createCityPlan } from '../src/city-generator.js';
import { createCityScene } from '../src/city-scene.js';
import { cityColliders, mapContract, mapBytes, verifyMap } from '../src/multiplayer/map-contract.js';
import { encodeFrame, decodeFrame } from '../src/multiplayer/frame-codec.js';
import { SnapshotBuffer } from '../src/multiplayer/snapshot-buffer.js';
import { SpikeWorld } from '../tools/multiplayer-spike/world.js';

test('server map roundtrip matches every rendered house/curb collider and has no NaN landmark bodies',async()=>{
  const plan=createCityPlan(20261005),colliders=cityColliders(plan),recorded={boxes:[],prisms:[]};
  assert.ok(plan.landmarks.every(Number.isInteger));
  const scene=createCityScene(new THREE.Scene(),{
    addStaticBox:b=>{recorded.boxes.push(b);return b;},addStaticConvex:p=>{recorded.prisms.push(p);return p;},removeStaticBox:()=>{},
  },plan);
  try{assert.deepEqual(recorded,colliders);}finally{scene.dispose();}
  const data=mapContract(plan,colliders),signature=createHash('sha256').update(mapBytes(data)).digest('hex');
  const wire=JSON.parse(JSON.stringify(data));assert.equal((await verifyMap(wire,signature)).seed,plan.seed);
  wire.plan.buildings[0].x+=1;await assert.rejects(verifyMap(wire,signature),/совпадают|повреждённая/);
  assert.throws(()=>cityColliders({...plan,buildings:[{...plan.buildings[0],x:NaN}]}),/Invalid/);
});

test('102 far NPC follow turns for one simulated minute without entering houses or teleporting between edges',()=>{
  const world=new SpikeWorld({seed:20261005,npcCount:102}),initial=new Map(world.npcs.map(a=>[a.id,{...a.sim.body.position}]));
  const previous=new Map(world.npcs.map(a=>[a.id,{...a.sim.body.position}]));let travelled=0,largestStep=0;
  try{
    for(let tick=0;tick<7200;tick++){
      world.step();
      for(const actor of world.npcs){
        const p=actor.sim.body.position,last=previous.get(actor.id),distance=Math.hypot(p.x-last.x,p.z-last.z);
        largestStep=Math.max(largestStep,distance);travelled+=distance;previous.set(actor.id,{...p});
        if(tick%12===0)assert.equal(world.buildingIndex.overlaps({x:p.x,z:p.z,heading:Math.atan2(2*(actor.sim.body.quaternion.x*actor.sim.body.quaternion.z+actor.sim.body.quaternion.w*actor.sim.body.quaternion.y),1-2*(actor.sim.body.quaternion.x**2+actor.sim.body.quaternion.y**2))}),false,`${actor.id} crossed a house at tick ${tick}`);
      }
    }
    assert.ok(travelled>1000,'NPC must actually move');assert.ok(largestStep<.3,`unexpected teleport ${largestStep}`);
    assert.ok(world.npcs.some(a=>Math.hypot(a.sim.body.position.x-initial.get(a.id).x,a.sim.body.position.z-initial.get(a.id).z)>30));
  }finally{world.dispose();}
});

test('three physical players cannot drive through an ordinary house, a landmark, or a perimeter house',()=>{
  const world=new SpikeWorld({npcCount:0,playerCount:3}),players=[...world.players.values()];
  const houses=[world.plan.buildings.find(b=>!b.landmark),world.plan.buildings.find(b=>b.landmark),world.plan.boundaryBuildings[0]];
  const touched=new Set();
  try{
    players.forEach((actor,i)=>{
      const b=actor.sim.body,house=houses[i];b.position.set(house.x,1,house.z-house.depth/2-7);
      b.quaternion.setFromEuler(0,0,0);b.velocity.set(0,0,18);
    });
    for(let tick=0;tick<180;tick++){
      for(const actor of players)world.input(actor.id,{seq:tick,steer:0,throttle:1,brake:0});
      world.step();
      players.forEach((actor,i)=>{if(world.world.contacts.some(c=>c.bi===actor.sim.body||c.bj===actor.sim.body))touched.add(i);});
    }
    assert.equal(touched.size,3);
    players.forEach((actor,i)=>assert.ok(actor.sim.body.position.z<houses[i].z-houses[i].depth/2,`${i} entered a house`));
  }finally{world.dispose();}
});

test('motion frame roundtrip includes all players/wheels and stays below the default bandwidth budget',()=>{
  const world=new SpikeWorld({npcCount:102,playerCount:3});
  try{
    const snapshot=world.snapshot(),bytes=encodeFrame(snapshot),decoded=decodeFrame(bytes);
    assert.equal(decoded.actors.size,105);assert.equal(decoded.tick,snapshot.tick);
    assert.ok(bytes.length*20/1024<150);
    for(const source of snapshot.players){
      const actor=decoded.actors.get(source.id);assert.equal(actor.wheels.length,28);assert.equal(actor.ack,-1);
      source.p.forEach((value,i)=>assert.ok(Math.abs(actor.pose[i]-value)<.0001));
    }
    assert.throws(()=>decodeFrame(bytes.subarray(0,bytes.length-1)));
    const corrupt=bytes.slice();corrupt[0]=99;assert.throws(()=>decodeFrame(corrupt),/Unsupported/);
  }finally{world.dispose();}
});

test('client extrapolation stops at server-map houses and holds its capped pose on a network stall',()=>{
  const plan={buildings:[{x:5,z:0,width:4,depth:10}],boundaryBuildings:[]},buffer=new SnapshotBuffer();buffer.setMap(plan);
  const actor={id:'p',role:'player',generation:1,pose:[1.8,1,0,0,Math.SQRT1_2,0,Math.SQRT1_2,20,0,0],wheels:[],connected:true};
  buffer.push({tick:1,actors:new Map([['p',actor]])},100);
  assert.equal(buffer.sample(300,'p')[0].pose[0],1.8);
  assert.equal(buffer.sample(900,'p')[0].pose[0],1.8);
});
