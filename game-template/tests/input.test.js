import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from '../src/input.js';

test('focus loss and disposal release held input', () => {
  const target = new EventTarget();
  const input = createInput(target);
  const key = () => Object.assign(new Event('keydown'), { code: 'KeyW' });
  target.dispatchEvent(key()); assert.ok(input.keys.has('KeyW'));
  target.dispatchEvent(new Event('blur')); assert.equal(input.keys.size, 0);
  input.dispose();
  target.dispatchEvent(key()); assert.equal(input.keys.size, 0);
});
