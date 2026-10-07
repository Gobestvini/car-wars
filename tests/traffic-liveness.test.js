import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createCityPlan } from '../src/city-generator.js';
import { createTraffic } from '../src/traffic.js';
import { footprintsOverlap } from '../src/traffic-spawn.js';
import { followingLimit, planPassing, projectedExtent, sweptPathIsSafe, trackProgress } from '../src/traffic-planner.js';

const green = { phase: () => ({ color: 'green', controlled: true, canEnter: true }) };
const straight = { intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 500, z: 0 }],
  edges: [{ from: 'a', to: 'b', length: 500 }] };
function fixture(count = 1, network = straight, width = 20) {
  const player = new CarSimulation();
  player.body.position.set(20, 0.96, -20); player.body.aabbNeedsUpdate = true;
  const traffic = createTraffic(new THREE.Scene(), THREE, count, network, width);
  traffic.attachPhysics(player); traffic.setSignalController(green);
  return { player, traffic };
}
function place(state, x, z, heading, from = 'a', to = 'b') {
  Object.assign(state.ai, { fromNode: from, targetNode: to, route: [to, from], routeIndex: 0,
    progressEdge: null, noProgressTime: 0, maneuver: null });
  const body = state.simulation.body;
  body.position.set(x, 0.96, z); body.quaternion.setFromEuler(0, heading, 0);
  body.velocity.setZero(); body.angularVelocity.setZero(); body.aabbNeedsUpdate = true;
  state.x = x; state.z = z;
}
function step(traffic, seconds) { for (let i = 0; i < seconds / STEP; i++) traffic.stepWorld({ brake: 1 }, STEP); }

test('following uses bumper orientation, headway, and reaction closing speed', () => {
  const car = { x: 0, z: 0, heading: Math.PI / 2, vx: 8, vz: 0 };
  const stopped = { x: 12, z: 0, heading: Math.PI / 2, vx: 0, vz: 0 };
  assert.ok(followingLimit(car, stopped, 1, 0) < followingLimit({ ...car, vx: 0 }, stopped, 1, 0));
  assert.ok(followingLimit(car, { ...stopped, vx: 5 }, 1, 0) > followingLimit(car, stopped, 1, 0));
  assert.equal(followingLimit(car, { ...stopped, x: 6.06 }, 1, 0), 0);
  assert.ok(followingLimit(car, { ...stopped, heading: 0 }, 1, 0) > followingLimit(car, stopped, 1, 0));
});

test('traffic diagnostics tie a long stationary wait to the measured leader footprint', () => {
  const { traffic } = fixture(2, straight, 15);
  const [follower, leader] = traffic.states;
  place(leader, 12, 5, Math.PI / 2);
  place(follower, 7, 5, Math.PI / 2);
  step(traffic, 0.25);
  const diagnostic = traffic.debug().find(item => item.id === follower.id);
  assert.equal(diagnostic.waitReason, 'blocked-by-leader');
  assert.equal(diagnostic.blockerEvidence.id, leader.id);
  assert.ok(diagnostic.blockerEvidence.followingLimit < 0.4);
  assert.equal(diagnostic.blockerEvidence.overlapping, false);
  traffic.dispose();
});

test('sideways displacement is not route progress, lawful waits reset the stall clock', () => {
  const edge = { from: 'a', to: 'b', start: { x: 0, z: 5 }, end: { x: 500, z: 5 }, length: 500 };
  const ai = {};
  for (let i = 0; i < 40; i++) trackProgress(ai, { x: 10, z: i }, edge, 0.1, false);
  assert.ok(ai.noProgressTime >= 3);
  trackProgress(ai, { x: 10, z: 40 }, edge, 0.1, true);
  assert.equal(ai.noProgressTime, 0);
});

test('swept passing checks rear traffic, oncoming traffic, and occupied return corridor', () => {
  const car = { id: 'car', x: 0, z: 5, heading: Math.PI / 2, vx: 0, vz: 0 };
  const points = [{ x: 0, z: 5 }, { x: -4, z: 5, reverse: true }, { x: 6, z: -5 },
    { x: 14, z: -5 }, { x: 22, z: 5 }];
  assert.equal(sweptPathIsSafe(car, points, []), true);
  for (const other of [{ x: -8, z: 5, vx: 6, vz: 0, heading: Math.PI / 2 },
    { x: 24, z: -5, vx: -4, vz: 0, heading: -Math.PI / 2 },
    { x: 22, z: 5, vx: 0, vz: 0, heading: Math.PI / 2 }]) {
    assert.equal(sweptPathIsSafe(car, points, [{ id: 'other', ...other }]), false, JSON.stringify(other));
  }
});

test('passing keeps the entire rotated chassis inside narrow road boundaries', () => {
  const car = { id: 'car', x: 15, z: 3.75, heading: Math.PI / 2, vx: 0, vz: 0 };
  const blocker = { id: 'blocker', x: 23, z: 3.75, heading: Math.PI / 2, vx: 0, vz: 0 };
  const edge = { from: 'a', to: 'b', start: { x: 0, z: 3.75 }, end: { x: 500, z: 3.75 }, length: 500, heading: Math.PI / 2 };
  const maneuver = planPassing(car, blocker, edge, 15, [blocker]);
  assert.ok(maneuver);
  for (let i = 1; i < maneuver.points.length; i++) {
    const a = maneuver.points[i - 1], b = maneuver.points[i];
    const heading = b.reverse ? car.heading : Math.atan2(b.x - a.x, b.z - a.z);
    for (const point of [a, b]) assert.ok(Math.abs(point.z) + projectedExtent({ heading }, 0, 1) + 0.35 <= 7.5,
      `rotated body leaves asphalt: ${JSON.stringify({ point, heading })}`);
  }
});

test('passing cannot return with its front bumper beyond the junction stop plane', () => {
  const car = { id: 'car', x: 14, z: 5, heading: Math.PI / 2, vx: 0, vz: 0 };
  const blocker = { id: 'blocker', x: 22, z: 5, heading: Math.PI / 2, vx: 0, vz: 0 };
  const edge = { from: 'a', to: 'b', start: { x: 0, z: 5 }, end: { x: 50, z: 5 }, length: 50, heading: Math.PI / 2 };
  assert.equal(planPassing(car, blocker, edge, 20, [blocker]), null);
});

test('red queues never pass and resume within three seconds of green in both LOD modes', () => {
  for (const logical of [false, true]) {
    const plan = createCityPlan(); const { traffic, player } = fixture(1, plan.roadNetwork);
    const state = traffic.states[0];
    if (logical) { player.body.position.set(0, 0.96, -500); player.body.aabbNeedsUpdate = true; }
    else { player.body.position.set(7, 0.96, 10); player.body.aabbNeedsUpdate = true; }
    place(state, 7, 30, Math.PI / 2, '-25:25', '25:25');
    Object.assign(state.ai, { route: ['25:25', '75:25'], routeIndex: 0 });
    traffic.setSignalController({ phase: () => ({ color: 'red', controlled: true, canEnter: false }) });
    step(traffic, 5);
    assert.equal(state.logical, logical);
    assert.equal(state.ai.maneuver, null);
    assert.equal(state.ai.waitReason, 'signal-red');
    assert.ok(state.x + 2.08 <= 25 - 10 - 1.5 + 0.12);
    const before = state.x; traffic.setSignalController(green); step(traffic, 3);
    assert.ok(state.x > before + 3, JSON.stringify(traffic.debug()));
    traffic.dispose();
  }
});

test('recovery sees oncoming cars beyond the immediate following cells', () => {
  const { traffic, player } = fixture(2, straight, 15); const [car, oncoming] = traffic.states;
  place(car, 35, 3.75, Math.PI / 2);
  player.body.position.set(43, 0.96, 3.75); player.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
  traffic.setSpawnObstacles([{ x: 43, z: 1.15, halfX: 2.1, halfZ: 1 }]);
  for (let i = 0; i < 4 / 0.11; i++) {
    place(oncoming, 64, -3.75, -Math.PI / 2, 'b', 'a');
    oncoming.simulation.body.velocity.set(-8.5, 0, 0);
    traffic.prepare(0.11);
  }
  assert.equal(car.ai.maneuver, null, JSON.stringify(traffic.debug()));
  assert.ok(car.ai.reevaluations > 0);
  traffic.dispose();
});

test('two touching physical cars separate and regain route progress within fifteen seconds', () => {
  const { traffic } = fixture(2);
  const [a, b] = traffic.states;
  place(a, 20, 5, Math.PI / 2);
  place(b, 24.1, 5, -Math.PI / 2, 'b', 'a');
  let maximumStep = 0, previous = traffic.states.map(state => [state.x, state.z]);
  let furthestA = a.x, furthestB = b.x;
  for (let i = 0; i < 15 / STEP; i++) {
    traffic.stepWorld({ brake: 1 }, STEP);
    furthestA = Math.max(furthestA, a.x); furthestB = Math.min(furthestB, b.x);
    traffic.states.forEach((state, index) => {
      maximumStep = Math.max(maximumStep, Math.hypot(state.x - previous[index][0], state.z - previous[index][1]));
      previous[index] = [state.x, state.z];
    });
  }
  assert.equal(traffic.states.length, 2);
  assert.ok(maximumStep < 0.2, `position jump ${maximumStep}`);
  assert.ok(!footprintsOverlap({ x: a.x, z: a.z, heading: a.heading }, { x: b.x, z: b.z, heading: b.heading }));
  // A faster NPC may finish its goal and turn back before the last sample.
  assert.ok(furthestA > 27 && furthestB < 20,
    `contact jam did not release: ${JSON.stringify(traffic.debug())}; ${furthestA},${furthestB}`);
  traffic.dispose();
});

test('stalled vehicle without a leader reevaluates its directed route after three seconds', () => {
  const { traffic } = fixture();
  const state = traffic.states[0]; place(state, 20, 5, Math.PI / 2);
  for (let i = 0; i < 4 / 0.11; i++) traffic.prepare(0.11);
  assert.ok(state.ai.reevaluations >= 1, JSON.stringify(traffic.debug()));
  assert.ok(state.ai.targetNode && state.ai.control.throttle > 0);
  traffic.dispose();
});

test('a physically displaced NPC returns to its directed lane without resetting its identity', () => {
  const { traffic } = fixture(); const state = traffic.states[0], id = state.id;
  place(state, 20, 9, Math.PI / 2);
  step(traffic, 15);
  assert.equal(state.id, id);
  assert.ok(state.x > 40 && Math.abs(state.z - 5) < 1, `${state.x},${state.z}; ${JSON.stringify(traffic.debug())}`);
  traffic.dispose();
});

test('a clear passing maneuver moves past its blocker and returns to the right lane', () => {
  const { traffic, player } = fixture(); const state = traffic.states[0];
  place(state, 15, 5, Math.PI / 2);
  player.body.position.set(23, 0.96, 5); player.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
  let overlap = false, chassisContact = false;
  for (let i = 0; i < 20 / STEP; i++) {
    traffic.stepWorld({ brake: 1 }, STEP);
    const position = player.body.position;
    overlap ||= footprintsOverlap({ x: state.x, z: state.z, heading: state.heading },
      { x: position.x, z: position.z, heading: player.telemetry().heading });
    chassisContact ||= player.world.contacts.some(contact =>
      (contact.bi === player.body && contact.bj === state.simulation.body) ||
      (contact.bj === player.body && contact.bi === state.simulation.body));
  }
  assert.ok(state.x > 32 && Math.abs(state.z - 5) < 1.5, `${state.x},${state.z}; ${JSON.stringify(traffic.debug())}`);
  assert.equal(overlap, false, 'passing chassis footprints overlap');
  assert.equal(chassisContact, false, 'passing chassis contacted the blocker');
  assert.equal(state.ai.maneuver, null);
  traffic.dispose();
});

test('a fully occupied retreat corridor keeps a contact jam waiting and is retried', () => {
  const { traffic } = fixture(2); const [a, b] = traffic.states;
  place(a, 20, 5, Math.PI / 2); place(b, 24.1, 5, -Math.PI / 2, 'b', 'a');
  traffic.setSpawnObstacles([{ x: 29, z: 5, heading: 0, halfX: 3, halfZ: 12 }]);
  for (let i = 0; i < 5 / 0.11; i++) traffic.prepare(0.11);
  assert.equal(b.ai.maneuver, null);
  assert.equal(b.ai.control.throttle, 0);
  assert.ok(b.ai.reevaluations > 0);
  traffic.setSpawnObstacles([]); traffic.prepare(0.6);
  assert.equal(b.ai.maneuver?.kind, 'contact-retreat');
  traffic.dispose();
});

test('physical and logical followers move within three seconds of their leader clearing', () => {
  for (const logical of [false, true]) {
    const { traffic, player } = fixture(2); const [follower, leader] = traffic.states;
    const origin = logical ? 100 : 20;
    if (logical) { player.body.position.set(0, 0.96, -500); player.body.aabbNeedsUpdate = true; }
    place(follower, origin, 5, Math.PI / 2); place(leader, origin + 7, 5, Math.PI / 2);
    for (let i = 0; i < 2 / STEP; i++) {
      traffic.stepWorld({ brake: 1 }, STEP);
      leader.simulation.body.position.set(origin + 7, 0.96, 5);
      leader.simulation.body.velocity.setZero(); leader.simulation.body.aabbNeedsUpdate = true;
    }
    assert.equal(follower.logical, logical);
    const before = follower.simulation.body.position.x;
    place(leader, origin + 7, -50, Math.PI / 2);
    step(traffic, 3);
    assert.ok(follower.x > before + 3, `logical=${logical}, ${JSON.stringify(traffic.debug())}`);
    traffic.dispose();
  }
});

test('blocked dead-end exit waits when no alternative exists and resumes when cleared', () => {
  const { traffic, player } = fixture();
  const state = traffic.states[0];
  place(state, 480, 5, Math.PI / 2);
  player.body.position.set(485, 0.96, -5); player.body.quaternion.setFromEuler(0, -Math.PI / 2, 0);
  player.body.aabbNeedsUpdate = true;
  step(traffic, 2);
  assert.equal(state.ai.waitReason, 'blocked-junction-exit', JSON.stringify(traffic.debug()));
  assert.equal(traffic.reservations.size, 0);
  assert.ok(state.x < 488);
  assert.equal(state.ai.exitReplans, 0);
  player.body.position.set(450, 0.96, -40); player.body.aabbNeedsUpdate = true;
  const before = state.x; step(traffic, 3);
  assert.ok(state.x > before + 3, `exit clearance did not release car: ${state.x}, ${JSON.stringify(traffic.debug())}`);
  traffic.dispose();
});

test('blocked junction exit selects a clear detour to the same goal in physical and logical traffic', () => {
  for (const logical of [false, true]) {
    const { traffic, player } = fixture(2, createCityPlan().roadNetwork);
    const [state, blocker] = traffic.states, id = state.id, body = state.simulation.body;
    player.body.position.set(logical ? 0 : 7, 0.96, logical ? -500 : 10);
    player.body.aabbNeedsUpdate = true;
    place(state, 9, 30, Math.PI / 2, '-25:25', '25:25');
    Object.assign(state.ai, { route: ['25:25', '75:25'], routeIndex: 0, goalId: '75:25' });
    const park = () => place(blocker, 40, 30, Math.PI / 2, '25:25', '75:25');
    park(); traffic.prepare(0.11);
    const detour = [...state.ai.route];
    assert.notEqual(detour[1], '75:25');
    assert.notEqual(detour[1], '-25:25', 'should prefer a side street to reversing');
    assert.equal(detour.at(-1), '75:25');
    assert.equal(detour.filter(node => node === '25:25').length, 1);
    assert.equal(state.ai.exitReplans, 1);
    let previous = [state.x, state.z], distance = 0;
    for (let i = 0; i < 6 / STEP; i++) {
      park(); traffic.stepWorld({ brake: 1 }, STEP);
      const delta = Math.hypot(state.x - previous[0], state.z - previous[1]);
      assert.ok(delta < 0.2, `reroute teleported a body: ${delta}`);
      distance += delta; previous = [state.x, state.z];
      assert.ok(!footprintsOverlap({ x: state.x, z: state.z, heading: state.heading },
        { x: blocker.x, z: blocker.z, heading: blocker.heading }));
    }
    assert.equal(state.logical, logical);
    assert.equal(state.id, id); assert.equal(state.simulation.body, body);
    assert.equal(state.ai.goalId, '75:25');
    assert.ok(distance > 20 && state.ai.fromNode === '25:25', JSON.stringify(traffic.debug()));
    assert.equal(state.ai.exitReplans, 1, 'must not flip-flop between exits');
    traffic.dispose();
  }
});

test('all four occupied exits wait and a newly cleared side street is retried', () => {
  const { traffic, player } = fixture(4, createCityPlan().roadNetwork);
  const [state, ...blockers] = traffic.states;
  place(state, 9, 30, Math.PI / 2, '-25:25', '25:25');
  Object.assign(state.ai, { route: ['25:25', '75:25'], routeIndex: 0, goalId: '75:25' });
  player.body.position.set(40, 0.96, 30); player.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
  player.body.aabbNeedsUpdate = true;
  const park = () => {
    place(blockers[0], 20, 40, 0, '25:25', '25:75');
    place(blockers[1], 30, 10, Math.PI, '25:25', '25:-25');
    place(blockers[2], 10, 20, -Math.PI / 2, '25:25', '-25:25');
  };
  for (let i = 0; i < 30; i++) { park(); traffic.prepare(0.11); }
  assert.equal(state.ai.waitReason, 'blocked-junction-exit');
  assert.equal(state.ai.exitReplans, 0);
  assert.equal(state.ai.reservationNode, null);
  for (let i = 0; i < 20; i++) {
    park(); place(blockers[0], 20, 80, 0, '25:75', '25:125'); traffic.prepare(0.11);
  }
  assert.equal(state.ai.route[1], '25:75');
  assert.equal(state.ai.exitReplans, 1);
  assert.equal(state.ai.waitReason, null);
  assert.ok(state.ai.control.throttle > 0);
  traffic.dispose();
});

test('blocked exit never changes a red-light decision or an already entered junction path', () => {
  const { traffic, player } = fixture(1, createCityPlan().roadNetwork);
  const state = traffic.states[0];
  place(state, 9, 30, Math.PI / 2, '-25:25', '25:25');
  Object.assign(state.ai, { route: ['25:25', '75:25'], routeIndex: 0, goalId: '75:25' });
  player.body.position.set(40, 0.96, 30); player.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
  player.body.aabbNeedsUpdate = true;
  traffic.setSignalController({ phase: () => ({ color: 'red', controlled: true, canEnter: false }) });
  step(traffic, 2);
  assert.equal(state.ai.waitReason, 'signal-red');
  assert.equal(state.ai.exitReplans, 0);
  // Acquire the original path before its exit becomes occupied.
  player.body.position.z = -40; traffic.setSignalController(green); traffic.prepare(0.11);
  const held = [...traffic.reservations.values()].find(item => item.id === state.id);
  assert.ok(held); held.entered = true;
  place(state, 17, 30, Math.PI / 2, '-25:25', '25:25');
  Object.assign(state.ai, { route: ['25:25', '75:25'], routeIndex: 0 });
  player.body.position.z = 30; traffic.prepare(0.11);
  assert.deepEqual(state.ai.route, ['25:25', '75:25']);
  assert.equal(state.ai.exitReplans, 0);
  assert.equal([...traffic.reservations.values()].find(item => item.id === state.id), held);
  traffic.dispose();
});

test('entered reservation survives timeouts and route advancement until rear bumper clears', () => {
  const plan = createCityPlan(); const { traffic } = fixture(1, plan.roadNetwork);
  const state = traffic.states[0]; place(state, 25, 30, Math.PI / 2, '-25:25', '25:25');
  Object.assign(state.ai, { route: ['25:25', '75:25'], routeIndex: 0 });
  traffic.reservations.set('25:25', { id: state.id, entered: true, time: -100 }); state.ai.reservationNode = '25:25';
  traffic.prepare(0.11);
  assert.equal(traffic.reservations.get('25:25')?.id, state.id);
  assert.equal(state.ai.fromNode, '25:25');
  place(state, 40, 30, Math.PI / 2, '25:25', '75:25');
  traffic.prepare(0.11);
  assert.equal(traffic.reservations.has('25:25'), false);
  traffic.dispose();
});

test('reservation decisions are independent of state iteration order and honor request age', () => {
  const plan = createCityPlan();
  const run = reverse => {
    const { traffic } = fixture(2, plan.roadNetwork); const [a, b] = traffic.states;
    place(a, 11, 30, Math.PI / 2, '-25:25', '25:25');
    place(b, 20, 11, 0, '25:-25', '25:25');
    Object.assign(a.ai, { route: ['25:25', '75:25'], routeIndex: 0, requestNode: '25:25', requestedAt: -1 });
    Object.assign(b.ai, { route: ['25:25', '25:75'], routeIndex: 0, requestNode: '25:25', requestedAt: -2 });
    if (reverse) traffic.states.reverse();
    traffic.prepare(0.11);
    const result = { owner: traffic.reservations.get('25:25')?.id,
      controls: traffic.states.map(state => [state.id, state.ai.control]).sort((x, y) => x[0].localeCompare(y[0])) };
    assert.equal(result.owner, b.id); traffic.dispose(); return result;
  };
  assert.deepEqual(run(false), run(true));
});

test('a junction owner finishes turning instead of following the opposing waiting lane', () => {
  const plan = createCityPlan(); const { traffic, player } = fixture(2, plan.roadNetwork, 15);
  const [owner, opposing] = traffic.states;
  player.body.position.set(0, 0.96, -500); player.body.aabbNeedsUpdate = true;
  place(owner, -22.83, -66.7, -0.05, '-25:-75', '-25:-25');
  Object.assign(owner.ai, { route: ['-25:-25', '-25:25'], routeIndex: 0, reservationNode: '-25:-75' });
  place(opposing, -21.25, -62.35, Math.PI, '-25:-25', '-25:-75');
  Object.assign(opposing.ai, { route: ['-25:-75', '-25:-125'], routeIndex: 0 });
  traffic.reservations.set('-25:-75', { id: owner.id, entered: true, time: -100 });
  try {
    step(traffic, 12);
    assert.ok(owner.z > -50 && Math.abs(owner.x + 28.75) < 1, `${owner.x},${owner.z}; ${JSON.stringify(traffic.debug())}`);
    assert.ok(!traffic.reservations.get('-25:-75') || traffic.reservations.get('-25:-75').id !== owner.id);
    assert.ok(opposing.z < -66, 'opposing queue did not resume after owner cleared');
  } finally { traffic.dispose(); }
});

test('followers close a large gap to a lawful queue instead of stopping with the leader', () => {
  const { traffic, player } = fixture(2); const [follower, leader] = traffic.states;
  player.body.position.set(450, 0.96, -40); player.body.aabbNeedsUpdate = true;
  place(follower, 460, 5, Math.PI / 2); place(leader, 480, 5, Math.PI / 2);
  traffic.setSignalController({ phase: () => ({ color: 'red', controlled: true, canEnter: false }) });
  try {
    step(traffic, 12);
    const gap = leader.x - follower.x - 4.16;
    assert.ok(gap > 0.7 && gap < 1.8, `queue bumper gap remains too large: ${gap}`);
    assert.equal(follower.ai.waitReason, 'queue-wait');
    assert.equal(follower.ai.maneuver, null);
  } finally { traffic.dispose(); }
});
