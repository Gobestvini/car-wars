import { spawn } from 'node:child_process';

export function git(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Git command timed out')); }, 120_000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args[0]}: ${stderr || `exit ${code}`}`));
    });
  });
}

export const protectedPath = path => path === 'AGENTS.md' || path === '.agents' || path.startsWith('.agents/') || path.startsWith('.telegram-');

export async function assertCleanCode(root) {
  const status = await git(root, ['status', '--porcelain=v1', '-z']);
  const entries = status.split('\0').filter(Boolean);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const path = entry.slice(3);
    if (!protectedPath(path)) throw new Error(`В основном checkout есть локальные изменения: ${path}. Завершите их перед обработкой правок.`);
    if (entry.slice(0, 2).includes('R') || entry.slice(0, 2).includes('C')) {
      const original = entries[++index];
      if (!protectedPath(original ?? '')) throw new Error('В основном checkout есть локальное переименование игрового файла.');
    }
  }
}

export async function captureBase(root) {
  await assertCleanCode(root);
  const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const branch = (await git(root, ['symbolic-ref', '--short', 'HEAD'])).trim();
  return { head, branch };
}

export async function publishWorktree({ root, folder, branch, baseline, taskPath, summary }) {
  const modified = await git(folder, ['ls-files', '--modified', '--deleted', '--others', '--exclude-standard', '-z']);
  const staged = await git(folder, ['diff', '--cached', '--name-only', '-z']);
  if (staged.split('\0').filter(Boolean).some(protectedPath)) throw new Error('Агент добавил в индекс скопированные инструкции или служебные файлы. Коммит остановлен.');
  const files = [...new Set(modified.split('\0').filter(path => path && !protectedPath(path)))];
  if (files.length) await git(folder, ['add', '--', ...files]);
  const finalStaged = (await git(folder, ['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean);
  if (!finalStaged.length) throw new Error('После выполнения задачи нет изменений для коммита.');
  await git(folder, ['commit', '-m', `Apply Telegram request: ${taskPath}`]);
  const commit = (await git(folder, ['rev-parse', 'HEAD'])).trim();
  const preserved = { branch, commit, taskPath, summary };
  try {
    const current = await captureBase(root);
    if (current.head !== baseline.head || current.branch !== baseline.branch) throw new Error('Основная ветка или HEAD изменились во время выполнения.');
    await git(root, ['merge', '--ff-only', branch]);
  } catch (error) {
    return { ...preserved, status: 'blocked', published: false, question: `Коммит ${commit.slice(0, 8)} сохранён в ${branch}; перенос остановлен: ${error.message}` };
  }
  try {
    await git(root, ['push', 'origin', baseline.branch]);
    return { ...preserved, status: 'done', published: true, question: null };
  } catch (error) {
    return { ...preserved, status: 'done', published: false, question: `Коммит сохранён локально, отправка не удалась: ${error.message}` };
  }
}
