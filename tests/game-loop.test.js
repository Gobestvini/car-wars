import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStepper, FrameRateLimiter, MAX_RENDER_FPS } from '../src/game-loop.js';

test('render limiter caps high-refresh callbacks at 60 while preserving 30 FPS', () => {
  assert.equal(MAX_RENDER_FPS, 60);
  for (const refreshRate of [30, 60, 120, 144, 165]) {
    const limiter = new FrameRateLimiter(); let rendered = 0;
    for (let frame = 0; frame < refreshRate * 10; frame++) {
      if (limiter.shouldRender(frame * 1000 / refreshRate)) rendered++;
    }
    assert.ok(Math.abs(rendered - Math.min(refreshRate, 60) * 10) <= 1,
      `${refreshRate} Hz produced ${rendered} renders in 10 seconds`);
  }
});

test('render limiter retains cadence under jitter and resets after a pause', () => {
  const limiter = new FrameRateLimiter(); let rendered = 0;
  let timestamp = 0;
  for (let frame = 0; frame < 1200; frame++) {
    if (limiter.shouldRender(timestamp)) rendered++;
    timestamp += 1000 / 120 + (frame % 2 === 0 ? 0.4 : -0.4);
  }
  assert.ok(Math.abs(rendered - 600) <= 1, `jittered callbacks produced ${rendered} renders`);

  limiter.reset();
  assert.equal(limiter.shouldRender(60_000), true);
  assert.equal(limiter.shouldRender(60_001), false);
  assert.equal(limiter.shouldRender(60_000 + 1000 / 60), true);
});

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
