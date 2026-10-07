import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventReader, economySettings, economicalInstructions, formatUsage, normalizeUsage, sumUsage } from '../tools/telegram/economy.js';

test('phase policy keeps medium effort except helping and caps tool output', () => {
  assert.deepEqual(economySettings('planning'), { effort: 'medium', toolOutputTokenLimit: 2000 });
  assert.deepEqual(economySettings('implementing'), { effort: 'medium', toolOutputTokenLimit: 2000 });
  assert.deepEqual(economySettings('helping'), { effort: 'high', toolOutputTokenLimit: 2000 });
  assert.equal(economySettings('other').effort, 'medium');
});

test('instructions are role-specific and retain concise-work guidance', () => {
  for (const role of ['planner', 'worker', 'helper']) {
    const text = economicalInstructions(role);
    assert.ok(text.length < 500);
    assert.match(text, /не ослабляя проверок/);
    assert.match(text, /1500/);
  }
  assert.match(economicalInstructions('planner'), /Планировщик/);
});

test('normalizes token aliases, cache and reasoning without inventing missing fields', () => {
  assert.deepEqual(normalizeUsage({ input_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 12 } }), {
    input: 120, cachedInput: 40, uncachedInput: 80, output: 30, reasoningOutput: 12,
  });
  assert.deepEqual(normalizeUsage({ inputTokens: 10 }), {
    input: 10, cachedInput: null, uncachedInput: null, output: null, reasoningOutput: null,
  });
  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage({}), null);
});

test('sums stages once and counts stages with missing usage as unknown', () => {
  assert.deepEqual(sumUsage([
    { usage: { input_tokens: 100, cached_input_tokens: 25, output_tokens: 30, reasoning_output_tokens: 8 } },
    { usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 15, reasoning_output_tokens: 3 } },
    { usage: null },
  ]), {
    input: 150, cachedInput: 35, uncachedInput: 115, output: 45, reasoningOutput: 11, completed: 2, unknown: 1,
  });
  assert.match(formatUsage([{ usage: { input_tokens: 100, output_tokens: 20 } }, { usage: null }]), /1 запуск.*без данных/);
  assert.match(formatUsage([{ usage: null }]), /нет данных/);
});

test('event reader parses JSONL across arbitrary chunks and ignores non-JSON lines', () => {
  const events = [];
  const reader = createEventReader(event => events.push(event));
  reader.push(Buffer.from('{"type":"start"}\nnot json\n{"type":"usage_tokens","usage":{"input_tokens":'));
  reader.push('7}}\r\n');
  reader.push('{"type":"final"}');
  assert.deepEqual(events, [{ type: 'start' }, { type: 'usage_tokens', usage: { input_tokens: 7 } }]);
  reader.flush();
  assert.deepEqual(events, [{ type: 'start' }, { type: 'usage_tokens', usage: { input_tokens: 7 } }, { type: 'final' }]);
});
