import { readFile, readdir, writeFile, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const statusOf = text => text.match(/^- Статус: ([\w-]+)\s*$/m)?.[1] ?? null;
export function dependenciesOf(text) {
  const line = text.match(/^- Зависимости: (.+)$/m)?.[1];
  if (!line) return null;
  const ids = [...line.matchAll(/TASK-(\d+)/g)].map(match => Number(match[1]));
  return ids.length ? [...new Set(ids)] : /нет/i.test(line) ? [] : null;
}

export async function withTaskFilesLock(root, fn) {
  const path = join(root, '.telegram-task-files.lock');
  let handle;
  for (let attempt = 0; !handle; attempt++) {
    try { handle = await open(path, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST' || attempt >= 40) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try { await handle.writeFile(String(process.pid)); return await fn(); }
  finally { await handle.close(); await unlink(path); }
}

export async function readTasks(root) {
  const folder = join(root, 'docs/tasks');
  const files = (await readdir(folder)).filter(name => /^TASK-\d{4,}-[a-z0-9-]+\.md$/.test(name));
  return Promise.all(files.map(async name => {
    const text = await readFile(join(folder, name), 'utf8');
    return { id: Number(name.match(/^TASK-(\d+)/)[1]), path: `docs/tasks/${name}`, text,
      status: statusOf(text), dependencies: dependenciesOf(text),
      priority: text.match(/^- Приоритет: (\w+)/m)?.[1] ?? 'normal' };
  }));
}

export function selectTask(tasks, role) {
  if (!['dev', 'qa'].includes(role)) throw new Error('Роль должна быть dev или qa.');
  const byId = new Map(tasks.map(task => [task.id, task]));
  const allowed = task => role === 'qa' ? ['ready-for-qa', 'review'].includes(task.status)
    : task.status === 'ready' || (task.status === 'in-progress' && /^- Возврат QA: да\s*$/m.test(task.text));
  const priority = { critical: 0, high: 1, normal: 2, low: 3 };
  return tasks.filter(task => allowed(task) && task.dependencies !== null &&
    task.dependencies.every(id => byId.get(id)?.status === 'done'))
    .sort((a, b) => (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2) || a.id - b.id)[0] ?? null;
}

export async function setTaskStatus(root, taskPath, status, { rework = false } = {}) {
  if (!/^docs\/tasks\/TASK-\d{4,}-[a-z0-9-]+\.md$/.test(taskPath) ||
      !['ready', 'draft', 'in-progress', 'ready-for-qa', 'qa-in-progress', 'done', 'blocked', 'review'].includes(status)) throw new Error('Некорректный переход задачи.');
  return withTaskFilesLock(root, async () => {
    const path = join(root, taskPath);
    const indexPath = join(root, 'docs/tasks/INDEX.md');
    let text = await readFile(path, 'utf8');
    if (!statusOf(text)) throw new Error('В задаче нет статуса.');
    let index = await readFile(indexPath, 'utf8');
    const rows = index.split('\n');
    const matches = rows.map((row, i) => row.includes(`](${taskPath.split('/').at(-1)})`) ? i : -1).filter(i => i >= 0);
    if (matches.length !== 1) throw new Error('INDEX должен содержать одну строку задания.');
    const cells = rows[matches[0]].split('|');
    if (cells.length !== 8) throw new Error('Неполная строка INDEX.');
    cells[3] = ` ${status} `; rows[matches[0]] = cells.join('|');
    text = text.replace(/^- Статус: [\w-]+[\t \r]*$/m, `- Статус: ${status}`)
      .replace(/^- Возврат QA: да\r?\n?/m, '');
    if (rework) text = text.replace(/^- Статус: .+$/m, '$&\n- Возврат QA: да');
    await writeFile(path, text);
    await writeFile(indexPath, rows.join('\n'));
  });
}

export async function claimTask(root, role) {
  if (!['dev', 'qa'].includes(role)) throw new Error('Роль должна быть dev или qa.');
  const path = join(root, '.telegram-task-queue.lock');
  let handle;
  try { handle = await open(path, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') {
      let lock = null;
      try { lock = JSON.parse(await readFile(path, 'utf8')); } catch { /* another claim is initializing */ }
      return { status: 'busy', lock };
    }
    throw error;
  }
  const token = randomUUID();
  let claimed = false;
  try {
    const task = selectTask(await readTasks(root), role);
    if (!task) return { status: 'empty' };
    const metadata = { role, taskPath: task.path, token, claimedAt: new Date().toISOString() };
    await handle.writeFile(JSON.stringify(metadata));
    await setTaskStatus(root, task.path, role === 'dev' ? 'in-progress' : 'qa-in-progress');
    claimed = true;
    return { status: 'claimed', ...metadata };
  } finally { await handle.close(); if (!claimed) await unlink(path); }
}

export async function releaseTask(root, token) {
  const path = join(root, '.telegram-task-queue.lock');
  const lock = JSON.parse(await readFile(path, 'utf8'));
  if (!token || token !== lock.token) throw new Error('Блокировка принадлежит другому запуску.');
  await unlink(path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const [command, argument, status, flag] = process.argv.slice(2);
  try {
    let result;
    if (command === 'next') result = selectTask(await readTasks(root), argument)?.path ?? null;
    else if (command === 'claim') result = await claimTask(root, argument);
    else if (command === 'release') { await releaseTask(root, argument); result = { status: 'released' }; }
    else if (command === 'set') { await setTaskStatus(root, argument, status, { rework: flag === '--rework' }); result = { status }; }
    else throw new Error('Команды: next dev|qa; claim dev|qa; release TOKEN; set TASK_PATH STATUS [--rework]');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
