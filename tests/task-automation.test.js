import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectTask, dependenciesOf, claimTask, releaseTask, setTaskStatus, readTasks } from '../tools/tasks/queue.js';
import { savePlan, makeTaskPlanner, taskOnlyPrompt } from '../tools/telegram/planner.js';

const taskPath = 'docs/tasks/TASK-0001-fixture.md';
const content = (status = 'ready', dependencies = 'нет') => `# TASK-0001\n- Статус: ${status}\n- Приоритет: normal\n- Зависимости: ${dependencies}\n## 10. Отчёт исполнителя\nНе выполнялась.\n## Рекомендация модели исполнителя\ngpt-6-luna, medium\n`;
const row = (status = 'ready') => `| [TASK-0001](TASK-0001-fixture.md) | Fixture | ${status} | normal | нет | gpt-6-luna |`;
const index = '# Очередь\n\n| ID | Название | Статус | Приоритет | Зависимости | Модель |\n| --- | --- | --- | --- | --- | --- |\n\nТекст после таблицы.\n';
const plan = () => ({ status: 'ready', question: null, summary: 'Задание создано', tasks: [{ path: taskPath, content: content(), indexRow: row() }] });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'carwars-queue-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs/tasks'), { recursive: true });
  await writeFile(join(root, 'docs/tasks/INDEX.md'), index);
  await writeFile(join(root, 'game.js'), 'original\n');
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  git('add', '.'); git('commit', '-m', 'fixture');
  return { root, git };
}

test('selection uses file statuses, priorities, done dependencies and explicit QA rework', () => {
  const tasks = [
    { id: 1, status: 'done', dependencies: [], text: '' },
    { id: 2, status: 'ready', dependencies: [1], priority: 'normal', text: '' },
    { id: 3, status: 'ready', dependencies: [2], priority: 'high', text: '' },
    { id: 4, status: 'draft', dependencies: [], priority: 'high', text: '' },
    { id: 5, status: 'in-progress', dependencies: [], priority: 'high', text: '- Возврат QA: да\n' },
    { id: 6, status: 'review', dependencies: [1], priority: 'normal', text: '' },
    { id: 7, status: 'qa-in-progress', dependencies: [], text: '' },
  ];
  assert.equal(selectTask(tasks, 'dev').id, 5);
  assert.equal(selectTask(tasks, 'qa').id, 6);
});

test('dependency metadata is required and parsed by ID', () => {
  assert.deepEqual(dependenciesOf('- Зависимости: TASK-0001 — done; TASK-0003'), [1, 3]);
  assert.deepEqual(dependenciesOf('- Зависимости: нет'), []);
  assert.equal(dependenciesOf(''), null);
  assert.equal(selectTask([{ id: 1, status: 'ready', dependencies: null }], 'dev'), null);
});

test('planner only invokes planning in read-only, commits docs and preserves dirty source', async t => {
  const { root, git } = await fixture(t);
  await writeFile(join(root, 'game.js'), 'somebody else\n');
  const calls = [];
  const result = await makeTaskPlanner({ root, invoke: async options => {
    calls.push(options); assert.equal(options.sandbox, 'read-only');
    assert.match(options.prompt, /create-task/);
    return { exitCode: 0, result: plan(), usage: { input_tokens: 10, output_tokens: 20 } };
  } })({ id: 1, text: 'Добавить тормоз', imagePath: null });
  assert.equal(calls.length, 1);
  assert.equal(result.status, 'prepared');
  assert.equal(result.published, false); // fixture has no remote
  assert.ok(result.commit);
  assert.deepEqual(git('show', '--format=', '--name-only', 'HEAD').trim().split(/\r?\n/).sort(), ['docs/tasks/INDEX.md', taskPath].sort());
  assert.equal(git('show', 'HEAD:game.js'), 'original\n');
  assert.equal(await readFile(join(root, 'game.js'), 'utf8'), 'somebody else\n');
  assert.match(await readFile(join(root, 'docs/tasks/INDEX.md'), 'utf8'), /TASK-0001[\s\S]*Текст после таблицы/);
  assert.match(taskOnlyPrompt('точные тезисы'), /точные тезисы/);
});

test('planner rejects collisions, path escapes, ready dependencies and dirty INDEX without writing', async t => {
  const { root } = await fixture(t);
  const invalid = plan(); invalid.tasks[0].path = '../game.js';
  await assert.rejects(() => savePlan(root, invalid, index), /Недопустимый/);
  const dependent = plan(); dependent.tasks[0].content = content('ready', 'TASK-9999');
  await assert.rejects(() => savePlan(root, dependent, index), /зависимости/);
  await assert.rejects(() => readFile(join(root, taskPath)), { code: 'ENOENT' });
  await writeFile(join(root, 'docs/tasks/INDEX.md'), index + 'foreign\n');
  await assert.rejects(() => savePlan(root, plan(), index), /Очередь изменилась/);
  await assert.rejects(() => savePlan(root, plan(), index + 'foreign\n'), /незакоммиченные/);
});

test('dev/QA claims exclude each other; rejection returns to dev; status and index stay aligned for CRLF', async t => {
  const { root } = await fixture(t);
  await savePlan(root, plan(), index);
  await writeFile(join(root, taskPath), content().replaceAll('\n', '\r\n'));
  const dev = await claimTask(root, 'dev');
  assert.equal(dev.status, 'claimed');
  assert.equal((await claimTask(root, 'qa')).status, 'busy');
  assert.equal((await readTasks(root))[0].status, 'in-progress');
  await assert.rejects(() => releaseTask(root, 'wrong token'), /другому/);
  await setTaskStatus(root, taskPath, 'ready-for-qa');
  await releaseTask(root, dev.token);
  const qa = await claimTask(root, 'qa');
  assert.equal(qa.status, 'claimed');
  await setTaskStatus(root, taskPath, 'in-progress', { rework: true });
  await releaseTask(root, qa.token);
  assert.equal(selectTask(await readTasks(root), 'dev').path, taskPath);
  assert.match(await readFile(join(root, 'docs/tasks/INDEX.md'), 'utf8'), /Fixture \| in-progress \|/);
  const rework = await claimTask(root, 'dev');
  assert.doesNotMatch(await readFile(join(root, taskPath), 'utf8'), /Возврат QA/);
  await releaseTask(root, rework.token);
  assert.equal((await claimTask(root, 'qa')).status, 'empty');
});

test('blocked planning preserves a draft and never starts a worker', async t => {
  const { root } = await fixture(t);
  let calls = 0;
  const draft = plan(); draft.status = 'blocked'; draft.question = 'Какой цвет?';
  draft.tasks[0].content = content('draft'); draft.tasks[0].indexRow = row('draft');
  const result = await makeTaskPlanner({ root, invoke: async () => { calls++; return { exitCode: 0, result: draft }; } })({ id: 1, text: 'Цвет' });
  assert.equal(result.status, 'blocked'); assert.equal(calls, 1);
  assert.equal((await readTasks(root))[0].status, 'draft');
});
