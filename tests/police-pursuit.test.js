import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createCityPlan } from '../src/city-generator.js';
import { createRoadGraph } from '../src/traffic-ai.js';
import { createVehicleRuntime } from '../src/traffic.js';
import { corridorBlocked, createPolicePursuit } from '../src/police-pursuit.js';
import { findSafeSpawnPose, validateSpawnGeometry } from '../src/vehicle-spawn.js';
import { footprintsOverlap } from '../src/traffic-spawn.js';

const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
const carPose = (x, z, yaw = 0) => ({ x, y: 0, z, yaw });

test('exact spawn rejects bad geometry while explicit nearest-safe reports its moved pose', () => {
  for (const position of [carPose(0, 0), carPose(94, 0), carPose(30, 30)]) {
    assert.equal(findSafeSpawnPose({ position }, { bounds }).status, 'created', `safe pose rejected at ${position.x},${position.z}`);
  }
  const obstacle = { x: 0, z: 0, halfX: 5, halfZ: 5, heading: 0 };
  assert.equal(validateSpawnGeometry({ position: carPose(0, 0), bounds, obstacles: [obstacle] }).reason, 'blocked-by-building');
  assert.equal(findSafeSpawnPose({ position: carPose(0, 0) }, { bounds, obstacles: [obstacle] }).reason, 'blocked-by-building');
  const nearby = findSafeSpawnPose({ position: carPose(0, 0), options: { placement: 'nearest-safe', maxDistance: 30 } },
    { bounds, obstacles: [obstacle] });
  assert.equal(nearby.status, 'created');
  assert.ok(nearby.distance > 0 && nearby.distance <= 30);
  assert.equal(footprintsOverlap({ x: nearby.pose.x, z: nearby.pose.z, heading: nearby.pose.yaw }, obstacle, 0.2), false);
  assert.equal(findSafeSpawnPose({ position: carPose(102, 0), options: { placement: 'nearest-safe' } }, { bounds }).reason, 'out-of-bounds');
  assert.equal(findSafeSpawnPose({ position: { x: NaN, y: 0, z: 0 } }, { bounds }).reason, 'invalid-pose');
});

test('spawn safety reports occupied exact poses as pending and blocks closing followers', () => {
  const candidate = carPose(0, 0), occupant = { id: 'npc-test', x: 0, z: -10, heading: 0, vx: 0, vz: 10 };
  const result = findSafeSpawnPose({ position: candidate }, { bounds, occupants: [occupant] });
  assert.deepEqual(result, { status: 'pending', reason: 'occupied' });
  assert.equal(findSafeSpawnPose({ position: candidate }, { bounds, occupants: [occupant], ownerId: 'npc-test' }).status, 'created');
});

test('police plans a real corridor detour around a rotated building', () => {
  const block = { x: 0, z: 8, halfX: 6, halfZ: 8, heading: Math.PI / 4 };
  assert.equal(corridorBlocked({ x: 0, z: 0 }, { x: 0, z: 16 }, [block]), true);
  assert.equal(corridorBlocked({ x: -20, z: 0 }, { x: -20, z: 16 }, [block]), false);
  const controller = createPolicePursuit();
  const plan = createCityPlan();
  const graph = createRoadGraph(plan.roadNetwork);
  const result = controller.update({ car: { id: 'police', x: -12, z: 0, heading: 0, vx: 0, vz: 0 },
    target: { id: 'player', x: 0, z: 16, heading: 0, vx: 0, vz: 0 }, graph, obstacles: [block], time: 0.1, dt: 0.1 });
  assert.equal(result.sightBlocked, true);
  assert.equal(result.state, 'intercept');
  assert.equal(result.control.brake, 0);
});

test('police role uses the shared world, pursues through collision, and disposes cleanly', () => {
  const plan = createCityPlan(), scene = new THREE.Scene(), player = new CarSimulation();
  const runtime = createVehicleRuntime(scene, THREE, 0, plan.roadNetwork, plan.roadWidth, [], bounds);
  runtime.attachPhysics(player);
  runtime.registerRole('police', { maxCount: 1, physicalOnly: true,
    create: ({ targetId }) => createPolicePursuit({ targetId }),
    update: (controller, context) => controller.update(context),
    onContact: (controller, time) => controller.onContact(time),
    reset: controller => controller.reset() });
  try {
    const result = runtime.requestSpawn({ role: 'police', targetId: 'player', position: carPose(0, -24), yaw: 0 });
    assert.equal(result.status, 'created');
    const police = runtime.states.find(state => state.role === 'police');
    assert.ok(police);
    assert.deepEqual(police.simulation.tuning, player.tuning);
    assert.equal(runtime.status().roleCounts.police, 1);
    assert.equal(runtime.status().totalCount, 1);
    let stoppedFor = 0;
    let maxPoliceSpeed = 0;
    for (let tick = 0; tick < 40 / STEP; tick++) {
      runtime.stepWorld({}, STEP);
      const speed = Math.hypot(player.body.velocity.x, player.body.velocity.z);
      stoppedFor = police.ai.roleState.diagnostics().lastContactAt > 0 && speed < 0.5 ? stoppedFor + STEP : 0;
      maxPoliceSpeed = Math.max(maxPoliceSpeed, police.speed);
    }
    assert.ok(maxPoliceSpeed > 5, `police did not pursue: ${maxPoliceSpeed}`);
    assert.ok(police.ai.roleState.diagnostics().lastContactAt > 0, 'pursuit did not make physical contact with the player');
    assert.ok(stoppedFor >= 2, `police did not hold the coasting target below 0.5m/s for 2s: ${stoppedFor}`);
    assert.equal(police.logical, false);
    const held = runtime.requestSpawn({ role: 'police', targetId: 'player', position: result.pose, yaw: 0 });
    assert.equal(held.status, 'rejected');
    assert.equal(held.reason, 'capacity');
    const bodiesBeforeRemoval = player.world.bodies.length;
    assert.equal(runtime.remove(police.id), true);
    assert.equal(player.world.bodies.length, bodiesBeforeRemoval - 1);
    assert.equal(runtime.status().totalCount, 0);
    const baselineBodies = player.world.bodies.length, baselineMeshes = scene.children.length;
    const spawnSpec = { targetId: 'player', position: carPose(0, -24), yaw: 0 };
    assert.equal(runtime.setRoleCount('police', 1, [spawnSpec])[0].status, 'created');
    assert.equal(runtime.setRoleCount('police', 0).length, 0);
    for (let cycle = 0; cycle < 12; cycle++) {
      const spawned = runtime.requestSpawn({ role: 'police', ...spawnSpec });
      assert.equal(spawned.status, 'created');
      assert.equal(runtime.remove(spawned.id), true);
      assert.equal(player.world.bodies.length, baselineBodies, `orphan physics body after cycle ${cycle + 1}`);
      assert.equal(scene.children.length, baselineMeshes, `orphan visual after cycle ${cycle + 1}`);
    }
    assert.equal(runtime.setRoleCount('police', 1, [spawnSpec])[0].status, 'created');
    assert.equal(runtime.status().roleCounts.police, 1);
  } finally { runtime.dispose(); player.dispose?.(); }
});

test('police role retains at least 90% of player acceleration on a clear straight', () => {
  const plan = createCityPlan(), scene = new THREE.Scene(), player = new CarSimulation();
  const runtime = createVehicleRuntime(scene, THREE, 0, plan.roadNetwork, plan.roadWidth, [], { minX: -200, maxX: 200, minZ: -200, maxZ: 200 });
  runtime.attachPhysics(player);
  runtime.registerRole('police', { maxCount: 1, physicalOnly: true,
    create: ({ targetId }) => createPolicePursuit({ targetId }),
    update: (controller, context) => controller.update(context),
    onContact: (controller, time) => controller.onContact(time), reset: controller => controller.reset() });
  try {
    const result = runtime.requestSpawn({ role: 'police', targetId: 'player', position: carPose(0, -80), yaw: 0 });
    assert.equal(result.status, 'created');
    const police = runtime.states.find(state => state.role === 'police');
    for (let tick = 0; tick < 10 / STEP; tick++) runtime.stepWorld({ throttle: 1 }, STEP);
    const playerSpeed = Math.hypot(player.body.velocity.x, player.body.velocity.z);
    assert.ok(playerSpeed > 10, `player acceleration fixture invalid: ${playerSpeed}`);
    assert.ok(police.speed >= playerSpeed * 0.9,
      `police speed ${police.speed.toFixed(2)}m/s is below 90% of player ${playerSpeed.toFixed(2)}m/s`);
  } finally { runtime.dispose(); player.dispose?.(); }
});
