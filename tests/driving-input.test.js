import test from 'node:test';
import assert from 'node:assert/strict';
import { directionalInput, REVERSE_DIRECTION_TOLERANCE } from '../src/driving-input.js';
import { CarSimulation, STEP } from '../src/vehicle.js';

test('opposite joystick direction brakes before reverse, then forward', () => {
  const braking = directionalInput(Math.PI, 0, 15, 1, 1);
  assert.equal(braking.direction, -1); assert.equal(braking.throttle, 0); assert.ok(braking.brake > 0);
  const reverse = directionalInput(Math.PI, 0, 0, 1, -1);
  assert.equal(reverse.throttle, -1); assert.equal(reverse.brake, 0);
  const forwardBrake = directionalInput(0, 0, -8, 1, -1);
  assert.equal(forwardBrake.direction, 1); assert.equal(forwardBrake.throttle, 0);
  assert.equal(directionalInput(0, 0, 0, 1, 1).throttle, 1);
});
test('reverse steering is inverted and sideways direction keeps its current gear', () => {
  assert.ok(directionalInput(Math.PI + 0.2, 0, -3, 1, -1).steer < 0);
  assert.equal(directionalInput(Math.PI / 2, 0, 0, 1, -1).direction, -1);
  assert.equal(directionalInput(Math.PI / 2, 0, 0, 1, 1).direction, 1);
});

test('reverse engages only within a 15%-of-half-turn sector around the car rear', () => {
  assert.equal(REVERSE_DIRECTION_TOLERANCE, Math.PI * 0.15);
  const insideRearSector = directionalInput(Math.PI - REVERSE_DIRECTION_TOLERANCE * 0.8, 0, 0, 0.2, 1);
  assert.equal(insideRearSector.direction, -1);
  assert.ok(insideRearSector.throttle < 0);

  const outsideRearSector = directionalInput(Math.PI - REVERSE_DIRECTION_TOLERANCE * 1.2, 0, 0, 1, 1);
  assert.equal(outsideRearSector.direction, 1);
  assert.ok(outsideRearSector.throttle > 0);

  const fullReverse = directionalInput(Math.PI, 0, 0, 1, 1);
  assert.equal(fullReverse.throttle, -1);
});
test('normal corner assist brakes at high turn demand while intentional drift keeps the chosen gear', () => {
  const normal = directionalInput(Math.PI / 2, 0, 80 / 3.6, 1, 1);
  assert.ok(normal.brake > 0.6);
  assert.equal(normal.throttle, 0);
  const drift = directionalInput(Math.PI, 0, 10, 1, 1, { mode: 'drift' });
  assert.equal(drift.direction, 1);
  assert.equal(drift.handbrake, true);
  assert.ok(drift.throttle > 0);
});
test('corner assist reduces lateral speed without sacrificing turn progress at city speeds', () => {
  const measure = (entryKmh, turnSign, cornerAssist) => {
    const sim = new CarSimulation();
    for (let i = 0; i < 360; i++) sim.step({ brake: 0.3 });
    const forward = sim.body.quaternion.vmult({ x: 0, y: 0, z: 1 });
    sim.body.velocity.set(forward.x * entryKmh / 3.6, 0, forward.z * entryKmh / 3.6);
    const startHeading = sim.telemetry().heading;
    let direction = 1, lateral = 0, maxRoll = 0;
    for (let i = 0; i < 180; i++) {
      const telemetry = sim.telemetry();
      const input = directionalInput(startHeading + turnSign * Math.PI / 2, telemetry.heading, telemetry.signedSpeed,
        1, direction, { cornerAssist });
      direction = input.direction;
      sim.step(input);
      const right = sim.body.quaternion.vmult({ x: 1, y: 0, z: 0 });
      lateral += Math.abs(sim.body.velocity.dot(right));
      maxRoll = Math.max(maxRoll, Math.abs(sim.telemetry().roll));
    }
    return { lateral: lateral / 180, speed: sim.telemetry().speed,
      heading: (sim.telemetry().heading - startHeading) * turnSign, maxRoll, grounded: sim.telemetry().grounded };
  };
  for (const speed of [40, 60, 80]) for (const sign of [-1, 1]) {
    const baseline = measure(speed, sign, false);
    const assisted = measure(speed, sign, true);
    assert.ok(assisted.lateral < baseline.lateral * 0.75, `${speed} km/h ${sign}: lateral ${assisted.lateral} vs ${baseline.lateral}`);
    assert.ok(assisted.heading >= baseline.heading, `${speed} km/h ${sign}: turn progress regressed`);
    assert.ok(assisted.maxRoll < 0.4 && assisted.grounded >= 2);
  }
});
test('physical forward-reverse-forward transition and coasting', () => {
  const sim = new CarSimulation();
  for (let i = 0; i < 360; i++) sim.step();
  let direction = 1;
  const heading = sim.telemetry().heading;
  const runTarget = (target, seconds) => {
    for (let i = 0; i < seconds / STEP; i++) {
      const t = sim.telemetry();
      const input = directionalInput(target, t.heading, t.signedSpeed, 1, direction);
      direction = input.direction; sim.step(input);
    }
  };
  runTarget(heading, 2); assert.ok(sim.signedSpeed > 15);
  const beforeRelease = sim.signedSpeed;
  for (let i = 0; i < 120; i++) sim.step({ brake: 0.18 });
  assert.ok(sim.signedSpeed > beforeRelease * 0.7, 'Release should preserve substantial momentum');
  runTarget(heading + Math.PI, 5); assert.ok(sim.signedSpeed < -8);
  runTarget(heading, 5); assert.ok(sim.signedSpeed > 12);
});
