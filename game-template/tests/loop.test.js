import test from 'node:test';
import assert from 'node:assert/strict';
import { createStepper } from '../src/loop.js';

test('simulation covers the same duration at 30/60/120/144 FPS', () => {
  for (const fps of [30, 60, 120, 144]) {
    const loop = createStepper();
    let steps = 0;
    for (let frame = 0; frame < fps * 10; frame++) loop.advance(1 / fps, () => steps++);
    assert.equal(steps, 600, `${fps} FPS`);
  }
});
test('long stalls limit work and reset clears interpolation remainder', () => {
  const loop = createStepper();
  const result = loop.advance(5, () => {});
  assert.equal(result.steps, 8);
  assert.ok(result.dropped > 4);
  assert.ok(result.alpha >= 0 && result.alpha <= 1);
  loop.advance(1 / 120, () => {});
  loop.reset();
  assert.equal(loop.advance(1 / 120, () => {}).steps, 0);
});
test('invalid timing is rejected', () => {
  assert.throws(() => createStepper({ step: 0 }), RangeError);
  assert.throws(() => createStepper({ maxSteps: 0 }), RangeError);
  assert.throws(() => createStepper().advance(NaN, () => {}), RangeError);
});
