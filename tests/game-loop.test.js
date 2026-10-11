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

test('60Hz early callbacks and seeded jitter preserve cadence over a minute', () => {
  for (const phase of [0, 231.57]) for (const pattern of ['alternating', 'random']) {
    const limiter = new FrameRateLimiter(); let seed = 104729, timestamps = [];
    for (let i = 0; i < 3600; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const jitter = pattern === 'alternating' ? (i % 2 ? -.4 : .4) : (seed / 2 ** 32 - .5) * .8;
      const timestamp = phase + i * 1000 / 60 + jitter;
      if (limiter.shouldRender(timestamp)) timestamps.push(timestamp);
    }
    assert.equal(timestamps.length, 3600, `${pattern}, phase ${phase}`);
    const intervals = timestamps.slice(1).map((stamp, i) => stamp - timestamps[i]);
    assert.ok(Math.max(...intervals) < 17.48);
    assert.ok(Math.min(...intervals) > 15.86);
  }
});
test('near60Hz and jittered discrete refresh rates keep the long-window cap', () => {
  for (const hz of [30, 59.94, 60, 60.06, 120, 144, 165]) for (const jitter of [0, .4]) {
    const limiter = new FrameRateLimiter(), stamps = [];
    const callbacks = Math.floor(hz * 60);
    for (let i = 0; i < callbacks; i++) {
      const stamp = 19.7 + i * 1000 / hz + (i % 2 ? -jitter : 0);
      if (limiter.shouldRender(stamp)) stamps.push(stamp);
    }
    const expected = Math.min(callbacks, 3600);
    assert.ok(Math.abs(stamps.length - expected) <= 1, `${hz}Hz jitter${jitter}: ${stamps.length}`);
    if ([30, 60, 120].includes(hz)) {
      assert.ok(stamps.slice(1).every((stamp, i) => Math.abs(stamp - stamps[i] - 1000 / Math.min(hz, 60)) < .81));
    }
  }
});
test('invalid timestamp and a late stall cannot cause catch-up render bursts', () => {
  const limiter = new FrameRateLimiter();
  assert.equal(limiter.shouldRender(NaN), false);
  assert.equal(limiter.shouldRender(0), true);
  assert.equal(limiter.shouldRender(5000), true);
  assert.equal(limiter.shouldRender(5000), false);
  assert.equal(limiter.shouldRender(Infinity), false);
  limiter.reset(); assert.equal(limiter.shouldRender(5000), true);
});
