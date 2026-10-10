import { formatUsage } from './economy.js';
import { readFile, open, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { newState, ingest, recover, routeMessage, enqueue, replyToJob, nextQueuedJob, describeJob, phaseLabels } from './core.js';
import { loadState, saveState, makeTelegram } from './runtime.js';

import { makeTaskPlanner } from './planner.js';
import { statusOf } from '../tasks/queue.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = resolve(process.env.TELEGRAM_ENV_FILE || join(root,'.telegram-bot.env'));
function readEnv(source) {
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !match[1].startsWith('#')) result[match[1]] = match[2].replace(/^['"]|['"]$/g,'');
  }
  return result;
}
async function getToken() { try { return readEnv(await readFile(envPath,'utf8')).TELEGRAM_BOT_TOKEN; } catch { return undefined; } }

if (process.argv.includes('--check')) {
  const token = await getToken();
  console.log(token ? 'Telegram env: token configured.' : 'Telegram env: no token configured; add TELEGRAM_BOT_TOKEN to .telegram-bot.env.');
  process.exit(0);
}

const token = await getToken();
if (!token) { console.error('Не задан TELEGRAM_BOT_TOKEN. См. docs/TELEGRAM.md'); process.exit(2); }
const statePath = resolve(root,'.telegram-bot.state.json');
const lockPath = resolve(root,'.telegram-bot.lock');
let lock;
try {
  try {
    const oldPid = Number(await readFile(lockPath,'utf8'));
    let alive = true;
    try { process.kill(oldPid,0); } catch (error) { if(error.code === 'ESRCH') alive = false; }
    if (!alive) await unlink(lockPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  lock = await open(lockPath,'wx'); await lock.writeFile(String(process.pid));
} catch { console.error('Telegram worker уже запущен или lock-файл нельзя проверить.'); process.exit(3); }
const telegram = makeTelegram(token);
const state = recover(await loadState(statePath, () => newState(randomBytes(5).toString('hex').toUpperCase())));
await saveState(statePath,state);
if (!state.ownerId && state.pairCode) console.log(`Код привязки сохранён локально. В Telegram отправьте /pair ${state.pairCode} в личный чат этому боту.`);
const runner = makeTaskPlanner({ root,
  onProgress: async (job, progress) => {
    const previousPhase = job.phase;
    Object.assign(job,progress);
    if (progress.phase && progress.phase !== previousPhase) {
      job.phaseStartedAt = new Date().toISOString();
      console.log(`[${job.phaseStartedAt}] Запрос #${job.id}: ${phaseLabels[progress.phase] || progress.phase}`);
      if(job.chatId) job.notification = `Запрос #${job.id}: ${phaseLabels[progress.phase] || progress.phase}.${job.taskPath ? '\nЗадача: '+job.taskPath : ''}`;
    }
    await saveState(statePath,state);
  },
});
let stopping = false;
process.on('SIGINT',()=>{stopping=true;}); process.on('SIGTERM',()=>{stopping=true;});

async function describeCurrentJob(job) {
  const lines = [describeJob(job)];
  for (const path of job.taskPaths ?? (job.taskPath && !job.worktree ? [job.taskPath] : [])) {
    try { lines.push(`${path}: ${statusOf(await readFile(join(root,path),'utf8')) || 'нет статуса'}`); }
    catch { lines.push(`${path}: файл недоступен`); }
  }
  return lines.join('\n');
}
async function handleAccepted(item) {
  if (item.type === 'paired') { await telegram.send(item.chatId,'Бот привязан. Отправьте /help, чтобы посмотреть команды.'); return; }
  if (item.type === 'start') return telegram.send(item.chatId,item.paired ? 'Бот привязан. Отправьте /help, чтобы посмотреть команды.' : 'Чтобы привязать личный чат, запустите локальный Telegram listener и отправьте ему выданную в его локальном журнале команду /pair CODE.');
  const message = item.message; const parsed = routeMessage(message);
  if (parsed.command === 'help') return telegram.send(item.chatId,'Отправьте тезисы — бот создаст задания через create-task. Фото отправляйте с подписью.\n/help — команды\n/status — запросы и статусы заданий\n/tokens — расход планировщика\n/game — ссылка на игру\n/pause — приостановить создание заданий\n/resume — возобновить создание\n/reply ID ТЕКСТ — уточнить заблокированный запрос.\nБот только составляет задачи. Разработчик в Codex берёт очередь каждый час, QA — со сдвигом 15 минут.');
  if (parsed.command === 'status') return telegram.send(item.chatId,`Состояние: ${state.paused?'пауза':'работает'}\n`+(state.jobs.length ? (await Promise.all(state.jobs.slice(-12).map(describeCurrentJob))).join('\n\n') : 'Очередь пуста.'));
  if (parsed.command === 'tokens') return telegram.send(item.chatId, state.jobs.length ? state.jobs.slice(-5).map(j => `#${j.id}: ${formatUsage(j.stages)}`).join('\n\n') : 'Очередь пуста.');
  if (parsed.command === 'game') return telegram.send(item.chatId,'https://gobestvini.github.io/car-wars/');
  if (parsed.command === 'pause') { state.paused=true; await saveState(statePath,state); return telegram.send(item.chatId,'Создание заданий приостановлено. Текущее планирование завершится. Автоматизации Codex управляются отдельно.'); }
  if (parsed.command === 'resume') { state.paused=false; await saveState(statePath,state); return telegram.send(item.chatId,'Создание заданий возобновлено.'); }
  if (parsed.command === 'reply') {
    const job=state.jobs.find(j=>j.id===parsed.id && j.status==='blocked');
    if (!job) return telegram.send(item.chatId,'Не найдена заблокированная задача с таким ID.');
    if (state.jobs.some(j=>j.updateId===message.message_id)) return;
    let previousTask = '';
    if(job.taskPath) {
      try { previousTask = await readFile(join(job.worktree || root,job.taskPath),'utf8'); } catch { /* request text still available */ }
    }
    replyToJob(state,job.id,parsed.text,item.chatId,message.message_id,previousTask);
    await saveState(statePath,state); return telegram.send(item.chatId,'Уточнение сохранено. Планировщик подготовит новые задания с исходным контекстом.');
  }
  if (parsed.command === 'unsupported' || parsed.command === 'usage' || parsed.command === 'unknown') return telegram.send(item.chatId,parsed.reason || parsed.text || 'Неизвестная команда. Отправьте /help.');
  if (parsed.command === 'empty') return;
  let imagePath = null;
  try { if (parsed.photo) imagePath=await telegram.image(message); }
  catch { return telegram.send(item.chatId,'Не удалось скачать фото. Повторите сообщение, при желании только текстом.'); }
  if (state.jobs.some(j=>j.updateId===message.message_id)) return;
  const job=enqueue(state,parsed.text,imagePath,item.chatId,message.message_id);
  await saveState(statePath,state);
  await telegram.send(item.chatId,`Запрос #${job.id} сохранён и поставлен в очередь.${state.paused ? ' Обработка начнётся после /resume.' : ''}`);
}

async function pollLoop() {
  let delay=1000;
  while (!stopping) {
    try {
      const updates=await telegram.updates(state.offset);
      if (updates.length) {
        ingest(state,updates);
        // Persist raw updates and offset together; unfinished updates replay after a crash.
        await saveState(statePath,state);
      }
      await drainPending();
      for (const job of state.jobs) if (job.notification && job.chatId) {
        try { await telegram.send(job.chatId,job.notification); job.notification=null; await saveState(statePath,state); } catch { break; }
      }
      delay=1000;
    } catch (error) { console.error(`Telegram polling error: ${error.message}`); await new Promise(r=>setTimeout(r,delay)); delay=Math.min(delay*2,30000); }
  }
}

async function drainPending() {
  while (state.pendingUpdates?.length) {
    const item=state.pendingUpdates[0];
    try {
      if (item.action) await handleAccepted(item.action);
      state.pendingUpdates.shift(); await saveState(statePath,state);
    } catch (error) { console.error(`Telegram message handling failed: ${error.message}`); break; }
  }
}

async function workerLoop() {
  while (!stopping) {
    const job=nextQueuedJob(state);
    if (!job) { await new Promise(r=>setTimeout(r,700)); continue; }
    job.status='running'; job.startedAt ??= new Date().toISOString(); await saveState(statePath,state);
    try {
      const result=await runner(job,state);
      job.status=result.status;
      job.question=result.question ?? null;
      job.summary=result.summary ?? null;
      job.taskPath=result.taskPath ?? null; job.taskPaths=result.taskPaths ?? [];
      job.branch=result.branch ?? null;
      job.worktree=result.worktree ?? null;
      job.commit=result.commit ?? null;
      job.published=result.published ?? false;
      job.notification=job.chatId ? (result.status === 'prepared'
        ? `Запрос #${job.id}: задания созданы. ${result.summary || ''}\n${job.taskPaths.join('\n')}\nВыполнение — в Codex по часовой очереди, затем отдельный QA.${result.question ? '\n'+result.question : ''}`
        : `Запрос #${job.id}: ${result.status}. ${result.question || 'Проверьте локальный журнал.'}`) : null;
      await saveState(statePath,state);
      if (job.chatId) {
        try { await telegram.send(job.chatId,job.notification); job.notification=null; await saveState(statePath,state); }
        catch(error) { console.error(`Telegram notification queued for retry: ${error.message}`); }
      }
    } catch (error) {
      job.status='failed'; job.question=error.message; job.notification=job.chatId ? `Запрос #${job.id} остановлен: ${error.message}` : null; await saveState(statePath,state);
      if (job.chatId) await telegram.send(job.chatId,`Запрос #${job.id} остановлен: ${error.message}` ).catch(()=>{});
    }
  }
}

await drainPending();
await Promise.all([pollLoop(),workerLoop()]);
await lock.close(); await unlink(lockPath).catch(()=>{});
