import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickVector } from '../src/joystick.js';

test('first touch is neutral regardless of its screen position', () => {
  for (const [x, y] of [[30, 200], [850, 350], [260, 500]]) {
    const s = joystickVector(x, y, x, y);
    assert.equal(s.strength, 0); assert.equal(s.x, 0); assert.equal(s.y, 0);
  }
});
test('same drag gives the same direction and throttle anywhere on screen', () => {
  assert.deepEqual(joystickVector(50, 200, 82, 160), joystickVector(800, 400, 832, 360));
});
test('dead zone, analog throttle and knob radius are bounded', () => {
  assert.equal(joystickVector(0, 0, 4, 4).strength, 0);
  const half = joystickVector(0, 0, 36, 0);
  assert.equal(half.strength, 0.5); assert.equal(half.x, 1);
  const far = joystickVector(0, 0, 300, -400);
  assert.equal(far.strength, 1); assert.equal(Math.hypot(far.knobX, far.knobY), 64);
});
