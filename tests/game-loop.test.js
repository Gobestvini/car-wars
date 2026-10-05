import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStepper } from '../src/game-loop.js';

test('render frequency does not change fixed simulation time', () => {
  for (const fps of [30, 60, 120, 144]) {
    const loop = new FixedStepper(); let ticks = 0;
    for (let frame = 0; frame < fps * 10; frame++) {
      const result = loop.advance(1 / fps, () => ticks++);
      assert.ok(result.alpha >= 0 && result.alpha <= 1);
    }
    assert.equal(ticks, 1200);
  }
});
test('long stalls have bounded catch-up and pause discards remainder', () => {
  const loop = new FixedStepper(); let ticks = 0;
  assert.equal(loop.advance(5, () => ticks++).steps, 10);
  assert.equal(ticks, 10); assert.ok(loop.droppedSeconds > 4.9);
  loop.advance(.003, () => ticks++); loop.reset();
  assert.equal(loop.advance(.006, () => ticks++).steps, 0);
});
