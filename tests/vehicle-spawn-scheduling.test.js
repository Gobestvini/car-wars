import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createVehicleRuntime } from '../src/traffic.js';

function fixture(count = 0) {
  const player = new CarSimulation(), scene = new THREE.Scene();
  const runtime = createVehicleRuntime(scene, THREE, count);
  runtime.registerRole('police', { maxCount: 2, update: () => ({ control: { brake: 1 } }) });
  runtime.attachPhysics(player);
  return { runtime, player, scene };
}

test('warm-up yields between factories, keeps storage idle, and is idempotent', async () => {
  const {runtime, player, scene} = fixture(60);
  let yields = 0, lastCreated = 0;
  const result = await runtime.warmupVehicles({ yieldFrame: async () => {
    const created = Object.values(runtime.poolStats()).reduce((sum, p) => sum + p.created, 0);
    assert.ok(created - lastCreated <= 1); lastCreated = created; yields++;
    assert.equal(runtime.states.length, 0); assert.equal(scene.children.length, 0);
    assert.equal(player.world.bodies.length, 2);
    assert.equal(player.world._listeners.beginContact.length, 1);
  }});
  assert.equal(result.cancelled, false); assert.equal(yields, 302);
  assert.equal(runtime.poolStats().civilian.free, 300); assert.equal(runtime.poolStats().police.free, 2);
  await runtime.warmupVehicles({yieldFrame:async()=>assert.fail('already prepared')});
  runtime.dispose(); assert.equal(player.world.bodies.length,2);
});

test('frame cadence bounds activation and never catches up hidden or long frames', () => {
  for (const hz of [30,60,120]) {
    const {runtime} = fixture(300);
    assert.equal(runtime.states.length, 0);
    let previousAdd = -Infinity, time = 0;
    for (let i=0;i<12*hz;i++) {
      const before=runtime.states.length;
      time+=1/hz; runtime.advanceSpawnFrame(1/hz);
      assert.ok(runtime.states.length-before<=1);
      if(runtime.states.length>before) { assert.ok(time-previousAdd>=.025-1e-9);previousAdd=time; }
      // Physics catch-up must not activate additional vehicles.
      for(let j=0;j<4;j++) runtime.prepare(STEP);
    }
    assert.equal(runtime.status().count,300);
    runtime.setCount(0);runtime.advanceSpawnFrame(.025);
    runtime.setCount(60);runtime.advanceSpawnFrame(5,{active:false});
    assert.equal(runtime.status().count,0);
    runtime.advanceSpawnFrame(.001);assert.equal(runtime.status().count,0);
    runtime.advanceSpawnFrame(10);assert.equal(runtime.status().count,1);
    runtime.advanceSpawnFrame(.001);assert.equal(runtime.status().count,1);
    runtime.dispose();
  }
});

test('full prepared capacity and repeated arbitrary removal never evict variants', async () => {
  const {runtime} = fixture();
  await runtime.warmupVehicles({yieldFrame:async()=>{}});
  for(let cycle=0;cycle<10;cycle++) {
    runtime.setCount(300);
    for(let i=0;i<300;i++) runtime.advanceSpawnFrame(.025);
    assert.equal(runtime.status().count,300);
    const old=runtime.states[1]; runtime.remove(old.id); runtime.setCount(300); runtime.advanceSpawnFrame(.025);
    assert.equal(runtime.status().count,300); assert.equal(old.simulation,null);
    runtime.setCount(0);runtime.advanceSpawnFrame(.025);
  }
  const pool=runtime.poolStats().civilian;
  assert.equal(pool.created,300);assert.equal(pool.evicted,0);assert.equal(pool.overflow,0);
  assert.equal(pool.free,300);runtime.dispose();
});

test('jittered frames respect the minimum interval without accumulating spawn debt', () => {
  const {runtime}=fixture(60);let time=0, previous=-Infinity;
  const intervals=[.002,.009,.017,.041,.003,.08,.011,.006];
  for(let frame=0;frame<400&&runtime.status().pending;frame++) {
    const dt=intervals[frame%intervals.length];time+=dt;
    const count=runtime.status().count;runtime.advanceSpawnFrame(dt);
    if(runtime.status().count>count) {
      assert.equal(runtime.status().count-count,1);assert.ok(time-previous>=.025-1e-9);previous=time;
    }
  }
  assert.equal(runtime.status().count,60);runtime.dispose();
});

test('count cancellation and blocked searches stay bounded and retry safely', () => {
  const {runtime} = fixture();
  runtime.setCount(300); runtime.setCount(0);runtime.advanceSpawnFrame(10);
  assert.equal(runtime.status().count,0); assert.equal(runtime.status().pending,false);
  runtime.setSpawnObstacles([{x:0,z:0,halfX:10000,halfZ:10000}]);runtime.setCount(60);
  for(let i=0;i<5;i++) {runtime.advanceSpawnFrame(.025);assert.ok(runtime.performance().spawnChecks<=256);}
  assert.equal(runtime.status().count,0);assert.equal(runtime.status().pending,true);
  runtime.setSpawnObstacles([]);runtime.advanceSpawnFrame(.025);assert.equal(runtime.status().count,1);
  runtime.dispose();
});

test('warm-up cancellation, errors, retry and new world generations are safe', async () => {
  const {runtime,player}=fixture();let yields=0;
  await assert.rejects(runtime.warmupVehicles({yieldFrame:async()=>{if(++yields===3)throw Error('retry');}}),/retry/);
  assert.equal(runtime.poolStats().civilian.created,3);
  await runtime.warmupVehicles({yieldFrame:async()=>{}});
  const world=new CarSimulation();runtime.attachPhysics(world);
  const cancelled=await runtime.warmupVehicles({yieldFrame:async()=>runtime.dispose()});
  assert.equal(cancelled.cancelled,true);assert.equal(player.world.bodies.length,2);assert.equal(world.world.bodies.length,2);
  const next=fixture();const newPlayer=new CarSimulation();let switched=false;
  const stale=await next.runtime.warmupVehicles({yieldFrame:async()=>{if(!switched){switched=true;next.runtime.attachPhysics(newPlayer);}}});
  assert.equal(stale.cancelled,true);
  await next.runtime.warmupVehicles({yieldFrame:async()=>{}});
  assert.equal(next.runtime.poolStats().civilian.free,300);next.runtime.dispose();
});

test('visual preparation uploads shared civilian variants and each unique police body once', async () => {
  const {runtime}=fixture();const meshes=[];
  await runtime.warmupVehicles({yieldFrame:async()=>{},prepareVisual:async mesh=>meshes.push(mesh)});
  const police=meshes.filter(mesh=>mesh.userData.damageableBody);
  assert.equal(police.length,2);
  assert.notEqual(police[0].userData.damageableBody.geometry,police[1].userData.damageableBody.geometry);
  const count=meshes.length;
  await runtime.warmupVehicles({yieldFrame:async()=>{},prepareVisual:async mesh=>meshes.push(mesh)});
  assert.equal(meshes.length,count);runtime.dispose();
});
