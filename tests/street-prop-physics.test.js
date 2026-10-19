import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cannon-es';
import * as THREE from 'three';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { StreetPropPhysics } from '../src/street-prop-physics.js';
import { PROP_PHYSICS, PROP_LIFETIME, PROP_GHOST_ALPHA } from '../src/street-prop-config.js';
import { createCityScene } from '../src/city-scene.js';
import { createCityPlan } from '../src/city-generator.js';
import { createTrafficSignals } from '../src/traffic-signals.js';

function fixture(type='bin',kmh=10,player=true) {
  const sim = new CarSimulation({damage:false});
  const manager = new StreetPropPhysics(sim.world);
  const entry = manager.register({id:`${type}:0`,type,x:0,y:.155,z:0,yaw:0});
  const zHalf = type==='bin'?.26:type==='bench'?.325:.1;
  sim.body.position.set(0,.7,-2.08-zHalf-.001);
  sim.body.quaternion.setFromEuler(0,0,0);
  sim.body.velocity.set(0,0,kmh/3.6);
  const actor = {body:sim.body,player};
  function tick(dt=STEP) {
    manager.beforeStep(dt,[actor]); sim.world.step(dt); const events=manager.afterStep(dt); manager.syncVisuals(); return events;
  }
  return {sim,manager,entry,actor,tick};
}

for (const [type,spec] of Object.entries(PROP_PHYSICS)) {
  for (const offset of [-1,0,1]) test(`${type} threshold ${spec.threshold+offset} km/h uses pre-solver speed`,()=>{
    const f=fixture(type,spec.threshold+offset);
    const original=f.entry.body;
    let events=[];
    for(let i=0;i<30;i++) events.push(...f.tick());
    assert.equal(f.entry.state,offset<0?'intact':'detached');
    assert.equal(events.length,1); assert.equal(events[0].type,'property-collision');
    if(offset<0) {
      assert.equal(f.entry.body,original); assert.equal(original.type,C.Body.STATIC);
      assert.ok(f.sim.body.velocity.z < (spec.threshold-1)/3.6*.5);
    } else {
      assert.equal(f.entry.body,original,'the old body is only a detached pose carrier');
      assert.ok(!f.sim.world.bodies.includes(original));
      assert.equal(f.entry.active,false);assert.equal(f.manager.byBody.has(original),false);
      assert.equal(f.entry.body.angularVelocity.length(),0);
    }
  });
  for(const kmh of [60,120]) test(`${type} swept ${kmh} km/h hit preserves progress and removes invisible obstacle`,()=>{
    const f=fixture(type,kmh);
    const initial=kmh/3.6, original=f.entry.body;
    const events=f.tick();
    assert.equal(events.length,1); assert.equal(f.entry.state,'detached');
    assert.ok(f.sim.body.velocity.z>=initial*.5);
    for(let i=0;i<600;i++) f.tick();
    assert.equal(f.entry.state,'removed'); assert.ok(!f.sim.world.bodies.includes(original));
    assert.ok(f.sim.body.position.z>0);
    const result=new C.RaycastResult();
    f.sim.world.raycastClosest(new C.Vec3(0,.8,-1),new C.Vec3(0,.8,1),{collisionFilterMask:4},result);
    assert.equal(result.hasHit,false);
  });
}

test('substantial contact 1.9/2 km/h, prolonged contact and separated re-entry',()=>{
  for (const kmh of [1.9,2]) {
    const f=fixture('signal',kmh);
    let events=[];
    for(let i=0;i<120;i++) events.push(...f.tick());
    assert.equal(events.length,kmh<2?0:1);
  }
  const f=fixture('signal',10);
  let events=[];
  for(let i=0;i<1200;i++) { f.sim.body.velocity.z=10/3.6; events.push(...f.tick()); }
  assert.equal(events.length,1);
  f.sim.body.position.z=-8; f.sim.body.velocity.setZero();
  for(let i=0;i<70;i++) f.tick();
  f.sim.body.position.set(0,.7,-2.205); f.sim.body.velocity.set(0,0,10/3.6);
  for(let i=0;i<120;i++) events.push(...f.tick());
  assert.equal(events.length,2);
});

test('NPC and debris do not blame player; disabled player and retreat never create offenses',()=>{
  const npc=fixture('bin',60,false); assert.deepEqual(npc.tick(),[]); assert.equal(npc.entry.state,'detached');
  const f=fixture('bin',60);
  f.manager.beforeStep(STEP,[f.actor],false); f.sim.world.step(STEP);
  assert.deepEqual(f.manager.afterStep(STEP),[]); assert.equal(f.entry.state,'intact');
  const retreat=fixture('bin',-60); assert.deepEqual(retreat.tick(),[]); assert.equal(retreat.entry.state,'intact');
  const stationary=fixture('signal',0);
  const c={bi:stationary.entry.body,bj:stationary.sim.body,ni:new C.Vec3(0,0,-1)};
  stationary.manager.beforeStep(STEP,[stationary.actor]); stationary.sim.body.velocity.z=20;
  assert.deepEqual(stationary.manager.afterStep(STEP,[c]),[]);
});

test('normal orientation works for either contact body order and duplicates form one episode',()=>{
  for(const propFirst of [true,false]) {
    const f=fixture('signal',10); f.sim.body.position.z=-3;
    f.manager.beforeStep(STEP,[f.actor]);
    const c=propFirst?{bi:f.entry.body,bj:f.sim.body,ni:new C.Vec3(0,0,-1)}:
      {bi:f.sim.body,bj:f.entry.body,ni:new C.Vec3(0,0,1)};
    const events=f.manager.afterStep(STEP,[c,c,c]);
    assert.equal(events.length,1); assert.ok(Math.abs(events[0].impactSpeedKmh-10)<1e-8);
  }
});

test('NPC shoving a stationary player into a prop on the following tick remains uncharged',()=>{
  const f=fixture('signal',0);
  const npc=new C.Body({mass:1600});npc.addShape(new C.Box(new C.Vec3(.87,.27,2.08)));
  npc.position.copy(f.sim.body.position);npc.position.z-=4; npc.velocity.set(0,0,10);
  const actors=[f.actor,{body:npc,player:false}];
  f.manager.beforeStep(STEP,actors);
  f.sim.body.velocity.set(0,0,5);
  assert.deepEqual(f.manager.afterStep(STEP,[{bi:npc,bj:f.sim.body,ni:new C.Vec3(0,0,1)}]),[]);
  f.sim.body.position.z=-2.181;
  f.manager.beforeStep(STEP,actors);f.sim.world.step(STEP);
  assert.deepEqual(f.manager.afterStep(STEP),[]);
  assert.equal(f.entry.episode,true);
});

test('distant anchored colliders reactivate before an actor sweep; ghosts never reactivate',()=>{
  const f=fixture('bin',0);
  const far=f.manager.register({id:'far',type:'lamp',x:120,y:.155,z:0,yaw:0});
  const anchored=far.body;
  f.tick();assert.equal(far.active,false);assert.ok(!f.sim.world.bodies.includes(anchored));
  f.sim.body.position.set(120,.7,-2.181);f.sim.body.velocity.set(0,0,60/3.6);
  const events=f.tick();assert.equal(events.length,1);assert.equal(far.state,'detached');
  assert.ok(!f.sim.world.bodies.includes(far.body));
  f.sim.body.position.set(-120,.7,0);f.sim.body.velocity.setZero();
  f.tick();assert.ok(!f.sim.world.bodies.includes(far.body));
  f.manager.reset();f.sim.body.position.set(120,.7,-2.181);f.sim.body.velocity.set(0,0,10/3.6);
  assert.equal(f.tick().length,1);assert.equal(far.state,'intact');assert.equal(far.active,true);
});

test('reverse travel hits physically, grazing uses normal speed rather than speedometer',()=>{
  const reverse=fixture('bin',60);
  reverse.sim.body.quaternion.setFromEuler(0,Math.PI,0);
  assert.equal(reverse.tick().length,1); assert.equal(reverse.entry.state,'detached');
  const grazing=fixture('lamp',5);
  grazing.sim.body.position.set(-.955,.7,0); grazing.sim.body.velocity.set(1,0,25);
  const events=grazing.tick();
  assert.equal(grazing.entry.state,'intact');
  assert.equal(events.length,1); assert.ok(events[0].impactSpeedKmh<5);
});

test('a following physical car passes the fresh ghost without another impact or offense',()=>{
  const f=fixture('bin',60);assert.equal(f.tick().length,1);
  f.sim.body.position.set(20,1,0);f.sim.body.velocity.setZero();
  const follower=new CarSimulation({world:f.sim.world,materials:f.sim.materials,spawn:{x:0,y:.96,z:-2.5,yaw:0}});
  follower.body.velocity.set(0,0,20);let events=[];
  for(let i=0;i<60;i++){
    follower.prepare({throttle:0,brake:0},STEP);
    f.manager.beforeStep(STEP,[{body:follower.body,player:true}]);f.sim.world.step(STEP);
    events.push(...f.manager.afterStep(STEP));follower.postStep(STEP);
    assert.equal(f.sim.world.contacts.some(c=>c.bi===f.entry.body||c.bj===f.entry.body),false);
  }
  assert.equal(f.entry.state,'detached','the follower passes while the visual ghost still exists');
  assert.ok(follower.body.position.z>1);assert.equal(follower.damage,0);assert.deepEqual(events,[]);
  follower.disposeDamageListener();
});

test('immediate alpha, 0.75s simulated lifetime, oldest eviction, reset and repeated dispose',()=>{
  const f=fixture('bin',60); let alpha;
  f.entry.sync=(_,amount)=>{alpha=amount;}; f.tick();
  const age=f.manager.clock-f.entry.destroyedAt;
  assert.ok(alpha>0&&alpha<=PROP_GHOST_ALPHA);assert.ok(!f.sim.world.bodies.includes(f.entry.body));
  f.manager.afterStep(PROP_LIFETIME/2-age,[]);f.manager.syncVisuals();assert.ok(Math.abs(alpha-PROP_GHOST_ALPHA/2)<1e-8);
  f.manager.afterStep(PROP_LIFETIME/2,[]); assert.equal(f.entry.state,'removed');
  f.manager.reset(); f.manager.reset(); assert.equal(f.entry.state,'intact');
  assert.equal(f.manager.snapshot().detached,0);
  for(let i=1;i<=25;i++) {
    const entry=f.manager.register({id:`bin:${i}`,type:'bin',x:0,y:.155,z:i*10,yaw:0});
    f.manager.detach(entry,f.actor,new C.Vec3(0,0,1),60);
  }
  assert.equal(f.manager.debris.length,24); assert.equal(f.manager.entries[1].state,'removed');
  const count=f.sim.world.bodies.length;
  f.manager.reset(); assert.equal(f.sim.world.bodies.length,count+25);
  assert.ok(f.manager.entries.every(e=>e.state==='intact'&&f.sim.world.bodies.includes(e.body)));
  f.manager.dispose(); f.manager.dispose(); assert.equal(f.sim.world.bodies.length,2);
});

test('seed42 scene has all types, destroyed signal stays dark across phases/quality, reset and resources',()=>{
  const sim=new CarSimulation({damage:false}),scene=new THREE.Scene(),plan=createCityPlan(42);
  const baseline=sim.world.bodies.length;
  for(let cycle=0;cycle<3;cycle++) {
    const city=createCityScene(scene,sim,plan,[],{destructibleTrees:true}),signals=createTrafficSignals(plan.roadNetwork);
    for(const type of ['lamp','bin','bench','signal','tree']) assert.ok(city.propPhysics.entries.some(e=>e.type===type));
    const entry=city.propPhysics.entries.find(e=>e.type==='signal');
    city.propPhysics.detach(entry,{body:sim.body},new C.Vec3(0,0,1),60);
    city.propPhysics.syncVisuals();
    const approach=city.signalApproaches.find(a=>entry.id===`signal:${a.nodeId}:${a.fromId}`);
    const index=city.signalApproaches.indexOf(approach);
    for(const quality of ['low','high']) for(const time of [0,10,40,80]) {
      city.updateSignals(signals,time,null,quality);
      assert.equal(approach.destroyed,true);
      assert.ok(!city.signalBeam.userData.visibleApproachIndices.includes(index));
    }
    city.propPhysics.reset(); city.updateSignals(signals,0,null,'high'); assert.equal(approach.destroyed,false);
    const bodies=city.propPhysics.entries.map(e=>e.body);
    city.dispose(); assert.equal(scene.children.length,0);
    assert.ok(bodies.every(body=>!sim.world.bodies.includes(body)));
    assert.equal(sim.world.bodies.length,baseline);
  }
});
