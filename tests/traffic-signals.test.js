import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan } from '../src/city-generator.js';
import { createTrafficSignals, SIGNAL_PERIOD } from '../src/traffic-signals.js';

test('traffic signals control internal intersections and leave boundary nodes on priority rules', () => {
  const plan = createCityPlan();
  const signals = createTrafficSignals(plan.roadNetwork);
  assert.equal(signals.controlled.size, 36);
  assert.equal(signals.phase('-175:-175', '-125:-175', 0).controlled, false);
  assert.equal(signals.phase('missing', '-25:-25', 0).canEnter, true);
});

test('signal phases are deterministic and conflicting axes never have green together', () => {
  const network = { intersections: [{ id: '-25:25', x: -25, z: 25 }, { id: '25:25', x: 25, z: 25 },
    { id: '25:-25', x: 25, z: -25 }, { id: '-25:-25', x: -25, z: -25 }],
  edges: [{ from: '-25:25', to: '25:25' }, { from: '-25:-25', to: '25:-25' },
    { from: '-25:25', to: '-25:-25' }, { from: '25:25', to: '25:-25' }] };
  const first = createTrafficSignals(network), second = createTrafficSignals(network);
  for (let time = 0; time < SIGNAL_PERIOD * 2; time += 0.05) {
    const ns = first.phase('25:25', '25:-25', time);
    const ew = second.phase('25:25', '-25:25', time);
    assert.equal(ns.color === 'green' && ew.color === 'green', false);
    assert.deepEqual(ns, second.phase('25:25', '25:-25', time));
  }
});
