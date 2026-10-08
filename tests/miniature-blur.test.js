import test from 'node:test';
import assert from 'node:assert/strict';
import { miniatureBlurFocus, miniatureBlurTargetSize, MINIATURE_BLUR } from '../src/miniature-blur.js';

test('blur targets follow CSS size, DPR and portrait or landscape aspect ratios', () => {
  assert.deepEqual(miniatureBlurTargetSize(390, 844, 1.75, 'high'),
    { width: 683, height: 1477, blurWidth: 342, blurHeight: 739 });
  assert.deepEqual(miniatureBlurTargetSize(844, 390, 1, 'low'),
    { width: 844, height: 390, blurWidth: 211, blurHeight: 98 });
  assert.deepEqual(miniatureBlurTargetSize(0, 740, 1, 'high'),
    { width: 0, height: 0, blurWidth: 0, blurHeight: 0 });
});
test('gameplay quality selects a narrow radius, with a protected and safe focus between car and road', () => {
  assert.equal(MINIATURE_BLUR.low.radiusCss, 3);
  assert.equal(MINIATURE_BLUR.high.radiusCss, 5);
  assert.deepEqual(miniatureBlurFocus({ x: .5, y: .65 }, { x: .5, y: .4 }), { x: .5, y: .555 });
  assert.deepEqual(miniatureBlurFocus(null, { x: .5, y: .4 }), { x: .5, y: .5 });
  assert.deepEqual(miniatureBlurFocus({ x: NaN, y: .5 }, { x: .2, y: .3 }), { x: .5, y: .5 });
  assert.deepEqual(miniatureBlurFocus({ x: 1.2, y: .5 }, { x: .2, y: .3 }), { x: .5, y: .5 });
});
