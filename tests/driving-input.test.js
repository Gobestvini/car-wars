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
