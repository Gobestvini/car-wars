import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../tools/telegram/publish.js';
import { fingerprint } from '../tools/telegram/verify.js';
import { makeAgentRunner } from '../tools/telegram/runtime.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'game-template-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  await git(root, ['init', '-b', 'main']);
  await writeFile(join(root, '.gitignore'), 'node_modules/\n');
  const nested = join(root, 'template');
  await mkdir(join(nested, 'src'), { recursive: true });
  await writeFile(join(nested, 'src/scene.js'), 'scene');
  await writeFile(join(root, 'parent.js'), 'parent');
  await git(root, ['add', '.']);
  return { root, nested };
}
test('nested template fingerprint is confined to its own files and includes pnpm manifests', async t => {
  const { root, nested } = await fixture(t);
  const before = await fingerprint(nested);
  await writeFile(join(root, 'parent.js'), 'unrelated change');
  assert.equal(await fingerprint(nested), before);
  await writeFile(join(nested, 'src/scene.js'), 'new scene');
  const changed = await fingerprint(nested);
  assert.notEqual(changed, before);
  await mkdir(join(nested, 'node_modules/.pnpm'), { recursive: true });
  await writeFile(join(nested, 'node_modules/.pnpm/lock.yaml'), 'dependency version');
  assert.notEqual(await fingerprint(nested), changed);
});
test('runner rejects a nested checkout before creating any worktree or calling models', async t => {
  const { nested } = await fixture(t);
  let invoked = false;
  const runner = makeAgentRunner({ root: nested, tempRoot: join(nested, 'worktrees'), invoke: async () => { invoked = true; } });
  await assert.rejects(() => runner({ id: 1, text: 'example' }), /отдельный Git-репозиторий/);
  assert.equal(invoked, false);
});
