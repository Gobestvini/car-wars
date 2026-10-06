import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan } from '../src/city-generator.js';
import { createTrafficSignals, SIGNAL_PERIOD, SIGNAL_TIMING } from '../src/traffic-signals.js';

const junction = { intersections: [{ id: '25:25', x: 25, z: 25 }, { id: '25:-25', x: 25, z: -25 },
  { id: '25:75', x: 25, z: 75 }, { id: '-25:25', x: -25, z: 25 }, { id: '75:25', x: 75, z: 25 }],
edges: ['25:-25', '25:75', '-25:25', '75:25'].map(from => ({ from, to: '25:25', length: 50 })) };

test('traffic signals control internal intersections and leave boundary nodes on priority rules', () => {
  const plan = createCityPlan();
  const signals = createTrafficSignals(plan.roadNetwork);
  assert.equal(signals.controlled.size, 36);
  assert.equal(signals.phase('-175:-175', '-125:-175', 0).controlled, false);
  assert.equal(signals.phase('missing', '-25:-25', 0).canEnter, true);
});

test('signal phases are deterministic and conflicting axes never have green together', () => {
  const first = createTrafficSignals(junction), second = createTrafficSignals(junction);
  for (let time = 0; time < SIGNAL_PERIOD * 2; time += 0.05) {
    const ns = first.phase('25:25', '25:-25', time);
    const ew = second.phase('25:25', '-25:25', time);
    assert.equal(ns.controlled, true); assert.equal(ew.controlled, true);
    assert.equal(ns.color === 'green' && ew.color === 'green', false);
    assert.deepEqual(ns, second.phase('25:25', '25:-25', time));
  }
});

test('each green lasts sixteen seconds and budgets a full city block with start and turn allowance', () => {
  const signals = createTrafficSignals(junction), step = 0.01;
  const blockLength = Math.max(...createCityPlan().roadNetwork.edges.map(edge => edge.length));
  assert.equal(SIGNAL_TIMING.green, 16);
  assert.ok(SIGNAL_TIMING.green > blockLength / 8 + 8 / 2.4 + 2);
  for (const from of ['25:-25', '-25:25']) {
    const durations = { green: 0, yellow: 0, red: 0 };
    for (let tick = 0; tick < Math.round(SIGNAL_PERIOD / step); tick++) {
      durations[signals.phase('25:25', from, tick * step).color] += step;
    }
    assert.ok(Math.abs(durations.green - 16) < step);
    assert.ok(Math.abs(durations.yellow - 2) < step);
    assert.ok(Math.abs(durations.red - 20) < step);
  }
});
