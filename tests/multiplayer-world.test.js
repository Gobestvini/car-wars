import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameWorld, STEP } from '../src/simulation/game-world.js';
import { createVehicleRuntime } from '../src/traffic.js';
import { createVehicleRuntimeCore } from '../src/simulation/vehicle-runtime.js';
import { verifyMap } from '../src/multiplayer/map-contract.js';
import { createCityScene } from '../src/city-scene.js';
import { encodeFrame,decodeFrame } from '../src/multiplayer/frame-codec.js';

const make=options=>createGameWorld({seed:42,npcCount:0,spawnPhases:false,...options});
const step=(w,seconds)=>{for(let i=0;i<Math.round(seconds/STEP);i++)w.step();};
const stars=(p,count)=>{for(let i=0;i<count;i++)p.wanted.update(.51,[{type:'property-collision'}]);};
const pose=(p,x,z,yaw=0)=>{const b=(p.sim??p.simulation).body;b.position.set(x,.96,z);b.quaternion.setFromEuler(0,yaw,0);b.velocity.setZero();b.angularVelocity.setZero();b.aabbNeedsUpdate=true;};

test('one shared solver per tick; appearance reserves a safe landing without a mesh',async()=>{
  const w=make({spawnPhases:true});await w.ready;const a=w.addPlayer('a'),b=w.addPlayer('b');
  let calls=0;const run=w.world.step.bind(w.world);w.world.step=(dt)=>{calls++;assert.equal(dt,STEP);return run(dt);};
  try{
    assert.equal(w.world.bodies.includes(a.sim.body),false);assert.equal(w.world.bodies.includes(b.sim.body),false);
    w.setPlayerInput(a.id,{steer:0,throttle:1,brake:0});step(w,.5);
    assert.equal(a.lastAppliedTick,0);assert.equal(a.sim.appearing,true);
    step(w,.3);assert.equal(a.sim.appearing,false);assert.equal(w.world.bodies.includes(a.sim.body),true);
    assert.equal(calls,96);assert.equal(w.steps,96);assert.equal(w.runtime.states.filter(a=>a.mesh).length,0);
    assert.equal(await verifyMap(w.map,w.signature),w.plan);
  }finally{w.dispose();}
});

test('union LOD follows three distant observers and promotion retains identity, damage and velocity',()=>{
  const w=make({npcCount:30,autoPolice:false});const players=['a','b','c'].map(id=>w.addPlayer(id));
  try{
    const candidates=w.runtime.states.filter((a,i,all)=>all.slice(0,i).every(b=>Math.hypot(a.x-b.x,a.z-b.z)>65)).slice(0,3);
    assert.equal(candidates.length,3);
    candidates.forEach((a,i)=>pose(players[i],a.x+7,a.z));step(w,.3);
    for(const a of candidates){assert.equal(a.logical,false);assert.ok(w.world.bodies.includes(a.simulation.body));}
    const a=candidates[0],sim=a.simulation,id=a.id;sim.damage=.2;
    players.forEach(p=>pose(p,1000,1000));step(w,.2);assert.equal(a.logical,true);
    const before=sim.body.position.clone();pose(players[2],before.x+7,before.z);step(w,.1);
    assert.equal(a.logical,false);assert.equal(a.simulation,sim);assert.equal(a.id,id);assert.equal(sim.damage,.2);
    assert.ok(sim.body.position.distanceTo(before)<2);assert.equal(new Set(w.runtime.states.map(a=>a.id)).size,30);
  }finally{w.dispose();}
});

test('stable police targets obey personal wanted, quotas, disconnect and arrest; one respawn preserves everyone else',()=>{
  const w=make(),players=['a','b','c'].map(id=>w.addPlayer(id));
  try{
    w.updatePolice();assert.equal(w.runtime.roleCount('police'),3);
    assert.ok(w.runtime.states.every(a=>a.ai.targetId===null));
    stars(players[0],1);stars(players[1],3);stars(players[2],3);w.updatePolice();
    assert.equal(w.runtime.roleCount('police'),5);
    const before=w.runtime.states.map(a=>a.ai.targetId);w.updatePolice();assert.deepEqual(w.runtime.states.map(a=>a.ai.targetId),before);
    assert.ok(w.runtime.states.filter(a=>a.ai.targetId==='b').length<=2);
    w.disconnect('b');w.updatePolice();assert.ok(w.runtime.states.every(a=>a.ai.targetId!=='b'));
    const seed=w.plan.seed,other=players[2].sim.body.position.clone(),otherLevel=players[2].wanted.snapshot().level;
    w.repairs.placements[0].status='consumed';w.props.remove(w.props.entries[0]);
    w.respawn('a');assert.equal(players[0].wanted.snapshot().level,0);assert.equal(players[0].generation,2);
    assert.equal(players[2].generation,1);assert.equal(players[2].wanted.snapshot().level,otherLevel);
    assert.equal(players[2].sim.body.position.distanceTo(other),0);assert.equal(w.plan.seed,seed);
    assert.equal(w.repairs.placements[0].status,'consumed');assert.equal(w.props.entries[0].state,'removed');
    w.removePlayer('c');assert.ok(w.runtime.states.every(a=>a.ai.targetId!=='c'));
    const frame=decodeFrame(encodeFrame(w.snapshot()));assert.ok([...frame.actors.values()].some(a=>a.role==='police'));
  }finally{w.dispose();}
});

test('actual physics and violations produce personal warning/stars; property causality is player-specific',()=>{
  const w=make({autoPolice:false}),a=w.addPlayer('a'),b=w.addPlayer('b');
  try{
    pose(a,0,0);pose(b,100,100);a.sim.body.velocity.set(0,0,30);
    for(let i=0;i<130;i++){a.sim.body.velocity.set(0,0,30);w.setPlayerInput(a.id,{steer:0,throttle:1,brake:0});w.step();}
    assert.equal(a.wanted.snapshot().pendingStar,1);assert.equal(b.wanted.snapshot().pendingStar,null);
    const prop=w.props.entries.find(p=>p.type==='lamp');
    w.props.pushedPlayers.set('a',w.props.clock+1);w.props.enabled=true;
    w.props.offense(prop,40,{id:'a',player:true});w.props.offense(prop,40,{id:'b',player:true});
    const events=w.props.events.splice(0);assert.equal(events.length,1);assert.equal(events[0].playerId,'b');
    assert.ok(w.events.some(e=>e.playerId==='a'&&e.type==='speeding'));
  }finally{w.dispose();}
});

test('arrest of one player completes only with assigned operational police and survives reconnect but not personal respawn',()=>{
  const w=make(),a=w.addPlayer('a'),b=w.addPlayer('b');
  try{
    pose(a,0,0);pose(b,60,0);stars(a,1);w.updatePolice();
    const unit=w.runtime.states.find(u=>u.ai.targetId==='a');assert.ok(unit);
    pose(unit,0,-5);unit.ai.control={steer:0,throttle:0,brake:1};
    // Freeze only controller decisions, not solver or arrest clocks, for a reproducible legal holding fixture.
    w.updatePolice=()=>{};w.runtime.registerRole('police',{maxCount:6,physicalOnly:true,update:()=>({control:{steer:0,throttle:0,brake:1}})});
    step(w,7.2);assert.equal(a.arrest.snapshot().state,'arrested');assert.equal(b.arrest.snapshot().state,'idle');
    assert.equal(w.input(a.id,{seq:1,steer:0,throttle:1,brake:0}),false);
    const full=w.snapshot();assert.equal(full.gameplay.players.find(p=>p.id==='a').arrest.state,'arrested');
    w.disconnect('a');a.connected=true;step(w,.1);assert.equal(a.arrest.snapshot().state,'arrested');
    w.respawn('a');assert.equal(a.arrest.snapshot().state,'idle');assert.equal(a.wanted.snapshot().level,0);
    assert.equal(w.events.filter(e=>e.type==='arrested').length,1);
  }finally{w.dispose();}
});

test('shared pickups pick one eligible player by id without teleporting either car',()=>{
  const w=make({autoPolice:false}),z=w.addPlayer('z'),a=w.addPlayer('a');
  try{const p=w.repairs.placements[0];pose(a,p.x-1.5,p.z);pose(z,p.x+1.5,p.z);a.sim.damage=z.sim.damage=.5;
    w.step();assert.equal(a.sim.damage,0);assert.equal(z.sim.damage,.5);assert.equal(w.repairs.repairs,1);
    assert.equal(a.generation,1);assert.ok(Math.abs(a.sim.body.position.x-p.x)<2);
  }finally{w.dispose();}
});

test('the same fixed-seed core with a visual adapter preserves single-player physics and NPC decisions',async()=>{
  const headless=make({npcCount:5,autoPolice:false}),visible=make({npcCount:5,autoPolice:false,deferRuntime:true});
  const scene=new THREE.Scene(),traffic=createVehicleRuntime(scene,THREE,5,visible.plan.roadNetwork,visible.plan.roadWidth,visible.obstacles,visible.bounds);
  visible.setRuntime(traffic,true);traffic.initializePopulation();
  const a=headless.addPlayer('player'),b=visible.addPlayer('player');
  try{
    for(let i=0;i<600;i++){const input={steer:i>200?.2:0,throttle:.6,brake:0};headless.setPlayerInput('player',input);visible.setPlayerInput('player',input);headless.step();visible.step();}
    assert.ok(a.sim.body.position.distanceTo(b.sim.body.position)<.001);
    assert.deepEqual(headless.runtime.debug().map(a=>a.id),visible.runtime.debug().map(a=>a.id));
    for(let i=0;i<5;i++)assert.ok(headless.runtime.states[i].simulation.body.position.distanceTo(visible.runtime.states[i].simulation.body.position)<.01);
    const city=createCityScene(scene,b.sim,visible.plan,[],{worldCore:visible,destructibleTrees:true});
    assert.equal(visible.props.entries.length,visible.colliders.props.length);assert.equal(city.propPhysics,visible.props);
    assert.deepEqual(city.signalApproaches,visible.approaches);city.dispose();
    assert.equal(await verifyMap(visible.map,await visible.ready),visible.plan);
  }finally{headless.dispose();visible.dispose();}
});

test('twenty create/dispose cycles leave no bodies, actor listeners, commands or active pool leases',()=>{
  for(let i=0;i<20;i++){
    const w=make({npcCount:3}),players=['a','b','c'].map(id=>w.addPlayer(id));step(w,.1);
    const sims=[...players.map(a=>a.sim),...w.runtime.simulations];w.dispose();w.dispose();
    assert.equal(w.world.bodies.length,0);assert.equal(w.players.size,0);assert.equal(w.runtime.states.length,0);
    for(const s of sims){assert.equal(s.damageListener,null);assert.equal(s.impactEvents.length,0);}
  }
});

test('the production collider builder physically blocks a car at an ordinary house',()=>{
  const w=make({autoPolice:false}),a=w.addPlayer('a'),house=w.plan.buildings[0];let contact=false;
  try{
    pose(a,house.x-house.width/2-4,house.z,Math.PI/2);a.sim.body.velocity.set(16,0,0);
    for(let i=0;i<96;i++){
      w.setPlayerInput(a.id,{steer:0,throttle:1,brake:0});w.step();
      contact ||= w.world.contacts.some(c=>[c.bi,c.bj].includes(a.sim.body)&&[c.bi,c.bj].some(b=>b.mass===0&&Math.abs(b.position.x-house.x)<.01&&Math.abs(b.position.z-house.z)<.01));
    }
    assert.equal(contact,true);assert.ok(a.sim.body.position.x<house.x-house.width/2-1.5);
  }finally{w.dispose();}
});

test('render frames cannot spawn cars; simulation-time insertion is identical at 30/60/120 FPS',()=>{
  const results=[];
  for(const fps of [30,60,120]){
    const w=make({autoPolice:false,deferRuntime:true});
    const runtime=createVehicleRuntimeCore({count:20,roadNetwork:w.plan.roadNetwork,roadWidth:w.plan.roadWidth,obstacles:w.obstacles,mapBounds:w.bounds,spawnPhases:true});
    w.setRuntime(runtime,true);w.addPlayer('a');
    try{
      for(let i=0;i<100;i++)runtime.advanceSpawnFrame(.1);
      assert.equal(runtime.roleCount('civilian'),0);
      for(let i=0;i<fps;i++){runtime.advanceSpawnFrame(1/fps);for(let tick=0;tick<120/fps;tick++)w.step();}
      results.push(runtime.debug().map(a=>({id:a.id,stage:a.appearance,elapsed:a.appearanceTime})));
      assert.equal(w.steps,120);assert.equal(runtime.roleCount('civilian'),20);
    }finally{w.dispose();}
  }
  assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
});

test('damage-test obstacles and placement exclusions use the same signed collision contract as the scene',async()=>{
  const obstacles=[[-8,18,10,1.2],[-1.72,.44,.3,.7,1.4,-.45]],w=make({damageObstacles:obstacles,autoPolice:false});
  const scene=new THREE.Scene(),a=w.addPlayer('a');
  const city=createCityScene(scene,a.sim,w.plan,obstacles,{worldCore:w,destructibleTrees:true});
  try{
    await w.ready;assert.equal(await verifyMap(w.map,w.signature),w.plan);
    assert.equal(w.colliders.boxes.at(-2).halfY,.7);assert.equal(w.props.entries.length,w.colliders.props.length);
  }finally{city.dispose();w.dispose();}
});
