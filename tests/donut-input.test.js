import test from 'node:test';
import assert from 'node:assert/strict';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { DonutGesture, donutDriveInput } from '../src/donut-input.js';

test('circular joystick motion activates only after a deliberate fast rotation', () => {
  const gesture = new DonutGesture();
  gesture.begin();
  gesture.update(0, 1, 0, 0);
  assert.equal(gesture.update(1.4, 1, 0, 0.25).active, false);
  const active = gesture.update(1.6, 1, 0, 0.5);
  assert.equal(active.active, true);
  assert.equal(active.direction, 1);

  gesture.begin();
  gesture.update(0, 0.56, 55, 0);
  assert.equal(gesture.update(0.8, 0.56, 55, 0.5).active, false);
  assert.equal(gesture.update(1.6, 0.56, 55, 1).active, true, 'a deliberate shorter-radius circle should work at driving speed');
});

test('angle wrapping, speed gate, weak input, and stale gestures are handled', () => {
  const gesture = new DonutGesture();
  gesture.begin();
  gesture.update(3.0, 1, 0, 0);
  assert.equal(gesture.update(-3.0, 1, 0, 0.1).active, false);
  assert.equal(gesture.update(-1.0, 1, 0, 0.3).active, true);
  assert.equal(gesture.read(0.29, 0.4).active, false);

  gesture.begin();
  gesture.update(0, 1, 70, 0);
  assert.equal(gesture.update(1.3, 1, 70, 0.2).active, false);
  gesture.update(0, 1, 0, 1);
  assert.equal(gesture.update(1.3, 1, 0, 1.2).active, false);
  assert.equal(gesture.update(2.3, 1, 0, 1.4).active, true);
  assert.equal(gesture.read(1, 2.2).active, false);
});

test('one-finger drift command completes two compact physical circles in either direction', () => {
  for (const screenDirection of [-1, 1]) {
    const sim = new CarSimulation();
    let previousHeading = sim.telemetry().heading, unwrappedHeading = 0;
    const positions = [];
    const lapTimes = [];
    for (let i = 0; i < 8 / STEP; i++) {
      sim.step(donutDriveInput(screenDirection, 0.9));
      const heading = sim.telemetry().heading;
      unwrappedHeading += Math.atan2(Math.sin(heading - previousHeading), Math.cos(heading - previousHeading));
      previousHeading = heading;
      positions.push({ x: sim.body.position.x, z: sim.body.position.z });
      if (-screenDirection * unwrappedHeading >= Math.PI * 2 * (lapTimes.length + 1)) lapTimes.push(i * STEP);
      assert.ok(Math.abs(sim.telemetry().roll) < 0.4);
      assert.ok(sim.telemetry().grounded >= 2);
    }
    assert.equal(lapTimes.length, 2);
    assert.ok(lapTimes[1] <= 8, `second circle at ${lapTimes[1]} seconds`);
    const circle = (from, to) => {
      const points = positions.slice(from, to);
      const center = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        z: points.reduce((sum, p) => sum + p.z, 0) / points.length };
      const radius = points.reduce((sum, p) => sum + Math.hypot(p.x - center.x, p.z - center.z), 0) / points.length;
      return { center, radius };
    };
    const first = circle(0, Math.round(lapTimes[0] / STEP));
    const second = circle(Math.round(lapTimes[0] / STEP), Math.round(lapTimes[1] / STEP));
    assert.ok(first.radius <= 8 && second.radius <= 8);
    assert.ok(Math.hypot(first.center.x - second.center.x, first.center.z - second.center.z) <= 4);
    assert.ok(sim.telemetry().slip > 0.3);
  }
});
