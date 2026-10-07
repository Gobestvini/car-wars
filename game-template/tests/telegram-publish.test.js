import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { git, captureBase, publishWorktree } from '../tools/telegram/publish.js';

async function fixture(t) {
  const prefix = join(tmpdir(), 'game-template-publish-');
  const dir = await mkdtemp(prefix);
  t.after(async () => {
    if (!resolve(dir).startsWith(resolve(prefix))) throw new Error('Unsafe test cleanup path');
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = join(dir, 'root'), folder = join(dir, 'worker'), remote = join(dir, 'remote.git');
  await mkdir(root);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Telegram test']);
  await git(root, ['config', 'user.email', 'telegram-test@example.invalid']);
  await writeFile(join(root, 'AGENTS.md'), 'committed instructions\n');
  await writeFile(join(root, 'game.js'), 'before\n');
  await git(root, ['add', 'AGENTS.md', 'game.js']);
  await git(root, ['commit', '-m', 'baseline']);
  await git(root, ['init', '--bare', remote]);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['push', '-u', 'origin', 'main']);
  await writeFile(join(root, 'AGENTS.md'), 'foreign local instructions\n');
  const baseline = await captureBase(root);
  const branch = 'codex/telegram-test';
  await git(root, ['worktree', 'add', '-b', branch, folder, 'HEAD']);
  await writeFile(join(folder, 'AGENTS.md'), 'foreign local instructions\n');
  await mkdir(join(folder, '.agents'));
  await writeFile(join(folder, '.agents', 'foreign.txt'), 'do not stage');
  await writeFile(join(folder, '.telegram-result-test.json'), 'do not stage');
  await writeFile(join(folder, 'game.js'), 'after\n');
  return { root, folder, branch, baseline, remote };
}

test('publishes only worker changes and preserves foreign instructions', async t => {
  const f = await fixture(t);
  const result = await publishWorktree({ ...f, taskPath: 'docs/tasks/TASK-0050-test.md', summary: 'changed' });
  assert.equal(result.status, 'done');
  assert.equal(result.published, true);
  assert.equal(await readFile(join(f.root, 'AGENTS.md'), 'utf8'), 'foreign local instructions\n');
  assert.equal((await readFile(join(f.root, 'game.js'), 'utf8')).trim(), 'after');
  assert.equal((await git(f.root, ['show', 'HEAD:AGENTS.md'])).trim(), 'committed instructions');
  assert.equal((await git(f.root, ['show', '--format=', '--name-only', 'HEAD'])).trim(), 'game.js');
  assert.equal((await git(f.root, ['rev-parse', 'origin/main'])).trim(), result.commit);
});

test('preserves worker commit when main advances during the job', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'other.js'), 'user change');
  await git(f.root, ['add', 'other.js']);
  await git(f.root, ['commit', '-m', 'concurrent user change']);
  const head = (await git(f.root, ['rev-parse', 'HEAD'])).trim();
  const result = await publishWorktree({ ...f, taskPath: 'docs/tasks/TASK-0050-test.md' });
  assert.equal(result.status, 'blocked');
  assert.equal((await git(f.root, ['rev-parse', 'HEAD'])).trim(), head);
  assert.equal((await git(f.folder, ['show', 'HEAD:game.js'])).trim(), 'after');
});

test('preserves worker commit and local game edits without merging over them', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'game.js'), 'user unsaved change\n');
  const result = await publishWorktree({ ...f, taskPath: 'docs/tasks/TASK-0050-test.md' });
  assert.equal(result.status, 'blocked');
  assert.equal(await readFile(join(f.root, 'game.js'), 'utf8'), 'user unsaved change\n');
  assert.ok(result.commit);
});

test('push rejection retains the completed local commit', async t => {
  const f = await fixture(t);
  await git(f.root, ['remote', 'set-url', 'origin', join(f.root, 'missing-remote.git')]);
  const result = await publishWorktree({ ...f, taskPath: 'docs/tasks/TASK-0050-test.md' });
  assert.equal(result.status, 'done');
  assert.equal(result.published, false);
  assert.match(result.question, /отправка не удалась/);
  assert.equal((await git(f.root, ['rev-parse', 'HEAD'])).trim(), result.commit);
});
