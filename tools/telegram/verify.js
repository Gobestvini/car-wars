import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { git, protectedPath } from './publish.js';

export async function fingerprint(cwd) {
  const files = [...new Set((await git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0'))]
    .filter(p => p && !protectedPath(p) && !p.startsWith('docs/') && !p.endsWith('.md')).sort();
  const hash = createHash('sha256').update(`checks-v1:${process.version}:${process.env.NODE_OPTIONS ?? ''}\0`);
  for (const file of files) {
    hash.update(file + '\0');
    try { hash.update(await readFile(join(cwd, file))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('<deleted>'); }
    hash.update('\0');
  }
  // Include installed dependency versions even though node_modules is ignored.
  try { hash.update(await readFile(join(cwd, 'node_modules/.package-lock.json'))); } catch { /* absent in fixtures */ }
  return hash.digest('hex');
}

export async function matchingReceipt(cwd) {
  try {
    const receipt = JSON.parse(await readFile(join(cwd, '.telegram-checks.json'), 'utf8'));
    return receipt.version === 1 && receipt.ok === true && receipt.node === process.version &&
      receipt.tests === 0 && receipt.build === 0 && receipt.fingerprint === await fingerprint(cwd) ? receipt : null;
  } catch { return null; }
}

async function command(cwd, args, logfile) {
  let output = '';
  const code = await new Promise(resolveCode => {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const capture = chunk => { output += chunk; };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.on('error', error => { output += error.message; resolveCode(-1); });
    child.on('close', code => resolveCode(code ?? -1));
    const timer = setTimeout(() => child.kill(), 30 * 60 * 1000);
    child.on('close', () => clearTimeout(timer));
  });
  await writeFile(logfile, output);
  const failures = [...output.matchAll(/^not ok[^\n]*\n[\s\S]*?(?=^ok |^# Subtest:|$(?![\s\S]))/gm)].map(match => match[0]);
  return { code, detail: failures.length ? failures.join('\n').slice(0, 1800) : output.slice(-1800) };
}

export async function verify(cwd, { reuse = true, run = command } = {}) {
  if (reuse && await matchingReceipt(cwd)) return { ok: true, reused: true };
  const before = await fingerprint(cwd);
  const logs = join(cwd, '.telegram-check-logs'); await mkdir(logs, { recursive: true });
  const tests = (await readdir(join(cwd, 'tests'))).filter(p => p.endsWith('.test.js')).sort().map(p => join(cwd, 'tests', p));
  const test = await run(cwd, ['--test', '--test-reporter=tap', ...tests], join(logs, 'tests.log'));
  const build = test.code === 0 ? await run(cwd, ['node_modules/vite/bin/vite.js', 'build'], join(logs, 'build.log')) : { code: null };
  const after = await fingerprint(cwd);
  const ok = test.code === 0 && build.code === 0 && before === after;
  await writeFile(join(cwd, '.telegram-checks.json'), JSON.stringify({ version: 1, node: process.version,
    ok, fingerprint: after, tests: test.code, build: build.code, at: new Date().toISOString() }, null, 2));
  return { ok, reused: false, detail: ok ? undefined : before !== after ? 'Код изменился во время проверок.' : test.code !== 0 ? test.detail : build.detail };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verify(process.cwd(), { reuse: !process.argv.includes('--full') });
  console.log(result.ok ? `Тесты и сборка прошли${result.reused ? ' (результат для неизменённого кода)' : ''}.` : `Проверки не прошли: ${result.detail}`);
  console.log('Полные журналы: .telegram-check-logs/');
  process.exitCode = result.ok ? 0 : 1;
}
