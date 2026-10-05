import test from 'node:test';
import assert from 'node:assert/strict';
import { CarSimulation, STEP } from '../src/vehicle.js';
const run = (s, seconds, input = {}, dt = STEP) => { for (let i = 0; i < seconds / dt; i++) s.step(input, dt); };
const settled = () => { const s = new CarSimulation(); run(s, 3); return s; };

test('four springs hold the chassis above the ground without idle drift', () => {
  const s = settled(); run(s, 20, { brake: 0.32 });
  const t = s.telemetry();
  assert.equal(t.grounded, 4); assert.ok(t.position.y > 0.8 && t.position.y < 0.95);
  assert.ok(t.speed < 0.05); assert.ok(Math.hypot(t.position.x, t.position.z) < 0.05);
});
test('accelerates, physically turns with body roll, brakes to a stop', () => {
  const s = settled(); run(s, 3, { throttle: 1 });
  const initial = s.telemetry(); assert.ok(initial.speed > 80 && initial.speed < 115);
  let maxRoll = 0, maxSlip = 0;
  for (let i = 0; i < 360; i++) {
    s.step({ throttle: 0.55, steer: 0.8 });
    maxRoll = Math.max(maxRoll, Math.abs(s.telemetry().roll));
    maxSlip = Math.max(maxSlip, s.telemetry().slip);
  }
  assert.ok(s.telemetry().heading > initial.heading + 0.3);
  assert.ok(maxRoll > 0.03 && maxRoll < 0.4); assert.ok(maxSlip > 0.3);
  run(s, 6, { brake: 1 }); assert.ok(s.telemetry().speed < 0.15);
});

test('medium-speed steering responds quickly and holds a stable arcade turn', () => {
  const s = settled(); run(s, 3, { throttle: 0.45 });
  const entry = s.telemetry();
  assert.ok(entry.speed >= 40 && entry.speed <= 70, `entry speed ${entry.speed} km/h`);
  run(s, 0.18, { throttle: 0.45, steer: 0.65 });
  const requestedLock = 0.78 / (1 + Math.abs(s.signedSpeed) * 0.016) * 0.65;
  assert.ok(s.steering >= requestedLock * 0.8, `steer ${s.steering}, target ${requestedLock}`);
  const startHeading = s.telemetry().heading;
  let maxRoll = 0;
  run(s, 0.82, { throttle: 0.55, steer: 0.65 });
  for (const wheel of s.wheels) maxRoll = Math.max(maxRoll, Math.abs(s.telemetry().roll));
  assert.ok(s.telemetry().heading - startHeading > 0.4);
  assert.ok(maxRoll < 0.4);
  assert.equal(s.telemetry().grounded, 4);
});

test('full-lock arcade turn at top speed keeps all tires close to the ground', () => {
  const s = settled(); run(s, 6, { throttle: 1 });
  assert.ok(s.telemetry().speed > 150);
  for (let i = 0; i < 600; i++) {
    s.step({ throttle: 1, steer: 1 });
    assert.ok(s.body.position.y < 1.3);
    assert.ok(Math.abs(s.telemetry().roll) < 0.45);
    for (const wheel of s.wheels) assert.ok(Math.abs(wheel.position.y - wheel.radius) < 0.04);
  }
});
test('reverse and reset remain functional after a hard maneuver', () => {
  const s = settled(); run(s, 4, { throttle: -1 }); assert.ok(s.signedSpeed < -3);
  run(s, 4, { throttle: 1, steer: -1, handbrake: true });
  s.reset(); assert.equal(s.body.velocity.length(), 0); assert.equal(s.steering, 0);
  run(s, 3); assert.equal(s.telemetry().grounded, 4);
  assert.ok(Math.hypot(s.body.position.x, s.body.position.z) < 0.05);
});
test('fixed step has similar acceleration at 60 Hz and 120 Hz', () => {
  const a = settled(), b = settled(); run(a, 6, { throttle: 1 }); run(b, 6, { throttle: 1 }, 1 / 60);
  assert.ok(Math.abs(a.telemetry().speed - b.telemetry().speed) < 3);
});
test('tuning extremes stay finite through prolonged steering and braking', () => {
  for (const tuning of [{ softness: 1, grip: 0.55, power: 1.6 }, { softness: 0, grip: 1.25, power: 0.5 }]) {
    const s = settled(); Object.assign(s.tuning, tuning);
    for (let i = 0; i < 7200; i++) {
      s.step({ throttle: i % 1200 < 900 ? 1 : 0, brake: i % 1200 >= 900 ? 1 : 0, steer: Math.sin(i / 400), handbrake: i % 1700 > 1550 });
      assert.ok([s.body.position.x, s.body.position.y, s.body.position.z, s.body.velocity.length()].every(Number.isFinite));
      assert.ok(s.body.position.y > 0.1 && s.body.position.y < 10);
    }
  }
});
