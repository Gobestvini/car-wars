import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan } from '../src/city-generator.js';
import { chooseRoadGoal, createRoadGraph, createSeededRandom, findRoadRoute, laneTarget, turnDirection } from '../src/traffic-ai.js';
import * as THREE from 'three';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createTraffic } from '../src/traffic.js';

test('right lanes have independent world coordinates in all four directions', () => {
  const graph = createRoadGraph({ intersections: [{ id: 'o', x: 0, z: 0 }, { id: 'e', x: 50, z: 0 },
    { id: 'n', x: 0, z: 50 }], edges: [{ from: 'o', to: 'e', length: 50 }, { from: 'o', to: 'n', length: 50 }] }, 5);
  const at = (from, to) => laneTarget(graph, from, to, 0);
  assert.deepEqual([at('o', 'e').x, at('o', 'e').z], [0, 5]);
  assert.deepEqual([at('e', 'o').x, at('e', 'o').z], [50, -5]);
  assert.deepEqual([at('o', 'n').x, at('o', 'n').z], [-5, 0]);
  assert.deepEqual([at('n', 'o').x, at('n', 'o').z], [5, 50]);
});

test('city street graph is connected, directed into right-side lanes, and supports varied seeded destinations', () => {
  const plan = createCityPlan();
  const graph = createRoadGraph(plan.roadNetwork, 5);
  assert.equal(graph.nodes.size, 64);
  assert.equal(graph.directed.length, 224);
  for (const start of graph.nodes.keys()) for (const goal of graph.nodes.keys()) {
    const route = findRoadRoute(graph, start, goal);
    assert.ok(route && route[0] === start && route.at(-1) === goal, `${start} cannot reach ${goal}`);
  }
  const forward = graph.adjacency.get('-25:-25').find(edge => edge.to === '25:-25');
  const reverse = graph.adjacency.get('25:-25').find(edge => edge.to === '-25:-25');
  assert.equal(forward.start.z, -20);
  assert.equal(reverse.start.z, -30);
  assert.equal(turnDirection(graph, '-25:-25', '25:-25', '25:25'), 'right');
  assert.equal(turnDirection(graph, '-25:-25', '25:-25', '25:-75'), 'left');
  assert.equal(turnDirection(graph, '-25:-25', '25:-25', '75:-25'), 'straight');
  assert.ok(laneTarget(graph, '-25:-25', '25:-25', 1));

  const random = createSeededRandom(1234);
  const goals = Array.from({ length: 8 }, (_, index) => chooseRoadGoal(graph, graph.directed[index].to, random));
  assert.ok(goals.every(Boolean));
  assert.ok(new Set(goals).size >= 5, `seed should choose varied destinations: ${goals}`);
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => chooseRoadGoal(graph, graph.directed[index].to, createSeededRandom(1234 + index))),
    Array.from({ length: 8 }, (_, index) => chooseRoadGoal(graph, graph.directed[index].to, createSeededRandom(1234 + index))));
});

test('no-path and invalid destinations fail safely without non-finite route points', () => {
  const graph = createRoadGraph({ intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 5, z: 0 }, { id: 'x', x: 50, z: 0 }],
    edges: [{ from: 'a', to: 'b', length: 5 }] }, 2);
  assert.deepEqual(findRoadRoute(graph, 'a', 'b'), ['a', 'b']);
  assert.equal(findRoadRoute(graph, 'a', 'x'), null);
  assert.equal(findRoadRoute(graph, 'missing', 'b'), null);
  assert.equal(chooseRoadGoal(graph, 'x', createSeededRandom(1)), null);
  const target = laneTarget(graph, 'a', 'b');
  assert.ok(Number.isFinite(target.x) && Number.isFinite(target.z));
});

test('detour search avoids returning through the blocked junction while retaining the destination', () => {
  const graph = createRoadGraph(createCityPlan().roadNetwork);
  const route = findRoadRoute(graph, '25:75', '75:25', new Set(['25:25']));
  assert.equal(route.at(-1), '75:25');
  assert.ok(!route.includes('25:25'));
  assert.equal(findRoadRoute(graph, '25:25', '75:25', new Set(['25:25'])), null);
});

test('six hybrid AI cars follow varied road paths and replan for two simulated minutes', () => {
  const plan = createCityPlan();
  const player = new CarSimulation();
  const traffic = createTraffic(new THREE.Scene(), THREE, 6, plan.roadNetwork, plan.roadWidth);
  traffic.attachPhysics(player);
  const initial = traffic.debug();
  assert.ok(new Set(initial.map(car => car.goal)).size >= 3);
  const start = traffic.states.map(state => [state.simulation.body.position.x, state.simulation.body.position.z]);
  const previous = start.map(point => [...point]), travel = start.map(() => 0);
  for (let tick = 0; tick < 120 * 120; tick++) {
    traffic.stepWorld({}, STEP);
    traffic.states.forEach((state, index) => {
      travel[index] += Math.hypot(state.x - previous[index][0], state.z - previous[index][1]);
      previous[index] = [state.x, state.z];
    });
  }
  const final = traffic.debug();
  assert.ok(final.reduce((sum, car) => sum + car.completedGoals, 0) >= 3,
    `AI did not reach/replan goals: ${JSON.stringify(final)}`);
  assert.ok(new Set(final.flatMap(car => car.goals)).size >= 6, 'destinations should vary across cars and replans');
  assert.ok(final.every(car => car.route.length >= 2 && car.goal && Number.isFinite(car.seed)));
  assert.ok(traffic.states.every((state, index) => {
    const body = state.simulation.body;
    return [body.position.x, body.position.y, body.position.z, body.velocity.x, body.velocity.y, body.velocity.z].every(Number.isFinite)
      && travel[index] > 100;
  }), `each car should travel through the district, distances: ${travel}; ${JSON.stringify(final)}`);
  traffic.setCount(0); traffic.stepWorld({}, STEP);
  assert.equal(traffic.status().reservations, 0);
  traffic.dispose();
});

test('AI brakes for a stationary player sharing its lane', () => {
  const plan = createCityPlan();
  const player = new CarSimulation();
  const traffic = createTraffic(new THREE.Scene(), THREE, 1, plan.roadNetwork, plan.roadWidth);
  traffic.attachPhysics(player);
  traffic.setSignalController({ phase: () => ({ color: 'green', controlled: true, canEnter: true }) });
  const npc = traffic.states[0].simulation.body;
  const yaw = Math.atan2(2 * (npc.quaternion.x * npc.quaternion.z + npc.quaternion.w * npc.quaternion.y),
    1 - 2 * (npc.quaternion.x ** 2 + npc.quaternion.y ** 2));
  const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
  player.body.position.set(npc.position.x + forwardX * 22, 0.96, npc.position.z + forwardZ * 22);
  player.body.quaternion.copy(npc.quaternion);
  player.body.velocity.setZero(); player.body.angularVelocity.setZero(); player.body.aabbNeedsUpdate = true;
  let minimumGap = Infinity;
  for (let tick = 0; tick < 8 * 120; tick++) {
    traffic.stepWorld({}, STEP);
    const dx = player.body.position.x - npc.position.x, dz = player.body.position.z - npc.position.z;
    minimumGap = Math.min(minimumGap, Math.hypot(dx, dz));
  }
  assert.ok(minimumGap > 4.3, `NPC contacted the stopped player; closest centre gap was ${minimumGap}`);
  assert.ok(Math.hypot(npc.velocity.x, npc.velocity.z) < 1.2, `NPC should stop behind the player: ${Math.hypot(npc.velocity.x, npc.velocity.z)} ${JSON.stringify(traffic.debug()[0])}`);
  assert.ok(['yielding', 'stuck-recovery'].includes(traffic.debug()[0].state));
  traffic.dispose();
});

test('AI detects a stationary leader independently of its commanded speed and passes when a corridor is clear', () => {
  const network = { intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 500, z: 0 }],
    edges: [{ from: 'a', to: 'b', length: 500 }] };
  const player = new CarSimulation();
  const traffic = createTraffic(new THREE.Scene(), THREE, 1, network, 20);
  traffic.attachPhysics(player);
  const npc = traffic.states[0].simulation.body;
  const yaw = Math.atan2(2 * (npc.quaternion.x * npc.quaternion.z + npc.quaternion.w * npc.quaternion.y),
    1 - 2 * (npc.quaternion.x ** 2 + npc.quaternion.y ** 2));
  const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
  player.body.position.set(npc.position.x + forwardX * 8, 0.96, npc.position.z + forwardZ * 8);
  player.body.quaternion.copy(npc.quaternion); player.body.velocity.setZero(); player.body.aabbNeedsUpdate = true;
  const blockerX = player.body.position.x, blockerZ = player.body.position.z;
  let sawManeuver = false, stalledAge = 0;
  for (let tick = 0; tick < 9 * 120; tick++) {
    traffic.stepWorld({}, STEP);
    player.body.position.set(blockerX, 0.96, blockerZ);
    player.body.quaternion.setFromEuler(0, yaw, 0); player.body.velocity.setZero(); player.body.aabbNeedsUpdate = true;
    sawManeuver ||= Boolean(traffic.states[0].ai.maneuver);
    stalledAge = Math.max(stalledAge, traffic.states[0].ai.noProgressTime || 0);
  }
  const [debug] = traffic.debug();
  assert.ok(stalledAge >= 3, JSON.stringify(debug));
  assert.ok(sawManeuver, 'NPC should select a verified clear passing corridor');
  assert.ok(Math.abs(npc.position.z - player.body.position.z) > 1.5,
    `NPC should move laterally around the stopped leader (${npc.position.x}, ${npc.position.z}), speed=${npc.velocity.x},${npc.velocity.z}; ${JSON.stringify(debug)}`);
  traffic.dispose();
});

test('AI waits instead of entering occupied passing lanes when the route corridor is blocked', () => {
  const network = { intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 500, z: 0 }],
    edges: [{ from: 'a', to: 'b', length: 500 }] };
  const player = new CarSimulation();
  const traffic = createTraffic(new THREE.Scene(), THREE, 4, network, 20);
  traffic.attachPhysics(player);
  const primary = traffic.states[0], npc = primary.simulation.body;
  const yaw = Math.atan2(2 * (npc.quaternion.x * npc.quaternion.z + npc.quaternion.w * npc.quaternion.y),
    1 - 2 * (npc.quaternion.x ** 2 + npc.quaternion.y ** 2));
  const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw), rightX = -forwardZ, rightZ = forwardX;
  const originX = npc.position.x, originZ = npc.position.z;
  const setPosition = (body, ahead, offset) => {
    body.position.set(originX + forwardX * ahead + rightX * offset, 0.96, originZ + forwardZ * ahead + rightZ * offset);
    body.quaternion.setFromEuler(0, yaw, 0); body.velocity.setZero(); body.aabbNeedsUpdate = true;
  };
  const blockedOffsets = [2.6, -2.6, -10];
  setPosition(player.body, 8, 0);
  traffic.states.slice(1).forEach((state, index) => setPosition(state.simulation.body, 8, blockedOffsets[index]));
  for (let tick = 0; tick < 9 * 120; tick++) {
    traffic.stepWorld({}, STEP);
    setPosition(player.body, 8, 0);
    traffic.states.slice(1).forEach((state, index) => setPosition(state.simulation.body, 8, blockedOffsets[index]));
  }
  const [debug] = traffic.debug();
  assert.ok(debug.noProgressTime >= 3, JSON.stringify(debug));
  assert.equal(debug.maneuver, null, 'all adjacent and oncoming corridors are occupied');
  assert.equal(debug.state, 'stuck-recovery', JSON.stringify(debug));
  traffic.dispose();
});

test('conflicting paths reserve the same junction for one car with stable id priority', () => {
  const plan = createCityPlan();
  const player = new CarSimulation();
  const traffic = createTraffic(new THREE.Scene(), THREE, 2, plan.roadNetwork, plan.roadWidth);
  traffic.attachPhysics(player);
  traffic.setSignalController({ phase: () => ({ color: 'green', controlled: true, canEnter: true }) });
  const [first, second] = traffic.states;
  const configure = (state, id, from, to, goal, x, z, yaw) => {
    state.id = id; state.ai.id = id;
    state.ai.fromNode = from; state.ai.targetNode = to; state.ai.goalId = goal;
    state.ai.route = [to, goal]; state.ai.routeIndex = 0; state.ai.state = 'following';
    state.simulation.body.position.set(x, 0.96, z);
    state.simulation.body.quaternion.setFromEuler(0, yaw, 0);
    state.simulation.body.velocity.setZero(); state.simulation.body.aabbNeedsUpdate = true;
  };
  configure(first, 'npc-02', '-25:25', '25:25', '75:25', 17, 28.75, Math.PI / 2);
  configure(second, 'npc-01', '25:-25', '25:25', '25:75', 21.25, 17, 0);
  traffic.prepare(0.11);
  assert.equal(traffic.reservations.size, 1, JSON.stringify(traffic.debug()));
  assert.equal(traffic.reservations.get('25:25').id, 'npc-01', 'lower stable id wins an unentered conflict');
  assert.equal(second.ai.state, 'following');
  assert.equal(first.ai.state, 'yielding');
  assert.equal(first.ai.control.brake, 1);
  traffic.dispose();
});

test('conflicting physical traffic crosses a reserved junction without chassis contact', () => {
  const plan = createCityPlan();
  const player = new CarSimulation();
  const traffic = createTraffic(new THREE.Scene(), THREE, 2, plan.roadNetwork, plan.roadWidth);
  traffic.attachPhysics(player);
  traffic.setSignalController({ phase: () => ({ color: 'green', controlled: true, canEnter: true }) });
  const configure = (state, from, to, goal, x, z, yaw) => {
    state.ai.fromNode = from; state.ai.targetNode = to; state.ai.goalId = goal;
    state.ai.route = [to, goal]; state.ai.routeIndex = 0; state.ai.state = 'following';
    state.simulation.body.position.set(x, 0.96, z);
    state.simulation.body.quaternion.setFromEuler(0, yaw, 0);
    state.simulation.body.velocity.set(Math.sin(yaw) * 3.5, 0, Math.cos(yaw) * 3.5);
    state.simulation.body.aabbNeedsUpdate = true;
  };
  configure(traffic.states[0], '-25:25', '25:25', '25:75', 17, 28.75, Math.PI / 2);
  configure(traffic.states[1], '25:-25', '25:25', '-25:25', 21.25, 17, 0);
  let closest = Infinity, crossedAt = null;
  for (let tick = 0; tick < 10 * 120; tick++) {
    traffic.stepWorld({}, STEP);
    const a = traffic.states[0].simulation.body.position, b = traffic.states[1].simulation.body.position;
    closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
    if (crossedAt === null && traffic.states.some(state => state.ai.fromNode === '25:25')) crossedAt = tick / 120;
  }
  assert.ok(closest > 3.8, `conflicting path cars contacted, closest centre gap ${closest}`);
  assert.ok(traffic.states.every(state => Number.isFinite(state.x + state.z)));
  assert.ok(crossedAt !== null && crossedAt <= 10, `reserved cars should clear the crossing within 10s, got ${crossedAt}`);
  traffic.dispose();
});
