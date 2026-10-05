import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTraffic, createTrafficStates, TRAFFIC_ROUTE, TRAFFIC_CORNER_RADIUS, TRAFFIC_LAP_LENGTH } from '../src/traffic.js';

test('traffic starts reproducibly on a closed route away from the player start', () => {
  assert.deepEqual(createTrafficStates(6), createTrafficStates(6));
  const states = createTrafficStates(6);
  assert.equal(states.length, 6);
  assert.ok(states.every(state => Math.hypot(state.x, state.z) > 13));
  assert.ok(TRAFFIC_ROUTE.length >= 4);
});

test('fixed-step traffic motion is finite, speed-limited, and loops without a teleport', () => {
  const states = createTrafficStates(6);
  const first = { ...states[0] };
  for (let i = 0; i < 60 * 120; i++) advanceTraffic(states, 1 / 120);
  assert.ok(states.every(state => Number.isFinite(state.x + state.z + state.heading + state.distance)));
  assert.ok(states.every(state => state.speed <= 8));
  assert.ok(states.every(state => Math.hypot(state.x, state.z) > 13));
  assert.ok(Math.hypot(states[0].x - first.x, states[0].z - first.z) <= 30.01);
  const before = states.map(state => ({ ...state }));
  advanceTraffic(states, 0);
  assert.deepEqual(states, before);
});

test('traffic uses the rounded, closed inner-road loop', () => {
  assert.ok(TRAFFIC_CORNER_RADIUS > 0);
  assert.ok(TRAFFIC_LAP_LENGTH > 100);
  const states = createTrafficStates(1);
  let maximumStep = 0;
  for (let i = 0; i < 60 * 12; i++) {
    const before = { ...states[0] };
    advanceTraffic(states, 1 / 120);
    maximumStep = Math.max(maximumStep, Math.hypot(states[0].x - before.x, states[0].z - before.z));
  }
  assert.ok(maximumStep < 0.1, `route corner caused a ${maximumStep}m jump`);
  assert.ok(states[0].x >= -26 && states[0].x <= 26 && states[0].z >= -26 && states[0].z <= 26);
});
