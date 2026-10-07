import { StringDecoder } from 'node:string_decoder';

const PHASE_EFFORT = Object.freeze({
  planning: 'medium',
  implementing: 'medium',
  helping: 'high',
});

export function economySettings(phase) {
  return { effort: PHASE_EFFORT[phase] ?? 'medium', toolOutputTokenLimit: 2000 };
}

export function economicalInstructions(role) {
  const heading = role === 'planner' ? 'Планировщик' : role === 'worker' ? 'Исполнитель' : 'Помощник';
  return `${heading}: читай через rg только нужные фрагменты; не перечитывай инструкции и весь проект. Используй актуальную память проекта. Длинные логи сохраняй в файл, извлекай строки ошибки. Ответ — ориентир до 1500 токенов, задание до 900 слов без потери требований. Не расширяй запрос рефакторингом и исследованиями. Проверяй обязательные сценарии, не ослабляя проверок.`;
}

const firstNumber = (...values) => {
  for (const value of values) if (Number.isFinite(value)) return value;
  return null;
};

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input = firstNumber(usage.input_tokens, usage.inputTokens, usage.prompt_tokens, usage.promptTokens);
  const cachedInput = firstNumber(usage.cached_input_tokens, usage.cachedInputTokens,
    usage.input_tokens_details?.cached_tokens, usage.inputTokensDetails?.cachedTokens,
    usage.prompt_tokens_details?.cached_tokens);
  const output = firstNumber(usage.output_tokens, usage.outputTokens, usage.completion_tokens, usage.completionTokens);
  const reasoningOutput = firstNumber(usage.reasoning_output_tokens, usage.reasoningOutputTokens,
    usage.output_tokens_details?.reasoning_tokens, usage.outputTokensDetails?.reasoningTokens,
    usage.completion_tokens_details?.reasoning_tokens);
  if ([input, cachedInput, output, reasoningOutput].every(value => value === null)) return null;
  return {
    input,
    cachedInput,
    uncachedInput: input === null || cachedInput === null ? null : Math.max(0, input - cachedInput),
    output,
    reasoningOutput,
  };
}

export function sumUsage(stages) {
  const totals = { input: null, cachedInput: null, uncachedInput: null, output: null, reasoningOutput: null };
  let completed = 0;
  let unknown = 0;
  for (const stage of stages ?? []) {
    const usage = normalizeUsage(stage?.usage);
    if (!usage) { unknown += 1; continue; }
    completed += 1;
    for (const key of Object.keys(totals)) {
      if (usage[key] !== null) totals[key] = (totals[key] ?? 0) + usage[key];
    }
  }
  return { ...totals, completed, unknown };
}

export function createEventReader(onEvent = () => {}) {
  let pending = '';
  const decoder = new StringDecoder('utf8');
  const consume = line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event;
    try { event = JSON.parse(trimmed); } catch { return; }
    onEvent(event);
  };
  return {
    push(chunk) {
      pending += Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) consume(line);
    },
    flush() {
      pending += decoder.end();
      if (pending.trim()) consume(pending);
      pending = '';
    },
  };
}

export function formatUsage(stages) {
  const usage = sumUsage(stages);
  if (!usage.completed) return `Расход токенов: нет данных (${usage.unknown} запуск(а/ов) без usage).`;
  const n = value => value === null ? 'н/д' : String(value);
  const summary = `Расход токенов (${usage.completed} заверш.): вход ${n(usage.input)} (кэш ${n(usage.cachedInput)}, без кэша ${n(usage.uncachedInput)}), выход ${n(usage.output)}, рассуждения ${n(usage.reasoningOutput)}`;
  return usage.unknown ? `${summary}; ещё ${usage.unknown} запуск(а/ов) без данных.` : `${summary}.`;
}
