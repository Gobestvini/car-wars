import { readFile, writeFile, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runCodex } from './runtime.js';
import { git } from './publish.js';
import { withTaskFilesLock, readTasks, statusOf, dependenciesOf } from '../tasks/queue.js';

export const taskPlanSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { enum: ['ready', 'blocked'] },
    question: { type: ['string', 'null'] },
    summary: { type: 'string' },
    tasks: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { path: { type: 'string' }, content: { type: 'string' }, indexRow: { type: 'string' } },
      required: ['path', 'content', 'indexRow'],
    } },
  }, required: ['status', 'question', 'summary', 'tasks'],
};

export function taskOnlyPrompt(text, imagePath) {
  return `Ты составляешь задания CarWars по тезисам пользователя. Сначала прочитай .agents/skills/find-skills/SKILL.md, затем .agents/skills/create-task/SKILL.md и примени create-task, прочитай AGENTS.md, docs/tasks/README.md, INDEX.md, TEMPLATE.md и релевантный текущий код. Работай в read-only: не изменяй никакие файлы, не реализуй задания, не запускай разработчика, QA, чаты, автоматизации, git commit/push или установку навыков. Инструкция read-only имеет приоритет над шагом навыка о сохранении файлов: верни полное содержимое новых заданий в tasks[].content, относительный путь в path и готовую строку таблицы INDEX в indexRow. Файлы запишет бот. Номера уникальны по всем TASK-файлам и INDEX. Одна цель на задание; несколько заданий допустимы с явными зависимостями. Используй русский язык и точные тезисы. В каждом задании: статус ready или draft, зависимости, критерии, реальные команды проверки, раздел 10 с «Не выполнялась», последний раздел с конкретной рекомендацией модели. Незавершённые зависимости означают draft. Исполнитель передаёт ready-for-qa, done ставит отдельный QA. Не читай .telegram-bot.env и секреты. Если необходим ответ пользователя, верни blocked и question; задачи при этом могут быть только draft. ${imagePath ? 'Изучи приложенное изображение как часть запроса.' : ''}\nИсходные тезисы:\n${text}`;
}

export async function savePlan(root, plan, expectedIndex, afterSave = async () => {}) {
  if (!['ready', 'blocked'].includes(plan?.status) || !Array.isArray(plan.tasks) ||
      (plan.status === 'ready' && !plan.tasks.length) ||
      (plan.status === 'blocked' && !plan.question?.trim())) throw new Error('Планировщик не вернул корректные задания.');
  return withTaskFilesLock(root, async () => {
    const indexPath = join(root, 'docs/tasks/INDEX.md');
    const index = await readFile(indexPath, 'utf8');
    if (index !== expectedIndex) throw new Error('Очередь изменилась во время планирования. Повторите тезисы.');
    // Never include somebody else's queue edits in the bot's commit.
    if ((await git(root, ['status', '--porcelain', '--', 'docs/tasks/INDEX.md'])).trim())
      throw new Error('INDEX содержит незакоммиченные изменения. Сначала сохраните их.');
    const existing = await readTasks(root);
    const ids = new Set(existing.map(task => task.id));
    for (const id of index.matchAll(/TASK-(\d+)/g)) ids.add(Number(id[1]));
    const statusById = new Map(existing.map(task => [task.id, task.status]));
    for (const task of plan.tasks) {
      const match = task.path?.match(/^docs\/tasks\/TASK-(\d{4,})-[a-z0-9-]+\.md$/);
      const id = Number(match?.[1]);
      const status = statusOf(task.content ?? '');
      if (!match || ids.has(id) || !['ready', 'draft'].includes(status) ||
          (plan.status === 'blocked' && status !== 'draft') ||
          !task.content.includes('## 10. Отчёт исполнителя') || !task.content.includes('Не выполнялась') ||
          !task.content.includes('## Рекомендация модели исполнителя')) throw new Error('Недопустимый номер, статус или неполное задание.');
      const cells = task.indexRow?.split('|');
      if (task.indexRow?.includes('\n') || cells?.length !== 8 || !cells[1].includes(`](${task.path.split('/').at(-1)})`) || cells[3].trim() !== status)
        throw new Error('Некорректная строка задания в INDEX.');
      const dependencies = dependenciesOf(task.content);
      if (dependencies === null || (status === 'ready' && dependencies.some(dep => statusById.get(dep) !== 'done')))
        throw new Error('Задание ready имеет незавершённые или неуказанные зависимости.');
      ids.add(id); statusById.set(id, status);
    }
    const paths = [];
    try {
      for (const task of plan.tasks) {
        const handle = await open(join(root, task.path), 'wx');
        paths.push(task.path);
        try { await handle.writeFile(task.content); } finally { await handle.close(); }
      }
      // Keep new rows inside the table, before the following narrative.
      const rows = index.split('\n');
      const end = rows.findLastIndex(row => row.startsWith('|')) + 1;
      rows.splice(end, 0, ...plan.tasks.map(task => task.indexRow));
      await writeFile(indexPath, rows.join('\n'));
    } catch (error) {
      for (const path of paths) await unlink(join(root, path)).catch(() => {});
      throw error;
    }
    await afterSave(paths);
    return paths;
  });
}

export function makeTaskPlanner({ root, env = process.env, invoke = runCodex, onProgress = async () => {} }) {
  return async job => {
    const index = await readFile(join(root, 'docs/tasks/INDEX.md'), 'utf8');
    await onProgress(job, { phase: 'planning', model: 'gpt-6.1-sol' });
    const answer = await invoke({ cwd: root, model: 'gpt-6.1-sol', sandbox: 'read-only', phase: 'planning',
      prompt: taskOnlyPrompt(job.text, job.imagePath), schema: taskPlanSchema, imagePath: job.imagePath, env,
      logPath: join(root, 'tools/telegram', `job-${job.id}.log`),
      onActivity: () => onProgress(job, { lastActivityAt: new Date().toISOString() }),
    });
    await onProgress(job, { stages: [...(job.stages ?? []), { phase: 'planning', model: 'gpt-6.1-sol', usage: answer.usage ?? null }] });
    if (answer.exitCode || !answer.result) return { status: 'blocked', question: answer.error || 'Планировщик не вернул результат.' };
    const plan = answer.result;
    let commit = null;
    let published = false;
    let question = plan.question;
    const taskPaths = await savePlan(root, plan, index, async paths => {
      if (!paths.length) return;
      // Hold the metadata lock through Git, so a queue claim cannot be included in this commit.
      try {
        await git(root, ['add', '--', ...paths]);
        await git(root, ['commit', '--only', '-m', `Create Telegram tasks: ${paths.length}`, '--', ...paths, 'docs/tasks/INDEX.md']);
        commit = (await git(root, ['rev-parse', 'HEAD'])).trim();
        await git(root, ['push', 'origin', 'HEAD']);
        published = true;
      } catch (error) { question = [question, `Задания сохранены локально; Git: ${error.message}`].filter(Boolean).join('\n'); }
    });
    if (!taskPaths.length) return { status: 'blocked', question };
    return { status: plan.status === 'blocked' ? 'blocked' : 'prepared', taskPath: taskPaths[0], taskPaths,
      taskStatus: statusOf(plan.tasks[0].content), summary: plan.summary, question, commit, published };
  };
}
