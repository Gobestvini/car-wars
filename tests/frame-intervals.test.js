import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameIntervals } from '../src/frame-intervals.js';
test('first frame and paused time do not form intervals', () => {
  const window = new FrameIntervals();
  assert.equal(window.snapshot().p95, null);
  window.push(0); assert.equal(window.snapshot().sampleCount, 0);
  window.push(16); assert.equal(window.snapshot().mean, 16);
  window.reset(); window.push(5000); assert.equal(window.snapshot().sampleCount, 0);
  window.push(5017); assert.equal(window.snapshot().mean, 17);
});
test('known percentile thresholds, duration and bounded eviction', () => {
  const window = new FrameIntervals(100); let stamp = 0; window.push(stamp);
  for (let i = 1; i <= 100; i++) { stamp += i; window.push(stamp); }
  assert.deepEqual(window.snapshot(), { sampleCount: 100, durationMs: 5050, mean: 50.5,
    p50: 50, p95: 95, p99: 99, max: 100, over25: 75, over33_34: 67, over50: 50 });
  for (let i = 0; i < 100; i++) { stamp += 10; window.push(stamp); }
  assert.equal(window.snapshot().max, 10); assert.equal(window.snapshot().durationMs, 1000);
  window.push(NaN); assert.equal(window.snapshot().sampleCount, 100);
});
