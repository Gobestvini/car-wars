import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createTraffic } from '../src/traffic.js';
import { createCityPlan } from '../src/city-generator.js';
import { createRoadGraph } from '../src/traffic-ai.js';
import { createTrafficSpawnSlots } from '../src/traffic-spawn.js';
import { footprintsOverlap, TRAFFIC_SPAWN } from '../src/traffic-spawn.js';

function integrate(physics, traffic, input = {}) {
  physics.prepare(input, STEP);
  traffic.prepare(STEP);
  physics.world.step(STEP);
  physics.postStep(STEP);
  traffic.postStep(STEP);
}

test('real-city NPC spawn and reset retain the independently expected right side at every width', () => {
  for (const width of [12, 15, 20, 30]) {
    const plan = createCityPlan(undefined, { roadWidth: width });
    const player = new CarSimulation();
    const traffic = createTraffic(new THREE.Scene(), THREE, 60, plan.roadNetwork, width);
    traffic.attachPhysics(player);
    for (let tick = 0; tick < 100 && traffic.status().pending; tick++) traffic.prepare(0.1);
    const check = () => {
      const directions = new Set();
      for (const state of traffic.states) {
        const from = plan.roadNetwork.intersections.find(node => node.id === state.ai.fromNode);
        const to = plan.roadNetwork.intersections.find(node => node.id === state.ai.targetNode);
        const dx = Math.sign(to.x - from.x), dz = Math.sign(to.z - from.z), offset = Math.min(5.2, width / 4);
        directions.add(`${dx},${dz}`);
        if (dx) assert.equal(state.simulation.spawn.z, from.z + dx * offset);
        else assert.equal(state.simulation.spawn.x, from.x - dz * offset);
      }
      assert.equal(directions.size, 4);
    };
    check(); traffic.reset(); check(); traffic.dispose();
  }
});

test('split single-car stepping matches the standalone solver and uses one world integration', () => {
  const standalone = new CarSimulation();
  const shared = new CarSimulation();
  const scene = new THREE.Scene();
  const traffic = createTraffic(scene, THREE, 0);
  traffic.attachPhysics(shared);
  const originalStep = shared.world.step.bind(shared.world);
  let steps = 0;
  shared.world.step = (...args) => { steps++; return originalStep(...args); };
  for (let i = 0; i < 240; i++) {
    const input = { throttle: i < 160 ? 0.7 : 0, steer: i > 90 && i < 170 ? 0.3 : 0 };
    standalone.step(input, STEP);
    traffic.stepWorld(input, STEP);
  }
  assert.equal(steps, 240);
  assert.ok(shared.body.position.distanceTo(standalone.body.position) < 1e-8);
  assert.ok(shared.body.velocity.distanceTo(standalone.body.velocity) < 1e-8);
  traffic.dispose();
});

test('two shared-world cars exchange momentum in a real chassis contact', () => {
  const player = new CarSimulation({ spawn: { x: 0, y: 0.96, z: -2.5, yaw: 0 } });
  const npc = new CarSimulation({ world: player.world, materials: player.materials,
    spawn: { x: 0, y: 0.96, z: 2.5, yaw: Math.PI }, damage: false });
  player.body.velocity.z = 8;
  npc.body.velocity.z = -3;
  const playerStart = player.body.velocity.z, npcStart = npc.body.velocity.z;
  for (let i = 0; i < 36; i++) {
    player.prepare({}, STEP); npc.prepare({}, STEP);
    player.world.step(STEP);
    player.postStep(STEP); npc.postStep(STEP);
  }
  assert.ok(player.body.velocity.z < playerStart - 1, `player velocity did not respond to contact: ${player.body.velocity.z}`);
  assert.ok(npc.body.velocity.z > npcStart + 1, `NPC velocity did not respond to contact: ${npc.body.velocity.z}`);
  assert.ok(player.world.bodies.includes(npc.body));
});

test('front, rear, and side contacts transfer momentum through the same chassis solver', () => {
  const scenarios = [
    { name: 'front', player: { x: 0, z: -2.5, yaw: 0, speed: 8 }, npc: { x: 0, z: 2.5, yaw: Math.PI, speed: -3 }, axis: 'z', playerSign: -1, npcSign: 1 },
    { name: 'rear', player: { x: 0, z: 2.5, yaw: 0, speed: 2 }, npc: { x: 0, z: -2.5, yaw: 0, speed: 9 }, axis: 'z', playerSign: 1, npcSign: -1 },
    { name: 'side', player: { x: -2.5, z: 0, yaw: Math.PI / 2, speed: 8 }, npc: { x: 2.5, z: 0, yaw: -Math.PI / 2, speed: -3 }, axis: 'x', playerSign: -1, npcSign: 1 },
  ];
  for (const scenario of scenarios) {
    const player = new CarSimulation({ spawn: { x: scenario.player.x, y: 0.96, z: scenario.player.z, yaw: scenario.player.yaw } });
    const npc = new CarSimulation({ world: player.world, materials: player.materials,
      spawn: { x: scenario.npc.x, y: 0.96, z: scenario.npc.z, yaw: scenario.npc.yaw }, damage: false });
    player.body.velocity[scenario.axis] = scenario.player.speed;
    npc.body.velocity[scenario.axis] = scenario.npc.speed;
    const playerStart = scenario.player.speed, npcStart = scenario.npc.speed;
    for (let i = 0; i < 36; i++) {
      player.prepare({}, STEP); npc.prepare({}, STEP);
      player.world.step(STEP);
      player.postStep(STEP); npc.postStep(STEP);
    }
    assert.ok((player.body.velocity[scenario.axis] - playerStart) * scenario.playerSign > 1,
      `${scenario.name}: player was not pushed by contact (${player.body.velocity[scenario.axis]})`);
    assert.ok((npc.body.velocity[scenario.axis] - npcStart) * scenario.npcSign > 1,
      `${scenario.name}: NPC was not pushed by contact (${npc.body.velocity[scenario.axis]})`);
  }
});

test('traffic count changes are fixed-step queued and repeated resizing cleans up bodies', () => {
  const physics = new CarSimulation({ spawn: { x: 500, y: 0.96, z: 0, yaw: 0 } });
  const scene = new THREE.Scene();
  const traffic = createTraffic(scene, THREE, 6);
  traffic.attachPhysics(physics);
  const baseBodies = physics.world.bodies.length - traffic.status().count;
  assert.equal(traffic.status().count, 6);
  traffic.setCount(0);
  assert.equal(traffic.status().count, 6, 'requested count is applied at next tick');
  assert.equal(traffic.status().requestedCount, 0);
  traffic.stepWorld({}, STEP);
  assert.equal(traffic.status().count, 0);
  for (let round = 0; round < 10; round++) {
    for (const count of [30, 1, 6]) {
      traffic.setCount(count);
      for (let tick = 0; tick < 100 && (traffic.status().pending || traffic.status().count !== count); tick++) traffic.stepWorld({}, 0.1);
      assert.equal(traffic.status().count, count);
      assert.equal(traffic.status().pending, false);
      assert.equal(physics.world.bodies.length, baseBodies + traffic.status().bodies);
      assert.equal(traffic.status().bodies + traffic.status().logical, count);
    }
    const positions = traffic.states.map(state => [state.x, state.z]);
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      assert.ok(Math.hypot(positions[i][0] - positions[j][0], positions[i][1] - positions[j][1]) > 2.5,
        `traffic spawn overlap ${i}/${j}`);
    }
  }
  traffic.reset();
  traffic.setCount(0); traffic.stepWorld({}, STEP);
  assert.equal(physics.world.bodies.length, baseBodies);
  assert.throws(() => traffic.setCount(301), RangeError);
  assert.throws(() => traffic.setCount(NaN), RangeError);
  traffic.dispose();
});

test('traffic count configuration supports the tenfold 60 default and 300 maximum', () => {
  const physics = new CarSimulation();
  const traffic = createTraffic(new THREE.Scene(), THREE, 60);
  traffic.attachPhysics(physics);
  assert.equal(traffic.status().requestedCount, 60);
  assert.equal(traffic.status().pending, true);
  for (let tick = 0; tick < 100 && traffic.status().pending; tick++) traffic.prepare(0.1);
  assert.equal(traffic.status().count, 60);
  assert.equal(traffic.debug().length, 60);
  traffic.setCount(300);
  for (let tick = 0; tick < 100 && traffic.status().pending; tick++) traffic.prepare(0.1);
  assert.equal(traffic.status().count, 300);
  assert.equal(traffic.status().logical + traffic.status().bodies, 300);
  assert.ok(traffic.states.every(state => [state.x, state.z, state.speed].every(Number.isFinite)));
  traffic.setCount(0); traffic.prepare(STEP);
  assert.equal(traffic.status().count, 0);
  traffic.dispose();
});

test('blocked insertion retains pending count, retries after clearance, and cancels on reduction', () => {
  const network = { intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 50, z: 0 }],
    edges: [{ from: 'a', to: 'b', length: 50 }] };
  const graph = createRoadGraph(network, 5);
  const blockers = createTrafficSpawnSlots(graph.directed).map(slot => ({ x: slot.x, z: slot.z, halfX: 2, halfZ: 2 }));
  const physics = new CarSimulation({ spawn: { x: 500, y: 0.96, z: 0, yaw: 0 } });
  const traffic = createTraffic(new THREE.Scene(), THREE, 4, network, 20, blockers);
  traffic.attachPhysics(physics);
  assert.deepEqual(traffic.status(), { count: 0, requestedCount: 4, pending: true,
    insertionReason: 'Нет свободного безопасного места', bodies: 0, logical: 0, visible: 0, reservations: 0 });
  traffic.setSpawnObstacles([]);
  traffic.prepare(0.11);
  assert.equal(traffic.status().count, 4);
  assert.equal(traffic.status().pending, false);
  traffic.setCount(0);
  traffic.prepare(STEP);
  assert.equal(traffic.status().count, 0);
  assert.equal(traffic.status().pending, false);
  traffic.dispose();
});

test('repeated resets preserve NPC identities and place every oriented footprint safely', () => {
  const network = { intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 500, z: 0 }],
    edges: [{ from: 'a', to: 'b', length: 500 }] };
  const physics = new CarSimulation({ spawn: { x: 250, y: 0.96, z: 100, yaw: 0 } });
  const traffic = createTraffic(new THREE.Scene(), THREE, 60, network, 20);
  traffic.attachPhysics(physics);
  const ids = traffic.states.map(state => state.id);
  const playerBodies = physics.world.bodies.length - traffic.status().bodies;
  for (let round = 0; round < 10; round++) {
    traffic.reset();
    assert.deepEqual(traffic.states.map(state => state.id), ids);
    const footprints = traffic.states.map(state => ({ x: state.x, z: state.z, heading: state.heading }));
    for (let i = 0; i < footprints.length; i++) {
      assert.equal(footprintsOverlap(footprints[i], { x: physics.body.position.x, z: physics.body.position.z,
        heading: Math.atan2(2 * (physics.body.quaternion.x * physics.body.quaternion.z + physics.body.quaternion.w * physics.body.quaternion.y),
          1 - 2 * (physics.body.quaternion.x ** 2 + physics.body.quaternion.y ** 2)) }, TRAFFIC_SPAWN.minimumGap), false);
      for (let j = 0; j < i; j++) assert.equal(footprintsOverlap(footprints[i], footprints[j], TRAFFIC_SPAWN.minimumGap), false);
    }
  }
  assert.equal(physics.world.bodies.length, playerBodies + traffic.status().bodies);
  traffic.dispose();
  assert.equal(physics.world.bodies.length, playerBodies);
});

test('distant traffic swaps to logical route motion and becomes physical near the player', () => {
  const network = { intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 1000, z: 0 }],
    edges: [{ from: 'a', to: 'b', length: 1000 }] };
  const physics = new CarSimulation({ spawn: { x: 500, y: 0.96, z: 0, yaw: 0 } });
  const traffic = createTraffic(new THREE.Scene(), THREE, 1, network, 20);
  traffic.attachPhysics(physics);
  traffic.prepare(0.11);
  assert.equal(traffic.status().logical, 1);
  assert.equal(traffic.status().bodies, 0);
  const state = traffic.states[0];
  const start = state.simulation.body.position.clone();
  for (let i = 0; i < 120; i++) traffic.stepWorld({}, STEP);
  assert.ok(state.simulation.body.position.distanceTo(start) > 0.5, 'logical NPC should continue along its route');
  assert.ok(Math.abs(state.z - 5) < 0.01, 'logical eastbound car stays on the independently expected right lane');
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 20, 0); camera.lookAt(0, 20, -100); camera.updateMatrixWorld();
  traffic.render(1, camera);
  assert.equal(traffic.status().visible, 0, 'traffic outside the camera frustum should not be drawn');
  physics.body.position.set(state.x - 20, 0.96, state.z); physics.body.aabbNeedsUpdate = true;
  const beforeSwitch = state.simulation.body.position.clone();
  const beforeHeading = state.heading;
  traffic.prepare(0.11);
  assert.equal(traffic.status().logical, 0);
  assert.equal(traffic.status().bodies, 1);
  assert.ok(physics.world.bodies.includes(state.simulation.body));
  assert.ok(state.simulation.body.position.distanceTo(beforeSwitch) <= 8.5 * 0.11,
    'LOD switch adds no jump beyond the elapsed logical movement');
  assert.equal(state.simulation.body.position.z, beforeSwitch.z, 'LOD does not reflect the lane');
  assert.equal(state.heading, beforeHeading);
  traffic.render(1, camera);
  assert.equal(traffic.status().visible, 0);
  assert.ok(physics.world.bodies.includes(state.simulation.body), 'frustum culling must not disable nearby collision physics');
  traffic.dispose();
});

test('physical LOD does not cascade across remote neighbors or retain a ground-only contact', () => {
  const network = { intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 500, z: 0 }],
    edges: [{ from: 'a', to: 'b', length: 500 }] };
  const player = new CarSimulation({ spawn: { x: 15, y: 0.96, z: 5, yaw: Math.PI / 2 } });
  const traffic = createTraffic(new THREE.Scene(), THREE, 6, network, 20);
  traffic.attachPhysics(player);
  const remote = traffic.states.find(state => state.x > 100);
  assert.ok(remote && !remote.logical);
  player.world.contacts.push({ bi: player.ground, bj: remote.simulation.body });
  traffic.prepare(0.11);
  assert.equal(remote.logical, true, 'a remote ground contact is not a traffic interaction');
  assert.ok(traffic.states.filter(state => !state.logical).every(state =>
    Math.hypot(state.x - player.body.position.x, state.z - player.body.position.z) < 55));
  traffic.dispose();
});
