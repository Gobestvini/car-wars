import { randomBytes } from 'node:crypto';

export const newState = (pairCode = randomBytes(5).toString('hex').toUpperCase()) => ({
  pairCode, ownerId: null, offset: 0, paused: false, nextId: 1, jobs: [], pendingUpdates: [],
});

export function ingest(state, updates) {
  const accepted = [];
  for (const update of updates) {
    if (update.update_id < state.offset) continue;
    state.offset = update.update_id + 1;
    const message = update.message;
    if (!message) { (state.pendingUpdates ??= []).push({ update, action: null }); continue; }
    const chat = message.chat;
    const userId = message.from?.id;
    const privateChat = chat?.type === 'private' && String(chat.id) === String(userId);
    const text = message.text ?? message.caption ?? '';
    if (!privateChat || !userId) { (state.pendingUpdates ??= []).push({ update, action: null }); continue; }
    let action = null;
    if (state.ownerId === null) {
      if (text.trim() === `/pair ${state.pairCode}`) {
        state.ownerId = String(userId); state.pairCode = null;
        action = { type: 'paired', chatId: String(chat.id) };
      } else if (text.trim() === '/start') action = { type: 'start', chatId: String(chat.id), paired: false };
    } else if (String(userId) === state.ownerId) {
      action = text.trim() === '/start' ? { type: 'start', chatId: String(chat.id), paired: true } : { type: 'message', chatId: String(chat.id), message };
    }
    if (action) accepted.push(action);
    (state.pendingUpdates ??= []).push({ update, action });
  }
  return accepted;
}

export function enqueue(state, text, imagePath = null, chatId = null, updateId = null) {
  const job = { id: state.nextId++, text, imagePath, chatId, updateId, status: 'queued', question: null, createdAt: new Date().toISOString() };
  state.jobs.push(job); return job;
}

export function recover(state) {
  for (const job of state.jobs) if (job.status === 'running') { job.status = 'interrupted'; job.question = 'Процесс завершился во время этой задачи. Повторите её новым сообщением.'; }
  return state;
}

export function nextQueuedJob(state) {
  return state.paused ? null : state.jobs.find(job => job.status === 'queued');
}

export function replyToJob(state, id, text, chatId, updateId, previousTask = '') {
  if (state.jobs.some(job => job.updateId === updateId)) return null;
  const original = state.jobs.find(job => job.id === id && job.status === 'blocked');
  if (!original) return null;
  const next = enqueue(state, `${original.text}\n\nОтвет владельца на уточнение задачи #${id}: ${text}${previousTask ? '\n\nПредыдущее задание и отчёт для контекста:\n'+previousTask : ''}`, original.imagePath, chatId, updateId);
  next.parentId = id;
  original.status = 'superseded';
  return next;
}

export function routeMessage(message) {
  const body = message.text ?? message.caption ?? '';
  if (message.photo?.length && !body) return { command: 'unsupported', reason: 'Пришлите фото с текстовой подписью.' };
  if (message.voice || message.video || message.video_note || message.audio || message.document) return { command: 'unsupported', reason: 'Голос, видео и документы пока не поддерживаются; отправьте текст или фото с подписью.' };
  const trimmed = body.trim();
  if (trimmed.startsWith('/reply ')) {
    const match = trimmed.match(/^\/reply\s+(\d+)\s+([\s\S]+)$/);
    return match ? { command: 'reply', id: Number(match[1]), text: match[2] } : { command: 'usage', text: 'Формат: /reply ID текст' };
  }
  const command = trimmed.match(/^\/(help|status|game|pause|resume)(?:@\w+)?(?:\s|$)/)?.[1];
  if (command) return { command };
  if (trimmed.startsWith('/')) return { command: 'unknown' };
  if (!trimmed && !message.photo?.length) return { command: 'empty' };
  return { command: 'edit', text: trimmed, photo: message.photo?.at(-1) ?? null };
}

export function plannerPrompt(text, imagePath) {
  return `Read AGENTS.md and docs/tasks/README.md. Use find-skills and create-task. Inspect current code before defining scope. Preserve the user's exact request and language in the task. If a material detail needs clarification, return blocked with a concise question attached to this request; do not invent scope or create an unrelated task. Otherwise create a ready task in docs/tasks/TASK-*.md and register it in INDEX.md. Do not commit or push. Do not read environment secrets or .telegram-bot.env.${imagePath ? ' Inspect the attached image as part of this same request.' : ''}\nUser request:\n${text}`;
}

export function workerPrompt(taskPath) {
  return `Execute ${taskPath} completely. Read AGENTS.md and the task fully; verify current code. Use find-skills. Update task report and INDEX. Run all required checks. Do not commit or push. Do not read environment secrets or .telegram-bot.env. Return a structured done/blocked/failed result.`;
}

export const plannerSchema = { type: 'object', required: ['status','taskPath','question'], additionalProperties: false, properties: { status: { enum: ['ready','blocked'] }, taskPath: { type: 'string' }, question: { type: ['string','null'] } } };
export const workerSchema = { type: 'object', required: ['status','summary','question'], additionalProperties: false, properties: { status: { enum: ['done','blocked','failed'] }, summary: { type: 'string' }, question: { type: ['string','null'] } } };

export function validTaskPath(path) { return typeof path === 'string' && /^docs\/tasks\/TASK-[^/\\]+\.md$/.test(path); }
