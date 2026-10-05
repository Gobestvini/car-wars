import test from 'node:test';
import assert from 'node:assert/strict';
import { targetCameraScale, smoothCameraScale } from '../src/camera-distance.js';

test('camera target scale follows the bounded smooth speed range', () => {
  assert.equal(targetCameraScale(0), 1);
  assert.equal(targetCameraScale(15), 1);
  assert.ok(Math.abs(targetCameraScale(62.5) - 1.175) < 1e-6);
  assert.equal(targetCameraScale(110), 1.35);
  assert.equal(targetCameraScale(200), 1.35);
  let previous = targetCameraScale(15);
  for (let speed = 16; speed <= 110; speed++) {
    const next = targetCameraScale(speed);
    assert.ok(next > previous, `target should rise at ${speed} km/h`);
    previous = next;
  }
  assert.ok(Number.isFinite(targetCameraScale(-10)));
  assert.equal(targetCameraScale(Number.NaN), 1);
});

function advance(start, target, hz, seconds = 1) {
  const count = hz * seconds;
  const values = [start];
  for (let i = 0; i < count; i++) values.push(smoothCameraScale(values.at(-1), target, 1 / hz));
  return values;
}

test('zooming out is monotone, bounded, and frame-rate independent', () => {
  const runs = [30, 60, 120].map(hz => advance(1, 1.35, hz));
  for (const values of runs) {
    assert.ok(values.every((value, i) => i === 0 || (value >= values[i - 1] && value <= 1.35)));
    const progress = (values.at(-1) - 1) / 0.35;
    assert.ok(progress >= 0.90 && progress <= 0.94);
  }
  assert.ok(Math.max(...runs.map(run => run.at(-1))) - Math.min(...runs.map(run => run.at(-1))) < 1e-6);
});

test('zooming in is monotone, bounded, and frame-rate independent', () => {
  const runs = [30, 60, 120].map(hz => advance(1.35, 1, hz));
  for (const values of runs) {
    assert.ok(values.every((value, i) => i === 0 || (value <= values[i - 1] && value >= 1)));
    const progress = (1.35 - values.at(-1)) / 0.35;
    assert.ok(progress >= 0.80 && progress <= 0.86);
  }
  assert.ok(Math.max(...runs.map(run => run.at(-1))) - Math.min(...runs.map(run => run.at(-1))) < 1e-6);
});

test('zero, negative, and non-finite dt leave camera state unchanged', () => {
  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(smoothCameraScale(1.2, 1.35, dt), 1.2);
  }
  assert.ok(Number.isFinite(smoothCameraScale(Number.NaN, Number.NaN, 1)));
  assert.ok(Number.isFinite(smoothCameraScale(1.2, Number.NaN, 1)));
});
