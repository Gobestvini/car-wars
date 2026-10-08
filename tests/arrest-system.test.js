import test from 'node:test';
import assert from 'node:assert/strict';
import { createArrestSystem } from '../src/arrest-system.js';

const player = { x: 0, z: 0, speed: 0 };
const police = [{ id: 'police-1', role: 'police', targetId: 'player', logical: false, x: 5, z: 0, speed: 0 }];
const update = (system, dt = 1 / 120, overrides = {}) => system.update(dt,
  { wantedLevel: 1, player, police, ...overrides });
const advance = (system, seconds, overrides = {}) => {
  let result, completed = false;
  for (let time = 0; time < seconds; time += 1 / 120) {
    result = update(system, 1 / 120, overrides); completed ||= result.completed;
  }
  return { ...result, completed };
};

test('arrest requires wanted level, stopped player and assigned nearby physical police', () => {
  const system = createArrestSystem();
  assert.equal(update(system, 1 / 120, { wantedLevel: 0 }).state, 'idle');
  assert.equal(update(system, 1 / 120, { police: [{ ...police[0], x: 7 }] }).state, 'idle');
  assert.equal(update(system, 1 / 120, { police: [{ ...police[0], clearPath: false }] }).state, 'idle');
  assert.equal(update(system, 1 / 120, { player: { ...player, speed: 1 } }).state, 'idle');
  assert.equal(update(system).state, 'holding');
});

test('continuous hold enters a five-second countdown, then completes once', () => {
  const system = createArrestSystem();
  assert.equal(advance(system, 2.01).state, 'arresting');
  assert.equal(advance(system, 4.8).state, 'arresting');
  assert.equal(advance(system, 0.3).completed, true);
  assert.equal(update(system).completed, false);
  assert.equal(system.snapshot().state, 'arrested');
});

test('physical escape cancels immediately and a new attempt must complete a fresh hold', () => {
  const system = createArrestSystem();
  advance(system, 2.1);
  assert.equal(update(system, 1 / 120, { player: { ...player, speed: 1.6 } }).cancellationReason, 'escaped');
  assert.equal(system.snapshot().progress, 0);
  assert.equal(advance(system, 2.1).state, 'arresting');
});

test('two police do not shorten the timer, and losing all valid police cancels', () => {
  const system = createArrestSystem();
  const two = [...police, { ...police[0], id: 'police-2', x: -5 }];
  advance(system, 2.1, { police: two });
  const first = system.snapshot().remainingSeconds;
  update(system, 1 / 120, { police: two });
  assert.ok(system.snapshot().remainingSeconds < first);
  assert.equal(update(system, 1 / 120, { police: [] }).cancellationReason, 'police-lost');
});

test('hidden, free camera, destroyed vehicle, reset, and invalid time do not complete an arrest', () => {
  const system = createArrestSystem();
  advance(system, 2.1);
  assert.equal(update(system, 5, { enabled: false }).state, 'idle');
  advance(system, 2.1);
  assert.equal(update(system, 5, { damage: 1 }).state, 'idle');
  assert.equal(update(system, NaN).completed, false);
  assert.equal(system.reset().state, 'idle');
});
