import test from 'node:test';
import assert from 'node:assert/strict';
import { DamageEffectController, damageVisualStage } from '../src/car-damage-effects.js';

test('visual damage boundaries distinguish every stage', () => {
  assert.deepEqual([0, .149, .15, .449, .45, .749, .75, 1].map(damageVisualStage),
    ['healthy', 'healthy', 'grey-smoke', 'grey-smoke', 'dark-smoke', 'dark-smoke', 'fire', 'terminal']);
});
test('healthy idle produces no emission; darker damage increases smoke and fire', () => {
  const state = new DamageEffectController();
  for (let i = 0; i < 120; i++) state.update(0, 1 / 60);
  assert.equal(state.smoke, 0); assert.equal(state.fire, 0);
  for (const damage of [.25, .6, .85]) {
    const before = state.smoke;
    for (let i = 0; i < 120; i++) state.update(damage, 1 / 60);
    assert.ok(state.smoke > before);
    assert.equal(state.fire > 0, damage === .85);
  }
});
test('direct terminal jump burns for 0.6s and bursts exactly once at all frame rates', () => {
  for (const fps of [30, 60, 120]) {
    const state = new DamageEffectController(); let bursts = 0;
    for (let i = 1; i <= fps * 7; i++) {
      const burst = state.update(1, 1 / fps); bursts += Number(burst);
      if (i < fps * .6) { assert.equal(state.exploded, false); assert.equal(state.fire, 1); }
      if (i === fps * .6) assert.equal(burst, true);
    }
    assert.equal(bursts, 1); assert.equal(state.explosions, 1); assert.equal(state.smoke, 0);
    state.reset(); assert.equal(state.exploded, false); assert.equal(state.smoke, 0);
    for (let i = 0; i < fps * .6; i++) state.update(1, 1 / fps);
    assert.equal(state.explosions, 1);
  }
});
test('reset before the flash cancels terminal time and repeats the full warning', () => {
  const state = new DamageEffectController(); state.update(1, .4); state.reset();
  assert.equal(state.update(1, .4), false); assert.equal(state.update(1, .2), true);
});
