import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createVehicleRuntime } from '../src/traffic.js';

const settle = (runtime, count) => {
  runtime.setCount(count);
  for (let i = 0; i < 300 && runtime.status().pending; i++) runtime.prepare(.11);
  assert.equal(runtime.status().pending, false);
  assert.equal(runtime.status().count, count);
};

test('twenty traffic cycles reuse bounded storage and invalidate old actors/listeners', () => {
  const player = new CarSimulation();
  const scene = new THREE.Scene(), runtime = createVehicleRuntime(scene, THREE, 0);
  runtime.attachPhysics(player); settle(runtime, 300);
  const bodies = new Set(runtime.simulations.map(sim => sim.body));
  const old = runtime.states[0], simulation = old.simulation, mesh = old.mesh;
  simulation.damage = .9; simulation.body.velocity.set(8, 2, 1);
  simulation.wheels[0].lateral = 10; simulation.wheels[0].load = 2000;
  old.ai.playerImpactPending = false;
  player.impactCooldowns.set(`${simulation.body.id}:0:0:0`, player.time);
  const firstCreated = runtime.poolStats().civilian.created;
  for (let cycle = 0; cycle < 20; cycle++) {
    for (const count of [0, 60, 300, 0, 60]) settle(runtime, count);
    assert.equal(runtime.poolStats().civilian.created, firstCreated);
    assert.equal(runtime.poolStats().civilian.active + runtime.poolStats().civilian.free, 300);
    assert.equal(runtime.poolStats().civilian.overflow, 0);
    assert.equal(new Set(runtime.simulations).size, runtime.states.length);
    assert.ok(runtime.simulations.every(sim => bodies.has(sim.body)));
  }
  assert.equal(old.active, false); assert.equal(old.simulation, null); assert.equal(old.mesh, null);
  assert.equal(old.pool, undefined); assert.equal(old.lease, undefined);
  old.collideListener({ body: player.body, contact: { getImpactVelocityAlongNormal: () => 20 } });
  assert.equal(old.ai.playerImpactPending, false);
  assert.ok(!player.impactCooldowns.has(`${simulation.body.id}:0:0:0`));
  assert.ok(runtime.states.every(state => state.id !== old.id));
  assert.ok(runtime.simulations.every(sim => sim.damage === 0));
  assert.equal(mesh.geometry, undefined); // Group storage, shared shapes belong to the asset owner.
  runtime.dispose(); runtime.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(player.world.bodies.length, 2);
  assert.equal(player.world._listeners.beginContact.length, 1);
  assert.throws(()=>runtime.setCount(1),/disposed/);
  assert.throws(()=>runtime.attachPhysics(player),/disposed/);
  assert.throws(()=>runtime.requestSpawn({role:'civilian'}),/disposed/);
});

test('new world and visual generations retire both active and idle vehicle storage', () => {
  const firstWorld=new CarSimulation(),secondWorld=new CarSimulation(),scene=new THREE.Scene();
  const runtime=createVehicleRuntime(scene,THREE,4);
  runtime.attachPhysics(firstWorld);settle(runtime,4);
  const old=runtime.states[0],storage=old.simulation;
  runtime.attachPhysics(secondWorld);settle(runtime,4);
  assert.equal(firstWorld.world.bodies.length,2);assert.equal(old.simulation,null);
  assert.ok(runtime.simulations.every(sim=>sim.world===secondWorld.world&&sim!==storage));
  settle(runtime,0);
  let ownerDisposals=0;
  const assets={civilian:[{}],dispose(){ownerDisposals++;}};
  runtime.setVisualAssets(assets);
  assert.deepEqual(runtime.poolStats(),{});
  runtime.dispose();runtime.dispose();assert.equal(ownerDisposals,1);
  assert.equal(secondWorld.world.bodies.length,2);assert.equal(scene.children.length,0);
});

test('a reused police body has fresh contact episodes, damage and one listener', () => {
  const player = new CarSimulation({ spawn: { x: 0, y: .96, z: 0, yaw: 0 } });
  const runtime = createVehicleRuntime(new THREE.Scene(), THREE, 0);
  runtime.registerRole('police', { maxCount: 2, update: () => ({ control: { brake: 1 } }) });
  runtime.attachPhysics(player);
  const request = () => runtime.requestSpawn({ role: 'police', position: { x: 0, y: 0, z: 10 }, yaw: 0 });
  const first = request(); assert.equal(first.status, 'created');
  const old = runtime.states[0], storage = old.simulation;
  storage.damage = 1; storage.wheels[0].load = 99; storage.body.velocity.set(9, 2, 3);
  player.world.bodyOverlapKeeper.set(player.body.id, storage.body.id);
  player.world.bodyOverlapKeeper.previous.push(player.world.bodyOverlapKeeper.getKey(player.body.id, storage.body.id));
  player.world.shapeOverlapKeeper.set(player.body.shapes[0].id, storage.body.shapes[0].id);
  runtime.remove(first.id);
  assert.equal(player.world.bodyOverlapKeeper.current.length, 0);
  assert.equal(player.world.bodyOverlapKeeper.previous.length, 0);
  const second = request(); assert.equal(second.status, 'created'); assert.notEqual(first.id, second.id);
  const fresh = runtime.states[0]; assert.equal(fresh.simulation, storage);
  assert.equal(storage.damage, 0); assert.equal(storage.wheels[0].load, 0);
  assert.equal(storage.body.velocity.length(), 0);
  assert.equal(storage.body._listeners.collide.length, 1);
  assert.equal(player.world._listeners.beginContact.length, 2);
  // The same physical storage must produce a new real beginContact after release/acquire.
  let contacts = 0;
  player.world.addEventListener('beginContact', event => {
    if (event.bodyA === storage.body || event.bodyB === storage.body) contacts++;
  });
  storage.body.position.set(0, .96, 5); storage.body.aabbNeedsUpdate = true;
  player.body.velocity.set(0, 0, 10);
  for (let i = 0; i < 60; i++) runtime.stepWorld({ throttle: 1 }, STEP);
  assert.ok(contacts > 0); assert.ok(storage.damage > 0);
  runtime.dispose(); assert.equal(storage.body._listeners.collide.length, 0);
});
