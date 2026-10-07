import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createCityPlan } from '../src/city-generator.js';
import { createRoadGraph } from '../src/traffic-ai.js';
import { createVehicleRuntime } from '../src/traffic.js';
import { corridorBlocked, createPolicePursuit } from '../src/police-pursuit.js';
import { findSafeSpawnPose, validateSpawnGeometry } from '../src/vehicle-spawn.js';
import { footprintsOverlap } from '../src/traffic-spawn.js';

const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
const carPose = (x, z, yaw = 0) => ({ x, y: 0, z, yaw });

function stalledPursuit({ car = {}, target = {}, obstacles = [], occupants = [] } = {}) {
  const controller = createPolicePursuit();
  const context = { car: { id: 'police', x: 0, z: 0, heading: 0, vx: 0, vz: 0, ...car },
    target: { id: 'player', x: 0, z: 30, heading: 0, vx: 0, vz: 0, ...target },
    graph: createRoadGraph(createCityPlan().roadNetwork), obstacles, occupants, dt: 0.1 };
  let result;
  for (let tick = 0; tick < 18; tick++) result = controller.update({ ...context, time: tick * 0.1 });
  return { controller, context, result };
}

test('stalled police reverse away from a building and another police car, even near the player', () => {
  for (const heading of [0, Math.PI / 3]) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    for (const kind of ['building', 'police']) {
      const blocker = { id: 'other-police', x: fx * 4.2, z: fz * 4.2, heading, vx: 0, vz: 0,
        halfX: 3, halfZ: 2.08 };
      const { result } = stalledPursuit({ car: { heading }, target: { x: fx * 8, z: fz * 8 },
        obstacles: kind === 'building' ? [blocker] : [], occupants: kind === 'police' ? [blocker] : [] });
      assert.equal(result.reason, 'unstuck-reverse', `${kind}, heading ${heading}`);
      assert.ok(result.control.throttle < 0);
      assert.equal(result.control.brake, 0);
    }
  }
});

test('rear traffic and walls prevent reversing into a second collision', () => {
  for (const kind of ['building', 'police']) {
    const blocker = { id: 'rear', x: 0, z: -4.2, heading: 0, vx: 0, vz: 0, halfX: 4, halfZ: 2.08 };
    const { result } = stalledPursuit({ obstacles: kind === 'building' ? [blocker] : [],
      occupants: kind === 'police' ? [blocker] : [] });
    assert.ok(result.control.throttle >= 0, kind);
    assert.notEqual(result.reason, 'unstuck-reverse');
  }
});

test('reverse speed is bounded and a newly occupied rear corridor cancels throttle', () => {
  const { controller, context } = stalledPursuit();
  const cruising = controller.update({ ...context, car: { ...context.car, vz: -2.5 }, time: 1.8 });
  assert.equal(cruising.reason, 'unstuck-reverse');
  assert.equal(Math.abs(cruising.control.throttle), 0);
  const blocked = controller.update({ ...context, occupants: [{ id: 'rear', x: 0, z: -4.2,
    heading: 0, vx: 0, vz: 0 }], time: 1.9 });
  assert.equal(blocked.reason, 'escape-blocked');
  assert.equal(blocked.control.throttle, 0);
  assert.equal(blocked.control.brake, 1);
});

test('an approaching target does not hide a police car stuck at the same position', () => {
  const { controller, context } = stalledPursuit({ car: { vz: 3 } });
  let result;
  for (let tick = 0; tick < 18; tick++) result = controller.update({ ...context,
    car: { ...context.car, vz: 0 }, target: { ...context.target, z: 30 - tick * 0.3, vz: -3 },
    time: 2 + tick * 0.1 });
  assert.equal(result.reason, 'unstuck-reverse');
  assert.ok(result.control.throttle < 0);
});

test('recovery completes, brakes reverse motion before pursuit and resets cleanly', () => {
  const { controller, context, result } = stalledPursuit();
  assert.equal(result.reason, 'unstuck-reverse');
  const turn = controller.update({ ...context, car: { ...context.car, z: -4, vz: -2 }, time: 1.8 });
  assert.equal(turn.reason, 'unstuck-turn');
  assert.equal(turn.control.throttle, 0);
  assert.equal(turn.control.brake, 1);
  const resumed = controller.update({ ...context, car: { ...context.car, z: -4, vz: -1 }, time: 3.1 });
  assert.notEqual(resumed.state, 'recover');
  assert.equal(resumed.control.throttle, 0);
  assert.equal(resumed.control.brake, 1);
  controller.reset();
  assert.equal(controller.diagnostics().escapePhase, null);
  assert.equal(controller.diagnostics().stalledTime, 0);
});

test('moving police and police holding a stopped target do not trigger reverse recovery', () => {
  const moving = stalledPursuit({ car: { vz: 3 }, target: { vz: 5 } });
  assert.notEqual(moving.result.reason, 'unstuck-reverse');
  const controller = createPolicePursuit();
  controller.onContact(0);
  const context = { car: { id: 'police', x: 0, z: -4.2, heading: 0, vx: 0, vz: 0 },
    target: { id: 'player', x: 0, z: 0, heading: 0, vx: 0, vz: 0 }, dt: 0.1 };
  for (let tick = 0; tick < 100; tick++) {
    const held = controller.update({ ...context, time: tick * 0.1 });
    assert.equal(held.state, 'maintain-block');
    assert.equal(held.control.throttle, 0);
  }
});

test('shared vehicle physics actually back a stalled police car away from a wall', () => {
  const simulation = new CarSimulation(), controller = createPolicePursuit();
  const wall = { x: 0, z: 3.3, halfX: 4, halfZ: 1, heading: 0 };
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(4, 3, 1)),
    position: new CANNON.Vec3(wall.x, 2, wall.z) });
  simulation.world.addBody(body);
  const graph = { nodes: new Map([['goal', { id: 'goal', x: 0, z: 30 }]]), laneOffset: 5 };
  let reversed = false, reverseDistance = 0, reverseStart = null;
  for (let tick = 0; tick < 8 / STEP; tick++) {
    const car = { id: 'police', x: simulation.body.position.x, z: simulation.body.position.z,
      heading: simulation.telemetry().heading, vx: simulation.body.velocity.x, vz: simulation.body.velocity.z };
    const result = controller.update({ car, target: { id: 'player', x: 0, z: 30, heading: 0 },
      graph, obstacles: [wall], time: tick * STEP, dt: STEP });
    if (result.reason === 'unstuck-reverse') {
      reversed = true; reverseStart ??= car.z;
      reverseDistance = Math.max(reverseDistance, reverseStart - car.z);
    }
    simulation.step(result.control, STEP);
  }
  assert.ok(reversed, 'wall collision did not trigger reverse');
  assert.ok(reverseDistance > 1.5, `physical reverse travelled only ${reverseDistance}m`);
});

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
