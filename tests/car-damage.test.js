import test from 'node:test';
import assert from 'node:assert/strict';
import { accumulateDamage, damageFromImpact, damageState, impactSeverity, tractionForDamage, wheelCanDetach } from '../src/car-damage.js';
import { CarSimulation, STEP } from '../src/vehicle.js';

test('impact severity has a quiet threshold, grows monotonically, and saturates', () => {
  assert.equal(impactSeverity(0), 0);
  assert.equal(impactSeverity(3), 0);
  assert.ok(impactSeverity(7) > impactSeverity(5));
  assert.ok(impactSeverity(20) > impactSeverity(7));
  assert.equal(impactSeverity(60), 1);
  assert.ok(damageFromImpact(20).depth > damageFromImpact(6).depth);
});

test('damage is bounded and traction fades only after half damage', () => {
  assert.equal(tractionForDamage(0.5), 1);
  assert.equal(tractionForDamage(0.75), 0.5);
  assert.equal(tractionForDamage(1), 0);
  assert.equal(damageState(1), 'destroyed');
  assert.equal(accumulateDamage(0.95, 1), 1);
  assert.equal(accumulateDamage(0.2, -1), 0.2);
});

test('wheel detaches only after a severe direct hit near its mount', () => {
  assert.equal(wheelCanDetach(13.9, 0), false);
  assert.equal(wheelCanDetach(14, 0.62), true);
  assert.equal(wheelCanDetach(20, 0.63), false);
});

test('detached wheel becomes a dynamic body and reset restores it', () => {
  const simulation = new CarSimulation();
  const wheel = simulation.wheels[0];
  simulation.detachWheelAtImpact({ speed: 18, point: { x: wheel.mount.x, y: wheel.mount.y, z: wheel.mount.z }, normal: { x: -1, y: 0, z: 0 } });
  assert.equal(wheel.detached, true);
  assert.ok(simulation.world.bodies.includes(wheel.detachedBody));
  simulation.step({}, 1 / 120);
  assert.equal(wheel.load, 0);
  simulation.reset();
  assert.equal(wheel.detached, false);
  assert.equal(wheel.detachedBody, null);
});

test('a direct high-speed wheel-zone impact detaches only the struck wheel', () => {
  const simulation = new CarSimulation();
  simulation.addStaticBox({ x: -1.72, y: 0.7, z: 0.44, halfX: 0.15, halfY: 0.7, halfZ: 0.35, yaw: -0.45 });
  simulation.body.velocity.set(-16.2, 0, -7.83);
  for (let i = 0; i < 90 && !simulation.wheels.some(wheel => wheel.detached); i++) simulation.step({}, STEP);
  assert.deepEqual(simulation.wheels.map(wheel => wheel.detached), [true, false, false, false]);
  simulation.step({}, STEP);
  assert.equal(simulation.wheels[0].grounded, false);
  assert.ok(simulation.world.bodies.includes(simulation.wheels[0].detachedBody));
});

test('a real chassis impact against a static box creates one fixed-step impact event', () => {
  const simulation = new CarSimulation();
  simulation.addStaticBox({ x: 0, y: 0.9, z: 4.1, halfX: 2, halfY: 1, halfZ: 0.25 });
  simulation.body.position.set(0, 0.96, 0);
  simulation.body.quaternion.setFromEuler(0, 0, 0);
  simulation.body.velocity.set(0, 0, 18);
  simulation.body.angularVelocity.setZero();
  let events = [];
  for (let i = 0; i < 40; i++) {
    const before = simulation.world.stepnumber;
    simulation.step({}, STEP);
    assert.equal(simulation.world.stepnumber, before + 1);
    events = simulation.drainImpactEvents();
    if (events.length) break;
  }
  assert.ok(events.length, 'expected a contact impact event');
  assert.ok(simulation.damage > 0);
  const [impact] = events;
  assert.ok(impact.point.z > 1 && impact.normal.z < -0.5);
});

test('front, rear, side, and rotated-front impacts keep their local contact direction', () => {
  const cases = [
    { name: 'front', wall: { x: 0, y: 0.9, z: 4.1, halfX: 2, halfY: 1, halfZ: 0.25 }, velocity: [0, 0, 18], yaw: 0, axis: 'z', pointSign: 1, normalSign: -1 },
    { name: 'rear', wall: { x: 0, y: 0.9, z: -4.1, halfX: 2, halfY: 1, halfZ: 0.25 }, velocity: [0, 0, -18], yaw: 0, axis: 'z', pointSign: -1, normalSign: 1 },
    { name: 'side', wall: { x: 4.1, y: 0.9, z: 0, halfX: 0.25, halfY: 1, halfZ: 2 }, velocity: [18, 0, 0], yaw: 0, axis: 'x', pointSign: 1, normalSign: -1 },
    { name: 'rotated front', wall: { x: 4.1, y: 0.9, z: 0, halfX: 0.25, halfY: 1, halfZ: 2 }, velocity: [18, 0, 0], yaw: Math.PI / 2, axis: 'z', pointSign: 1, normalSign: -1 },
  ];
  for (const scenario of cases) {
    const simulation = new CarSimulation();
    simulation.addStaticBox(scenario.wall);
    simulation.body.position.set(0, 0.96, 0);
    simulation.body.quaternion.setFromEuler(0, scenario.yaw, 0);
    simulation.body.velocity.set(...scenario.velocity);
    let events = [];
    for (let i = 0; i < 40 && events.length === 0; i++) { simulation.step({}, STEP); events = simulation.drainImpactEvents(); }
    assert.ok(events.length, `${scenario.name} impact was detected`);
    assert.ok(events[0].point[scenario.axis] * scenario.pointSign > 0.5, `${scenario.name} point is on the contacted side`);
    assert.ok(events[0].normal[scenario.axis] * scenario.normalSign > 0.5, `${scenario.name} normal points into the body`);
  }
});

test('a 17 m/s frontal hit dents more than a 6 m/s frontal hit', () => {
  const measure = speed => {
    const simulation = new CarSimulation();
    simulation.addStaticBox({ x: 0, y: 0.9, z: 4.1, halfX: 2, halfY: 1, halfZ: 0.25 });
    simulation.body.position.set(0, 0.96, 0);
    simulation.body.quaternion.setFromEuler(0, 0, 0);
    simulation.body.velocity.set(0, 0, speed);
    for (let i = 0; i < 60; i++) {
      simulation.step({}, STEP);
      const [impact] = simulation.drainImpactEvents();
      if (impact) return impact.impact.depth;
    }
    return 0;
  };
  assert.ok(measure(17) > measure(6));
});

test('holding against a wall does not repeat damage; a later separated hit counts', () => {
  const simulation = new CarSimulation();
  simulation.addStaticBox({ x: 0, y: 0.9, z: 4.1, halfX: 2, halfY: 1, halfZ: 0.25 });
  simulation.body.position.set(0, 0.96, 0);
  simulation.body.quaternion.setFromEuler(0, 0, 0);
  simulation.body.velocity.set(0, 0, 18);
  let events = [];
  for (let i = 0; i < 40 && !events.length; i++) { simulation.step({}, STEP); events = simulation.drainImpactEvents(); }
  assert.ok(events.length);
  const firstDamage = simulation.damage;
  for (let i = 0; i < 3 / STEP; i++) { simulation.step({ throttle: 1 }, STEP); assert.deepEqual(simulation.drainImpactEvents(), []); }
  assert.equal(simulation.damage, firstDamage);

  simulation.body.position.set(0, 0.96, 0); simulation.body.velocity.setZero(); simulation.body.angularVelocity.setZero();
  simulation.body.aabbNeedsUpdate = true;
  for (let i = 0; i < 12; i++) simulation.step({}, STEP);
  simulation.body.velocity.set(0, 0, 18);
  events = [];
  for (let i = 0; i < 40 && !events.length; i++) { simulation.step({}, STEP); events = simulation.drainImpactEvents(); }
  assert.ok(events.length, 'a separate later impact should be accepted');
  assert.ok(simulation.damage > firstDamage);
});

test('repeated real frontal impacts accumulate to the destroyed state', () => {
  const simulation = new CarSimulation();
  simulation.addStaticBox({ x: 0, y: 0.9, z: 4.1, halfX: 2, halfY: 1, halfZ: 0.25 });
  let count = 0;
  while (simulation.damage < 1 && count < 8) {
    simulation.body.position.set(0, 0.96, 0);
    simulation.body.quaternion.setFromEuler(0, 0, 0);
    simulation.body.velocity.setZero(); simulation.body.angularVelocity.setZero();
    simulation.body.aabbNeedsUpdate = true;
    for (let i = 0; i < 90; i++) simulation.step({}, STEP);
    simulation.body.velocity.set(0, 0, 17);
    let events = [];
    for (let i = 0; i < 60 && !events.length; i++) { simulation.step({}, STEP); events = simulation.drainImpactEvents(); }
    assert.ok(events.length, `impact ${count + 1} should reach the static obstacle`);
    count++;
  }
  assert.equal(simulation.damage, 1);
  assert.equal(simulation.telemetry().damageState, 'destroyed');
  assert.equal(simulation.telemetry().traction, 0);
});

test('reset clears impact and damage state', () => {
  const simulation = new CarSimulation();
  simulation.damage = 0.7;
  simulation.impactEvents.push({ point: { x: 1, y: 0, z: 0 } });
  simulation.reset();
  assert.equal(simulation.damage, 0);
  assert.deepEqual(simulation.drainImpactEvents(), []);
  assert.equal(simulation.telemetry().traction, 1);
});

test('thirty seconds of simulation without contact causes no damage', () => {
  const simulation = new CarSimulation();
  for (let i = 0; i < 30 / STEP; i++) simulation.step({}, STEP);
  assert.equal(simulation.damage, 0);
  assert.deepEqual(simulation.drainImpactEvents(), []);
});

test('destroyed engine loses throttle while chassis still steps and brakes', () => {
  const simulation = new CarSimulation();
  simulation.damage = 1;
  for (let i = 0; i < 120; i++) simulation.step({ throttle: 1 }, STEP);
  assert.ok(simulation.telemetry().speed < 2);
  simulation.body.velocity.set(0, 0, 4);
  for (let i = 0; i < 30; i++) simulation.step({ brake: 1 }, STEP);
  assert.ok(simulation.telemetry().speed < 15);
});
