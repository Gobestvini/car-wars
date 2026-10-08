import test from 'node:test';
import assert from 'node:assert/strict';
import { miniatureBlurFocusRadius, miniatureBlurSamples, miniatureBlurTargetSize, miniatureBlurWeight,
  normalizeBlurFocusSize, normalizeBlurStrength, MINIATURE_BLUR } from '../src/miniature-blur.js';

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
test('focus band has a fixed screen center and user-sized screen-space coverage', () => {
  assert.equal(MINIATURE_BLUR.low.radiusCss, 3);
  assert.equal(MINIATURE_BLUR.high.radiusCss, 5);
  assert.equal(MINIATURE_BLUR.focusY, .5);
  assert.equal(MINIATURE_BLUR.focusSize, .68);
  assert.equal(normalizeBlurFocusSize(.1), .2);
  assert.equal(normalizeBlurFocusSize(.68), .68);
  assert.equal(normalizeBlurFocusSize(1), .9);
  assert.equal(normalizeBlurFocusSize(NaN), .68);
  assert.ok(Math.abs(miniatureBlurFocusRadius(.68) * 2 * MINIATURE_BLUR.transitionStart - .68) < 1e-12);
  assert.equal(miniatureBlurWeight(.5, MINIATURE_BLUR.focusY, miniatureBlurFocusRadius(.68)), 0);
  assert.ok(miniatureBlurWeight(.5 + .68 / 2, MINIATURE_BLUR.focusY, miniatureBlurFocusRadius(.68)) < 1e-12);
});
