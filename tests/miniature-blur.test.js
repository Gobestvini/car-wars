import test from 'node:test';
import assert from 'node:assert/strict';
import { miniatureBlurFocus, miniatureBlurSamples, miniatureBlurTargetSize, miniatureBlurWeight,
  normalizeBlurStrength, MINIATURE_BLUR } from '../src/miniature-blur.js';

test('blur targets follow CSS size, DPR and portrait or landscape aspect ratios', () => {
  assert.deepEqual(miniatureBlurTargetSize(390, 844, 1.75, 'high'),
    { width: 682, height: 1477, blurWidth: 341, blurHeight: 739 });
  assert.deepEqual(miniatureBlurTargetSize(844, 390, 1, 'low'),
    { width: 844, height: 390, blurWidth: 211, blurHeight: 98 });
  assert.deepEqual(miniatureBlurTargetSize(0, 740, 1, 'high'),
    { width: 0, height: 0, blurWidth: 0, blurHeight: 0 });
});

test('blur strength supports direct-render zero and bounded intensity without invalid uniforms',()=>{
  assert.equal(normalizeBlurStrength(0),0);
  assert.equal(normalizeBlurStrength(.35),.35);
  assert.equal(normalizeBlurStrength(20),2);
  assert.equal(normalizeBlurStrength(-1),0);
  assert.equal(normalizeBlurStrength(NaN),1);
});

test('vertical blur mask is independent of screen width and grows symmetrically above and below focus', () => {
  for (const y of [0, .2, .5, .8, 1]) {
    const xSamples = [0, .5, 1].map(() => miniatureBlurWeight(y, .5));
    assert.equal(xSamples[0], xSamples[1]);
    assert.equal(xSamples[1], xSamples[2]);
  }
  assert.equal(miniatureBlurWeight(.5, .5), 0);
  assert.ok(Math.abs(miniatureBlurWeight(.3, .5) - miniatureBlurWeight(.7, .5)) < 1e-12);
  assert.ok(miniatureBlurWeight(0, .5) > miniatureBlurWeight(.2, .5));
  assert.equal(miniatureBlurWeight(.5, .5, 0), 1);
});

test('scene MSAA request respects quality and available maximum samples', () => {
  assert.equal(miniatureBlurSamples('high', 8), 4);
  assert.equal(miniatureBlurSamples('low', 8), 2);
  assert.equal(miniatureBlurSamples('high', 3), 2);
  assert.equal(miniatureBlurSamples('high', 8, [2, 3]), 3);
  assert.equal(miniatureBlurSamples('high', 8, []), 0);
  assert.equal(miniatureBlurSamples('low', 1), 0);
  assert.equal(miniatureBlurSamples('high', NaN), 0);
});
test('gameplay quality selects a narrow radius, with a protected and safe focus between car and road', () => {
  assert.equal(MINIATURE_BLUR.low.radiusCss, 3);
  assert.equal(MINIATURE_BLUR.high.radiusCss, 5);
  assert.deepEqual(miniatureBlurFocus({ x: .5, y: .65 }, { x: .5, y: .4 }), { x: .5, y: .555 });
  assert.deepEqual(miniatureBlurFocus(null, { x: .5, y: .4 }), { x: .5, y: .5 });
  assert.deepEqual(miniatureBlurFocus({ x: NaN, y: .5 }, { x: .2, y: .3 }), { x: .5, y: .5 });
  assert.deepEqual(miniatureBlurFocus({ x: 1.2, y: .5 }, { x: .2, y: .3 }), { x: .5, y: .5 });
});
