import test from 'node:test';
import assert from 'node:assert/strict';
import { junctionMovement, movementsConflict, pathProgress, pathTarget, yieldsToOncoming } from '../src/traffic-junction.js';
import * as THREE from 'three';
import { createCityPlan } from '../src/city-generator.js';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createTraffic } from '../src/traffic.js';
import { footprintsOverlap } from '../src/traffic-spawn.js';

const node = { id: 'o', x: 0, z: 0 };
const movement = (a, b, width = 15) => junctionMovement({ from: `in:${a}`, heading: a }, { to: `out:${b}`, heading: b }, node, width);

test('opposing straight traffic and four right turns can share a junction, crossing traffic cannot', () => {
  for (const width of [12, 15, 30]) {
    assert.equal(movementsConflict(movement(0, 0, width), movement(Math.PI, Math.PI, width)), false);
    assert.equal(movementsConflict(movement(0, 0, width), movement(Math.PI / 2, Math.PI / 2, width)), true);
    const right = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map(a => movement(a, a - Math.PI / 2, width));
    assert.ok(right.every(p => p.turn === 'right'));
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.equal(movementsConflict(right[i], right[j]), false);
  }
});

test('left turns yield to opposing straight traffic independently of request age', () => {
  const left = movement(0, Math.PI / 2), opposing = movement(Math.PI, Math.PI);
  assert.equal(left.turn, 'left'); assert.equal(yieldsToOncoming(left, opposing), true);
  assert.equal(yieldsToOncoming(opposing, left), false);
  assert.equal(movementsConflict(left, opposing), true);
  assert.equal(yieldsToOncoming(left, movement(0, 0)), false);
});

test('smooth turn paths join the correct lanes and lookahead advances monotonically', () => {
  for (const angle of [-Math.PI / 2, Math.PI / 2]) {
    const path = movement(0, angle);
    const start = path.points[0], end = path.points.at(-1);
    assert.ok(Math.abs(start.x + 3.75) < 1e-6 && Math.abs(start.z + 10.5) < 1e-6);
    assert.ok(Math.abs(end.x - Math.sin(angle) * 10.5) < 1e-6);
    assert.ok(Math.abs(end.z - Math.sin(angle) * 3.75) < 1e-6);
    let before = -1;
    for (const car of path.points) {
      const progress = pathProgress(car, path);
      assert.ok(progress >= before); before = progress;
      assert.ok(Number.isFinite(pathTarget(car, path).x));
    }
  }
});

function fixture(logical, count = 2, width = 15) {
  const plan = createCityPlan(), player = new CarSimulation({ damage: false });
  player.body.position.set(logical ? 500 : 5, 0.96, logical ? 500 : 25);
  player.body.aabbNeedsUpdate = true;
  const traffic = createTraffic(new THREE.Scene(), THREE, count, plan.roadNetwork, width);
  traffic.attachPhysics(player);
  traffic.setSignalController({ phase: () => ({ color: 'green', controlled: true, canEnter: true }) });
  return { traffic, player };
}
function place(state, from, to, x, z, heading) {
  const body = state.simulation.body;
  body.position.set(x, 0.96, z); body.quaternion.setFromEuler(0, heading, 0);
  body.velocity.setZero(); body.angularVelocity.setZero(); body.aabbNeedsUpdate = true;
  Object.assign(state, { x, z, heading });
  Object.assign(state.ai, { fromNode: from, targetNode: '25:25', route: ['25:25', to], routeIndex: 0,
    goalId: to, reservationNode: null, continuation: null, progressEdge: null });
}

test('opposing straight cars start together and occupy the junction concurrently in both LOD modes', () => {
  for (const logical of [false, true]) {
    const { traffic } = fixture(logical), [a, b] = traffic.states;
    place(a, '25:-25', '25:75', 21.25, 11, 0);
    place(b, '25:75', '25:-25', 28.75, 39, Math.PI);
    try {
      traffic.prepare(0.11);
      assert.equal(traffic.reservations.size, 2);
      assert.ok(a.ai.control.throttle > 0 && b.ai.control.throttle > 0);
      let concurrent = false;
      for (let tick = 0; tick < 8 / STEP; tick++) {
        traffic.stepWorld({ brake: 1 }, STEP);
        concurrent ||= [...traffic.reservations.values()].filter(r => r.nodeId === '25:25' && r.entered).length === 2;
        assert.equal(footprintsOverlap(a, b), false);
      }
      assert.ok(concurrent, 'compatible traffic was still serialized');
      assert.ok(a.z > 38 && b.z < 12, `${a.z},${b.z}`);
    } finally { traffic.dispose(); }
  }
});

test('an older left-turn request yields to opposing straight traffic then resumes safely', () => {
  for (const logical of [false, true]) {
    const { traffic } = fixture(logical), [left, straight] = traffic.states;
    place(left, '25:-25', '75:25', 21.25, 11, 0);
    place(straight, '25:75', '25:-25', 28.75, 39, Math.PI);
    Object.assign(left.ai, { requestNode: '25:25', requestedAt: -20 });
    Object.assign(straight.ai, { requestNode: '25:25', requestedAt: -1 });
    try {
      traffic.prepare(0.11);
      assert.equal(left.ai.waitReason, 'oncoming-priority');
      assert.equal(left.ai.control.throttle, 0);
      assert.ok(straight.ai.control.throttle > 0);
      let started = false;
      for (let tick = 0; tick < 15 / STEP; tick++) {
        traffic.stepWorld({ brake: 1 }, STEP);
        if (left.ai.control.throttle > 0) started = true;
        assert.equal(footprintsOverlap(left, straight), false, `left turn crossed oncoming at ${tick * STEP}s`);
      }
      assert.ok(started && left.x > 35, `left turn never resumed: ${left.x},${left.z}`);
      assert.ok(straight.z < 12);
    } finally { traffic.dispose(); }
  }
});

test('a same-lane platoon starts its follower before the leader has left the junction', () => {
  const { traffic } = fixture(true), [leader, follower] = traffic.states;
  place(leader, '25:-25', '25:75', 21.25, 11, 0);
  place(follower, '25:-25', '25:75', 21.25, 3, 0);
  let concurrent = false;
  try {
    for (let tick = 0; tick < 10 / STEP; tick++) {
      traffic.stepWorld({ brake: 1 }, STEP);
      concurrent ||= [...traffic.reservations.values()].filter(r => r.nodeId === '25:25').length === 2;
      assert.equal(footprintsOverlap(leader, follower), false);
    }
    assert.ok(concurrent, 'following still requires an empty junction');
    assert.ok(follower.z > 35);
  } finally { traffic.dispose(); }
});

test('followers enter behind left and right turns without waiting for the whole maneuver', () => {
  for (const logical of [false, true]) for (const exit of ['-25:25', '75:25']) {
    for (const followerExit of [exit, '25:75']) {
      const { traffic } = fixture(logical), [leader, follower] = traffic.states;
      place(leader, '25:-25', exit, 21.25, 11, 0);
      place(follower, '25:-25', followerExit, 21.25, 3, 0);
      let followedIntoJunction = false;
      try {
        for (let tick = 0; tick < 5 / STEP; tick++) {
          traffic.stepWorld({ brake: 1 }, STEP);
          const permits = [...traffic.reservations.values()];
          followedIntoJunction ||= permits.some(r => r.id === leader.id && r.entered && r.nodeId === '25:25')
            && permits.some(r => r.id === follower.id && r.nodeId === '25:25') && follower.speed > 0.5;
          assert.equal(footprintsOverlap(leader, follower), false,
            `contact: logical=${logical}, exits=${exit}/${followerExit}, time=${tick * STEP}`);
          assert.notEqual(follower.ai.waitReason, 'intersection-reservation',
            `same approach was serialized: logical=${logical}, exits=${exit}/${followerExit}`);
        }
        assert.ok(followedIntoJunction, `follower waited for turn completion: ${exit}/${followerExit}, logical=${logical}`);
      } finally { traffic.dispose(); }
    }
  }
});

test('four simultaneous right turns clear onto their own lanes without contact', () => {
  for (const logical of [false, true]) {
    const { traffic } = fixture(logical, 4);
    const cases = [
      ['25:-25', '-25:25', 21.25, 11, 0, -Math.PI / 2],
      ['25:75', '75:25', 28.75, 39, Math.PI, Math.PI / 2],
      ['-25:25', '25:75', 11, 28.75, Math.PI / 2, 0],
      ['75:25', '25:-25', 39, 21.25, -Math.PI / 2, Math.PI],
    ];
    traffic.states.forEach((state, index) => place(state, ...cases[index].slice(0, 5)));
    try {
      traffic.prepare(0.11);
      assert.equal(traffic.reservations.size, 4);
      assert.ok(traffic.states.every(state => state.ai.control.throttle > 0));
      const cleared = new Set();
      for (let tick = 0; tick < 8 / STEP; tick++) {
        traffic.stepWorld({ brake: 1 }, STEP);
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
          assert.equal(footprintsOverlap(traffic.states[a], traffic.states[b]), false);
        }
        traffic.states.forEach((state, index) => {
          if (state.ai.fromNode === '25:25' && Math.cos(state.heading - cases[index][5]) > 0.98) cleared.add(state.id);
        });
      }
      assert.equal(cleared.size, 4, 'some right turns never aligned with their exit lane');
    } finally { traffic.dispose(); }
  }
});

test('a left turn gives up an unentered permit when oncoming straight traffic approaches', () => {
  for (const logical of [false, true]) {
    const { traffic } = fixture(logical), [left, straight] = traffic.states;
    place(left, '25:-25', '75:25', 21.25, 11, 0);
    place(straight, '25:75', '25:-25', 28.75, 65, Math.PI);
    try {
      traffic.prepare(0.11);
      assert.equal(traffic.reservations.get('25:25')?.id, left.id);
      place(straight, '25:75', '25:-25', 28.75, 45, Math.PI);
      straight.simulation.body.velocity.set(0, 0, -5);
      traffic.prepare(0.11);
      assert.equal(left.ai.waitReason, 'oncoming-priority');
      assert.equal(left.ai.control.throttle, 0);
      assert.equal(left.ai.reservationNode, null);
      let resumed = false;
      for (let tick = 0; tick < 15 / STEP; tick++) {
        traffic.stepWorld({ brake: 1 }, STEP);
        resumed ||= left.ai.control.throttle > 0;
        assert.equal(footprintsOverlap(left, straight), false);
      }
      assert.ok(resumed && left.x > 35, 'left turn failed to resume after late oncoming traffic');
    } finally { traffic.dispose(); }
  }
});

test('a stationary upstream oncoming queue does not deadlock an otherwise clear left turn', () => {
  for (const logical of [false, true]) {
    const { traffic } = fixture(logical), [left, straight] = traffic.states;
    place(left, '25:-25', '75:25', 21.25, 11, 0);
    place(straight, '25:75', '25:-25', 28.75, 45, Math.PI);
    try {
      traffic.prepare(0.11);
      assert.equal(traffic.reservations.get('25:25')?.id, left.id);
      assert.ok(left.ai.control.throttle > 0);
    } finally { traffic.dispose(); }
  }
});

test('a right turn has priority over an older unentered conflicting straight permit', () => {
  for (const logical of [false, true]) {
    const { traffic } = fixture(logical), [straight, right] = traffic.states;
    place(straight, '75:25', '-25:25', 39, 21.25, -Math.PI / 2);
    place(right, '25:-25', '-25:25', 21.25, -15, 0);
    try {
      traffic.prepare(0.11);
      assert.equal(traffic.reservations.get('25:25')?.id, straight.id);
      place(right, '25:-25', '-25:25', 21.25, 11, 0);
      traffic.prepare(0.11);
      assert.equal(straight.ai.waitReason, 'junction-priority');
      assert.equal(right.ai.waitReason, null);
      assert.ok(right.ai.control.throttle > 0);
      assert.equal(traffic.reservations.get('25:25')?.id, right.id);
      for (let tick = 0; tick < 8 / STEP; tick++) {
        traffic.stepWorld({ brake: 1 }, STEP);
        assert.equal(footprintsOverlap(right, straight), false);
      }
    } finally { traffic.dispose(); }
  }
});

test('right priority does not drive into an already entered conflicting vehicle', () => {
  const { traffic } = fixture(true), [straight, right] = traffic.states;
  place(straight, '75:25', '-25:25', 33, 21.25, -Math.PI / 2);
  place(right, '25:-25', '-25:25', 21.25, -15, 0);
  try {
    traffic.prepare(0.11);
    assert.equal(traffic.reservations.get('25:25')?.entered, true);
    place(right, '25:-25', '-25:25', 21.25, 11, 0);
    traffic.prepare(0.11);
    assert.equal(traffic.reservations.get('25:25')?.id, straight.id);
    assert.equal(right.ai.control.throttle, 0);
  } finally { traffic.dispose(); }
});

test('left and right turns retain the straight cruise target and clear at cruising speed', () => {
  for (const logical of [false, true]) for (const angle of [-Math.PI / 2, Math.PI / 2]) {
    const { traffic } = fixture(logical, 1), [car] = traffic.states;
    place(car, '25:-25', angle < 0 ? '-25:25' : '75:25', 21.25, 3, 0);
    car.simulation.body.velocity.set(0, 0, 8);
    let minimumSpeed = Infinity, targets = 0, cleared = false;
    try {
      for (let tick = 0; tick < 7 / STEP; tick++) {
        traffic.stepWorld({ brake: 1 }, STEP);
        if (car.ai.reservationNode === '25:25') {
          assert.equal(car.ai.targetSpeed, 8);
          minimumSpeed = Math.min(minimumSpeed, car.speed); targets++;
        }
        if (car.ai.fromNode === '25:25' && Math.cos(car.heading - angle) > 0.98) cleared = true;
      }
      assert.ok(targets > 100 && cleared);
      assert.ok(minimumSpeed > 6.4, `turn imposed excessive slowing: ${minimumSpeed}, logical=${logical}, angle=${angle}`);
    } finally { traffic.dispose(); }
  }
});

test('U-turns have straight lead-ins and one semicircle with monotone heading, entirely within the junction', () => {
  for (const width of [12, 15, 30]) for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const path = movement(heading, heading + Math.PI, width), lane = Math.min(5.2, width / 4);
    assert.equal(path.turn, 'u-turn');
    assert.ok(Math.cos(path.points[0].heading - heading) > 0.999);
    assert.ok(Math.cos(path.points.at(-1).heading - heading - Math.PI) > 0.999);
    let totalTurn = 0;
    for (let i = 1; i < path.points.length; i++) {
      const p = path.points[i], previous = path.points[i - 1];
      const turn = Math.atan2(Math.sin(p.heading - previous.heading), Math.cos(p.heading - previous.heading));
      assert.ok(turn >= -1e-6 && turn < 0.3, `reversed or kinked U-turn: ${turn}`);
      totalTurn += turn;
      const side = -p.x * Math.cos(heading) + p.z * Math.sin(heading);
      const forward = p.x * Math.sin(heading) + p.z * Math.cos(heading);
      assert.ok(Math.abs(side) <= lane + 1e-6 && forward <= 1e-6);
      assert.ok(pathProgress(p, path) >= previous.distance - 1e-6);
    }
    assert.ok(Math.abs(totalTurn - Math.PI) < 1e-6);
  }
});

test('physical and logical U-turns exit aligned in the opposite lane without reversing or extra loops', () => {
  for (const width of [12, 15, 30]) for (const logical of [false, true]) {
    const { traffic } = fixture(logical, 1, width), [car] = traffic.states;
    const lane = Math.min(5.2, width / 4);
    place(car, '25:-25', '25:-25', 25 - lane, 3, 0);
    car.simulation.body.velocity.set(0, 0, 8);
    let reachedExit = false, totalTurn = 0, previous = car.heading;
    try {
      for (let tick = 0; tick < 8 / STEP && !reachedExit; tick++) {
        traffic.stepWorld({ brake: 1 }, STEP);
        totalTurn += Math.atan2(Math.sin(car.heading - previous), Math.cos(car.heading - previous)); previous = car.heading;
        assert.ok(car.ai.control.throttle >= 0, 'U-turn reversed instead of following the arc');
        if (car.ai.fromNode === '25:25' && car.z < 10 && Math.cos(car.heading - Math.PI) > 0.98) reachedExit = true;
      }
      assert.ok(reachedExit, `U-turn never finished: ${JSON.stringify(traffic.debug())}`);
      assert.ok(Math.abs(car.x - 25 - lane) < 1.2, `U-turn left its exit lane: ${car.x}`);
      assert.ok(totalTurn > 2.8 && totalTurn < 3.4, `U-turn added extra rotation: ${totalTurn}`);
    } finally { traffic.dispose(); }
  }
});

test('an escaping left turn ignores oncoming priority but retains collision exclusion', () => {
  const { traffic } = fixture(true), [left, straight] = traffic.states;
  place(left, '25:-25', '75:25', 21.25, 11, 0);
  place(straight, '25:75', '25:-25', 28.75, 39, Math.PI);
  left.ai.evasion = { startedAt: 0, lastImpactAt: 0, nextReplanAt: Infinity };
  try {
    traffic.prepare(0.11);
    assert.equal(left.ai.waitReason, null); assert.equal(left.ai.targetSpeed, 16);
    assert.equal(traffic.reservations.get('25:25')?.id, left.id);
    assert.equal(straight.ai.waitReason, 'intersection-reservation');
    for (let tick = 0; tick < 5 / STEP; tick++) {
      traffic.stepWorld({ brake: 1 }, STEP);
      assert.equal(footprintsOverlap(left, straight), false);
    }
  } finally { traffic.dispose(); }
});
