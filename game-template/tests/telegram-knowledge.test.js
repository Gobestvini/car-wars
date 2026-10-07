import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../tools/telegram/publish.js';
import { knowledgeContext, recordKnowledge } from '../tools/telegram/knowledge.js';
import { verify, matchingReceipt } from '../tools/telegram/verify.js';

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'agent-memory-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, ['init']);
  for (const p of ['src', 'tests', 'docs/tasks']) await mkdir(join(cwd, p), { recursive: true });
  await writeFile(join(cwd, '.gitignore'), '.telegram-check*\n');
  await writeFile(join(cwd, 'src/traffic.js'), 'original');
  await writeFile(join(cwd, 'tests/example.test.js'), 'fixture');
  await writeFile(join(cwd, 'package.json'), '{}');
  await git(cwd, ['add', '.']);
  await writeFile(join(cwd, 'src/traffic.js'), 'changed\r\n');
  return cwd;
}

test('memory stores verified outcome, hides stale facts and does not learn failures', async t => {
  const cwd = await fixture(t);
  assert.equal(await recordKnowledge(cwd, { taskPath: 'failure', summary: 'bad', checked: { ok: false } }), false);
  await recordKnowledge(cwd, { taskPath: 'task', summary: 'Трафик ожидает поворот', checked: { ok: true } });
  assert.match(await knowledgeContext(cwd, 'Трафик'), /Трафик ожидает поворот/);
  await writeFile(join(cwd, 'src/traffic.js'), 'changed\n');
  assert.match(await knowledgeContext(cwd, 'Трафик'), /Трафик ожидает поворот/);
  await writeFile(join(cwd, 'tests/example.test.js'), 'unrelated');
  assert.match(await knowledgeContext(cwd, 'Трафик'), /Трафик ожидает поворот/);
  await writeFile(join(cwd, 'src/traffic.js'), 'new implementation');
  assert.doesNotMatch(await knowledgeContext(cwd, 'Трафик'), /Трафик ожидает поворот/);
  const memory = JSON.parse(await readFile(join(cwd, 'docs/knowledge/agents/memory.json'), 'utf8'));
  assert.equal(memory.entries.length, 1);
  assert.deepEqual(Object.keys(memory.entries[0].sources), ['src/traffic.js']);
});

test('memory context remains bounded for long reports', async t => {
  const cwd = await fixture(t);
  for (let i = 0; i < 12; i++) await recordKnowledge(cwd, { taskPath: `task-${i}`, summary: 'traffic '.repeat(2000), checked: { ok: true } });
  const context = await knowledgeContext(cwd, 'traffic');
  assert.ok(context.length < 6400);
  assert.ok(context.split('\n- ').length <= 9);
});

test('checks receipt avoids identical checks but invalidates code, test and dependency edits', async t => {
  const cwd = await fixture(t); let runs = 0;
  const run = async () => { runs++; return { code: 0 }; };
  assert.equal((await verify(cwd, { run })).ok, true);
  assert.equal(runs, 2);
  await writeFile(join(cwd, 'docs/tasks/report.md'), 'updated done report');
  assert.equal((await verify(cwd, { run })).reused, true);
  assert.equal(runs, 2);
  for (const file of ['src/traffic.js', 'tests/example.test.js', 'package.json', 'src/new.js']) {
    await writeFile(join(cwd, file), 'changed ' + file);
    assert.equal(await matchingReceipt(cwd), null);
    assert.equal((await verify(cwd, { run })).ok, true);
  }
  assert.equal(runs, 10);
});

test('failed or changing checks cannot produce a reusable success receipt', async t => {
  const cwd = await fixture(t);
  assert.equal((await verify(cwd, { run: async () => ({ code: 1, detail: 'failure' }) })).ok, false);
  assert.equal(await matchingReceipt(cwd), null);
  let calls = 0;
  const result = await verify(cwd, { run: async () => {
    if (++calls === 1) await writeFile(join(cwd, 'src/traffic.js'), 'changed during check');
    return { code: 0 };
  } });
  assert.equal(result.ok, false);
  assert.equal(await matchingReceipt(cwd), null);
});
