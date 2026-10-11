import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameRateLimiter } from '../src/game-loop.js';
import { SceneProfile, GpuProfile } from '../src/scene-profile.js';

test('stage samples are frame totals and diagnostic storage disappears on stop', () => {
  const profile = new SceneProfile(3);
  assert.equal(profile.stages, null);
  profile.start();
  profile.stages.aiMs = 2; profile.stages.worldStepMs = 4;
  profile.record(0, 10, 7, 1, 2, 42, 1000, 2, 0);
  profile.resetStages();
  profile.record(17, 5, 2, 1, 2, 42, 1000, 2, 0);
  const result = profile.snapshot(), ai = result.columns.indexOf('aiMs');
  assert.deepEqual(result.rows.map(row => row[ai]), [2, 0]);
  assert.equal(result.rows[0][result.columns.indexOf('worldStepMs')], 4);
  profile.stop();
  assert.equal(profile.data, null); assert.equal(profile.stages, null);
});

test('profile records actual accepted renders at 120/144 Hz, never external callbacks', () => {
  for (const hz of [120, 144]) {
    const profile = new SceneProfile(1000), limiter = new FrameRateLimiter();
    assert.equal(profile.data, null);
    profile.start();
    for (let i = 0; i < hz * 10; i++) {
      const stamp = i * 1000 / hz;
      if (limiter.shouldRender(stamp)) {
        profile.accept(); profile.record(stamp, 1, .2, .3, .5, 42, 1000, 2, 0);
      }
    }
    const result = profile.snapshot();
    assert.equal(result.rows.length, 600);
    assert.equal(new Set(result.rows.map(row => row[0])).size, 600);
    assert.ok(result.rows.slice(1).every(row => row[2] > 0));
    assert.equal(result.accepted, result.rendered);
  }
});
test('bounded profile retains chronological rows; stopped profiling still counts renders', () => {
  const profile = new SceneProfile(2); profile.start();
  for (let i = 0; i < 5; i++) profile.record(i * 20, i, 0, 0, 0, 0, 0, 0, 0);
  const result = profile.snapshot();
  assert.deepEqual(result.rows.map(row => row[0]), [4, 5]);
  assert.equal(result.overwritten, 3);
  profile.stop(); profile.record(100, 0, 0, 0, 0, 0, 0, 0, 0);
  assert.equal(profile.rendered, 6);
  profile.start(); assert.equal(profile.snapshot().rows.length, 0);
});
test('GPU absence is explicit, not CPU time reported as GPU', () => {
  const profile = new GpuProfile({ getExtension: () => null });
  profile.begin(1); profile.end();
  assert.equal(profile.snapshot().status, 'unavailable');
  assert.deepEqual(profile.snapshot().rows, []);
});
test('disjoint query results are discarded and GPU queries are bounded', () => {
  let disjoint = false, deleted = 0;
  const gl = { getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
    createQuery: () => ({}), beginQuery() {}, endQuery() {},
    getParameter: () => disjoint, getQueryParameter: () => false,
    deleteQuery: () => deleted++ };
  const profile = new GpuProfile(gl);
  for (let frame = 0; frame < 10; frame++) { profile.begin(frame); profile.end(); }
  assert.equal(profile.pending.length, 8); assert.equal(profile.skipped, 2);
  disjoint = true; profile.poll();
  assert.equal(deleted, 8); assert.equal(profile.discarded, 8);
  assert.deepEqual(profile.snapshot().rows, []);
});
