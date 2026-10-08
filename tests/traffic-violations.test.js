import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficViolationDetector } from '../src/traffic-violations.js';

const tick = (detector, player, extra = {}) => detector.update({ dt: 1 / 60, player: { x: 0, z: 0, heading: 0, vx: 0, vz: 0, ...player }, ...extra });

test('speeding requires one continuous second and resets before activation in the hysteresis band', () => {
  const detector = createTrafficViolationDetector();
  for (let i = 0; i < 30; i++) assert.equal(tick(detector, { vz: 23 }).length, 0);
  tick(detector, { vz: 22 });
  for (let i = 0; i < 30; i++) assert.equal(tick(detector, { vz: 23 }).length, 0);
  for (let i = 0; i < 29; i++) assert.equal(tick(detector, { vz: 23 }).length, 0);
  assert.equal(tick(detector, { vz: 23 })[0].type, 'speeding');
});

test('speeding repeats after five seconds and clears below the reset threshold', () => {
  const detector = createTrafficViolationDetector();
  let sawInitial = false, sawRepeat = false;
  for (let i = 0; i < 61; i++) sawInitial ||= tick(detector, { vz: 23 }).some(event => event.type === 'speeding');
  assert.equal(sawInitial, true);
  for (let i = 0; i < 320; i++) sawRepeat ||= tick(detector, { vz: 23 }).some(event => event.type === 'speeding');
  assert.equal(sawRepeat, true);
  for (let i = 0; i < 30; i++) tick(detector, { vz: 20 });
  assert.equal(tick(detector, { vz: 23 }).length, 0);
});

test('red light offense is detected only while crossing its stop plane in the lane', () => {
  const detector = createTrafficViolationDetector();
  const approach = { nodeId: 'n', fromId: 'w', forwardX: 0, forwardZ: 1, rightX: 1, rightZ: 0,
    stopX: 0, stopZ: 0, stopLineLength: 4 };
  const common = { approaches: [approach], phaseAt: () => ({ controlled: true, color: 'red' }) };
  tick(detector, { z: -5 }, common);
  const events = tick(detector, { z: 1, vz: 5 }, common);
  assert.equal(events.filter(event => event.type === 'red-light').length, 1);
  assert.equal(tick(detector, { z: 2, vz: 5 }, common).length, 0);
});

test('red light crossing works in all four cardinal directions and ignores wrong lanes and green', () => {
  for (const [forwardX, forwardZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const makeApproach = () => ({ nodeId: 'n', fromId: 'w', forwardX, forwardZ,
      rightX: forwardZ, rightZ: -forwardX, stopX: 0, stopZ: 0, stopLineLength: 4 });
    const run = (lateral = 0, color = 'red') => {
      const detector = createTrafficViolationDetector();
      const approach = makeApproach();
      const pose = (along, heading = Math.atan2(forwardX, forwardZ)) => ({ x: forwardX * along + forwardZ * lateral,
        z: forwardZ * along - forwardX * lateral, heading, vx: forwardX * 5, vz: forwardZ * 5 });
      tick(detector, pose(-5), { approaches: [approach], phaseAt: () => ({ controlled: true, color }) });
      return tick(detector, pose(1), { approaches: [approach], phaseAt: () => ({ controlled: true, color }) });
    };
    assert.equal(run().some(event => event.type === 'red-light'), true);
    assert.equal(run(6).some(event => event.type === 'red-light'), false);
    assert.equal(run(0, 'green').some(event => event.type === 'red-light'), false);
  }
});

test('collision event requires the player to contribute sufficient closing speed and is one per contact episode', () => {
  const detector = createTrafficViolationDetector();
  const playerBody = { position: { x: 0, y: 0, z: 0 } };
  const otherBody = { position: { x: 0, y: 0, z: 2 } };
  const actor = { id: 'npc-1', role: 'civilian', body: otherBody, logical: false };
  const contact = { bi: playerBody, bj: otherBody, ni: { x: 0, y: 0, z: 1 } };
  const velocitiesBefore = new Map([[playerBody, { x: 0, y: 0, z: 3 }], [otherBody, { x: 0, y: 0, z: 0 }]]);
  const options = { dt: 1 / 60, player: { x: 0, z: 0, heading: 0, vx: 3, vz: 3, body: playerBody },
    actors: [actor], contacts: [{ ...contact, ni: { x: 1, y: 0, z: 0 } }, contact], velocitiesBefore };
  assert.equal(detector.update(options)[0].type, 'civilian-collision');
  assert.equal(detector.update(options).length, 0);
});

test('collision normal is oriented correctly when the player is the second body', () => {
  const detector = createTrafficViolationDetector();
  const playerBody = { position: { x: 0, y: 0, z: 0 } };
  const otherBody = { position: { x: 0, y: 0, z: 2 } };
  const actor = { id: 'police-1', role: 'police', body: otherBody, logical: false };
  const contact = { bi: otherBody, bj: playerBody, ni: { x: 0, y: 0, z: -1 } };
  const velocitiesBefore = new Map([[playerBody, { x: 0, y: 0, z: 3 }], [otherBody, { x: 0, y: 0, z: 0 }]]);
  const events = detector.update({ dt: 1 / 60, player: { x: 0, z: 0, heading: 0, vx: 0, vz: 3, body: playerBody },
    actors: [actor], contacts: [contact], velocitiesBefore });
  assert.equal(events[0]?.type, 'police-collision');
});

test('a moving police car that hits a stationary player does not blame the player', () => {
  const detector = createTrafficViolationDetector();
  const playerBody = { position: { x: 0, y: 0, z: 0 } };
  const otherBody = { position: { x: 0, y: 0, z: 2 } };
  const actor = { id: 'police-1', role: 'police', body: otherBody, logical: false };
  const events = detector.update({ dt: 1 / 60, player: { x: 0, z: 0, heading: 0, vx: 0, vz: 0, body: playerBody },
    actors: [actor], contacts: [{ bi: playerBody, bj: otherBody, ni: { x: 0, y: 0, z: 1 } }],
    velocitiesBefore: new Map([[playerBody, { x: 0, y: 0, z: 0 }], [otherBody, { x: 0, y: 0, z: -4 }]]) });
  assert.equal(events.length, 0);
});

test('detector reset removes speed and collision state', () => {
  const detector = createTrafficViolationDetector();
  tick(detector, { vz: 22 });
  detector.reset();
  assert.equal(detector.snapshot().clock, 0);
  assert.equal(detector.snapshot().speedingTime, 0);
});
