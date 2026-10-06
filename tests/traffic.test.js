import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCityPlan } from '../src/city-generator.js';
import { CarSimulation } from '../src/vehicle.js';
import { createTraffic } from '../src/traffic.js';

test('traffic initializes repeatable AI routes on actual city streets', () => {
  const plan = createCityPlan();
  const create = () => {
    const simulation = new CarSimulation();
    const traffic = createTraffic(new THREE.Scene(), THREE, 6, plan.roadNetwork, plan.roadWidth);
    traffic.attachPhysics(simulation);
    return { simulation, traffic };
  };
  const first = create(), second = create();
  assert.deepEqual(first.traffic.debug(), second.traffic.debug());
  assert.equal(first.traffic.status().count, 6);
  assert.ok(first.traffic.debug().every(car => car.route.length > 1 && car.segment[0] && car.segment[1]));
  assert.ok(new Set(first.traffic.debug().map(car => car.goal)).size >= 3);
  assert.ok(first.traffic.states.every(state => Math.hypot(state.x, state.z) > 13));
  first.traffic.dispose(); second.traffic.dispose();
});

test('traffic waits at a controlled red signal before reserving the intersection', () => {
  const plan = createCityPlan();
  const simulation = new CarSimulation();
  const traffic = createTraffic(new THREE.Scene(), THREE, 1, plan.roadNetwork, plan.roadWidth);
  traffic.attachPhysics(simulation);
  const state = traffic.states[0];
  state.ai.fromNode = '-25:25'; state.ai.targetNode = '25:25';
  state.ai.route = ['-25:25', '25:25', '25:75']; state.ai.routeIndex = 1;
  state.simulation.body.position.set(12, 0.96, 25 + plan.roadWidth / 4);
  state.simulation.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
  state.simulation.body.velocity.setZero(); state.simulation.body.aabbNeedsUpdate = true;
  traffic.setSignalController({ phase: () => ({ color: 'red', controlled: true, canEnter: false }) });
  traffic.prepare(0.11);
  assert.equal(state.ai.state, 'signal-wait');
  assert.equal(traffic.reservations.size, 0);
  assert.equal(traffic.debug()[0].reason, 'signal-red');
  traffic.setSignalController({ phase: () => ({ color: 'green', controlled: true, canEnter: true }) });
  traffic.prepare(0.11);
  assert.equal(state.ai.state, 'following');
  traffic.dispose();
});

test('red signal stops the NPC front bumper before its stop plane and green releases it', () => {
  const plan = createCityPlan();
  const simulation = new CarSimulation();
  const traffic = createTraffic(new THREE.Scene(), THREE, 1, plan.roadNetwork, plan.roadWidth);
  traffic.attachPhysics(simulation);
  const state = traffic.states[0];
  const stopX = 25 - (plan.roadWidth / 2 + 1.5);
  const laneZ = 25 + plan.roadWidth / 4;
  state.ai.fromNode = '-25:25'; state.ai.targetNode = '25:25';
  state.ai.route = ['-25:25', '25:25', '25:75']; state.ai.routeIndex = 1;
  state.simulation.body.position.set(6, 0.96, laneZ);
  state.simulation.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
  state.simulation.body.velocity.set(8, 0, 0); state.simulation.body.aabbNeedsUpdate = true;
  traffic.setSignalController({ phase: () => ({ color: 'red', controlled: true, canEnter: false }) });
  for (let i = 0; i < 240; i++) traffic.stepWorld({ brake: 1 }, 1 / 120);
  const stoppedFront = state.simulation.body.position.x + 2.08;
  assert.ok(stoppedFront <= stopX + 0.12, `front bumper ${stoppedFront} crossed stop plane ${stopX}`);
  assert.ok(Math.abs(state.simulation.body.velocity.x) < 0.8);
  assert.equal(state.ai.state, 'signal-wait');
  traffic.setSignalController({ phase: () => ({ color: 'green', controlled: true, canEnter: true }) });
  for (let i = 0; i < 360; i++) traffic.stepWorld({}, 1 / 120);
  assert.ok(state.simulation.body.position.x > stopX + 1,
    `green should release the stopped NPC through the intersection: ${state.simulation.body.position.x}, v=${state.simulation.body.velocity.x}, ${state.ai.state}, ${JSON.stringify(state.ai.control)}`);
  assert.notEqual(state.ai.state, 'signal-wait');
  traffic.dispose();
});

test('red signal does not stop an NPC whose front bumper has entered the junction', () => {
  const plan = createCityPlan();
  const simulation = new CarSimulation();
  const traffic = createTraffic(new THREE.Scene(), THREE, 1, plan.roadNetwork, plan.roadWidth);
  traffic.attachPhysics(simulation);
  const state = traffic.states[0];
  const laneZ = 25 + plan.roadWidth / 4;
  state.ai.fromNode = '-25:25'; state.ai.targetNode = '25:25';
  state.ai.route = ['-25:25', '25:25', '25:75']; state.ai.routeIndex = 1;
  state.simulation.body.position.set(15, 0.96, laneZ);
  state.simulation.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
  state.simulation.body.velocity.setZero(); state.simulation.body.aabbNeedsUpdate = true;
  traffic.setSignalController({ phase: () => ({ color: 'red', controlled: true, canEnter: false }) });
  traffic.prepare(0.11);
  assert.notEqual(state.ai.state, 'signal-wait');
  assert.equal(traffic.reservations.get('25:25')?.id, state.id);
  traffic.dispose();
});
