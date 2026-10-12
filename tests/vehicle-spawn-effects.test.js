import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VehicleAppearance, VehicleSpawnEffects } from '../src/vehicle-spawn-effects.js';
import { createVehicleRuntime } from '../src/traffic.js';
import { CarSimulation, STEP } from '../src/vehicle.js';

test('appearance reserves the landing stage until safe, pauses without dt and restores transforms',()=>{
  const stage=new VehicleAppearance(),visual=new THREE.Group();stage.apply(visual);
  assert.ok(visual.scale.x<.01 && visual.position.y>2);
  stage.advance(.4);assert.ok(stage.scale>.5 && stage.offset>0);
  const elapsed=stage.elapsed;stage.advance(0);assert.equal(stage.elapsed,elapsed);
  assert.equal(stage.advance(1,false),false);assert.equal(stage.stage,'appearing');assert.equal(stage.elapsed,.7);
  assert.equal(stage.advance(STEP,true),true);assert.equal(stage.stage,'active');stage.apply(visual);
  assert.equal(visual.scale.x,1);assert.equal(visual.position.y,0);
  stage.advance(.3);assert.equal(stage.finished,true);stage.cancel();stage.apply(visual);assert.equal(visual.scale.x,1);
});
test('cloud pool has bounded slots and a player reservation; reset and dispose release resources',()=>{
  const scene=new THREE.Scene(),effects=new VehicleSpawnEffects(scene),stage=new VehicleAppearance();
  for(let i=0;i<31;i++) assert.ok(effects.acquire(`npc-${i}`,stage,{x:i,y:0,z:0})>=1);
  assert.equal(effects.acquire('overflow',stage,{x:0,y:0,z:0}),-1);
  assert.equal(effects.acquire('player',stage,{x:0,y:0,z:0},true),0);
  effects.update(null,'high');assert.equal(effects.mesh.count,256);
  effects.update(null,'low');assert.equal(effects.mesh.count,128);
  effects.release('npc-0');assert.equal(effects.snapshot().active,31);
  effects.reset();assert.equal(effects.mesh.count,0);assert.equal(effects.snapshot().active,0);
  effects.dispose();assert.equal(scene.children.length,0);
});
test('coordinate actor is created once, reserves occupancy, has no collision until safe landing and reuses clean storage',()=>{
  const scene=new THREE.Scene(),effects=new VehicleSpawnEffects(scene),player=new CarSimulation();
  const runtime=createVehicleRuntime(scene,THREE,0);runtime.setAppearanceEffects(effects);
  runtime.registerRole('police',{maxCount:2,update:()=>({control:{brake:1}})});runtime.attachPhysics(player);
  const result=runtime.requestSpawn({role:'police',position:{x:0,y:0,z:10},yaw:0});
  assert.equal(result.status,'created');const state=runtime.states[0],mesh=state.mesh;
  assert.equal(runtime.status().appearing,1);assert.ok(!player.world.bodies.includes(state.simulation.body));
  assert.equal(runtime.physicalActors().length,0);
  const blocked=runtime.requestSpawn({role:'police',position:{x:0,y:0,z:10},yaw:0});assert.equal(blocked.status,'pending');runtime.cancelSpawn(blocked.requestId);
  // Player enters the reserved footprint: body activation must wait.
  player.body.position.z=10;
  for(let i=0;i<120;i++) runtime.prepare(STEP);
  assert.equal(state.appearance.stage,'appearing');assert.ok(!player.world.bodies.includes(state.simulation.body));
  player.body.position.z=0;runtime.prepare(STEP);
  assert.equal(state.appearance.stage,'active');assert.ok(player.world.bodies.includes(state.simulation.body));
  for(let i=0;i<50;i++) runtime.prepare(STEP);
  const before=effects.snapshot().active;
  runtime.render();runtime.render();assert.equal(state.appearance.stage,'active');assert.equal(effects.snapshot().active,before);
  runtime.remove(result.id);assert.equal(effects.snapshot().active,0);
  const again=runtime.requestSpawn({role:'police',position:{x:0,y:0,z:10},yaw:0});
  assert.equal(runtime.states[0].mesh,mesh);assert.equal(runtime.states[0].appearance.elapsed,0);
  runtime.remove(again.id);assert.equal(mesh.userData.appearanceVisual.scale.x,1);
  runtime.dispose();effects.dispose();assert.equal(player.world.bodies.length,2);
});
test('reset cancels appearing actors and logical/physical culling never starts a new effect',()=>{
  const scene=new THREE.Scene(),effects=new VehicleSpawnEffects(scene),player=new CarSimulation();
  const runtime=createVehicleRuntime(scene,THREE,1);runtime.setAppearanceEffects(effects);runtime.attachPhysics(player);
  runtime.advanceSpawnFrame(.1);const state=runtime.states[0];assert.ok(state.appearance);
  runtime.reset();assert.equal(state.appearance.stage,'cancelled');assert.equal(effects.snapshot().active,0);
  for(let i=0;i<100;i++)runtime.stepWorld({},STEP);
  runtime.render();assert.equal(state.appearance.stage,'cancelled');assert.equal(effects.snapshot().active,0);
  runtime.dispose();effects.dispose();
});
