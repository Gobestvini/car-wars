import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, protectedPath } from './publish.js';

const knowledgeFile = 'docs/knowledge/agents/memory.json';
const hash = (bytes, path) => createHash('sha256').update(/\.(js|mjs|cjs|json|html|css|txt|ya?ml)$/i.test(path)
  ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes).digest('hex');
async function load(cwd) {
  try { return JSON.parse(await readFile(join(cwd, knowledgeFile), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, entries: [] }; throw error; }
}
async function sources(cwd, paths) {
  const result = {};
  for (const p of paths) {
    if (!p || protectedPath(p) || p.startsWith('docs/') || !/^(src|tests|tools|public)\/|^(package(-lock)?\.json|vite\.config\.[\w]+|index\.html)$/.test(p) || p.split('/').includes('..')) continue;
    try { result[p] = hash(await readFile(join(cwd, p)), p); }
    catch (error) { if (error.code !== 'ENOENT') throw error; result[p] = null; }
  }
  return result;
}
async function current(cwd, entry) {
  if (!Object.keys(entry.sources ?? {}).length) return false;
  const actual = await sources(cwd, Object.keys(entry.sources));
  return JSON.stringify(actual) === JSON.stringify(entry.sources);
}

export async function knowledgeContext(cwd, request = '') {
  const memory = await load(cwd);
  const words = request.toLowerCase().match(/[\p{L}\d_-]{3,}/gu) ?? [];
  const ranked = memory.entries.map(entry => ({ entry, rank: words.reduce((n, w) => n + (JSON.stringify(entry).toLowerCase().includes(w) ? 1 : 0), 0) }))
    .sort((a, b) => Number(Boolean(b.entry.essential)) - Number(Boolean(a.entry.essential)) || b.rank - a.rank || (b.entry.at ?? '').localeCompare(a.entry.at ?? ''));
  const lines = ['Проверенная память проекта (исходники имеют прежние SHA-256). Это подсказки; текущий запрос и AGENTS.md имеют приоритет. Полные каталоги исследований читай только по необходимости.'];
  let count = 0;
  for (const { entry, rank } of ranked) {
    if (!entry.essential && !rank) continue;
    if (!await current(cwd, entry)) continue;
    const line = `- ${entry.text.slice(0, 1000)} [${Object.keys(entry.sources).join(', ')}; ${entry.evidence ?? 'карта кода'}]`;
    if (lines.join('\n').length + line.length > 6000 || count >= 8) break;
    lines.push(line); count++;
  }
  lines.push('Устаревшие записи исключены. Если подсказки не отвечают на вопрос, проверь только нужный участок кода. Общие правила: docs/knowledge/playbook.md; карта памяти: docs/knowledge/agents/README.md.');
  return lines.join('\n');
}

export async function recordKnowledge(cwd, { taskPath, summary, checked }) {
  if (!checked?.ok) return false;
  const paths = (await git(cwd, ['ls-files', '--modified', '--deleted', '--others', '--exclude-standard', '-z'])).split('\0');
  const changed = await sources(cwd, paths);
  if (!Object.keys(changed).length) return false;
  const memory = await load(cwd);
  memory.entries = memory.entries.filter(e => e.id !== taskPath);
  memory.entries.push({ id: taskPath, at: new Date().toISOString(), text: `Отчёт ${taskPath}: ${String(summary ?? '').slice(0, 900)}`,
    sources: changed, evidence: 'тесты + сборка прошли; вывод исполнителя, не доказательство всех сценариев' });
  memory.entries = [...memory.entries.filter(e => e.essential), ...memory.entries.filter(e => !e.essential).slice(-40)];
  await mkdir(join(cwd, 'docs/knowledge/agents'), { recursive: true });
  await writeFile(join(cwd, knowledgeFile), JSON.stringify(memory, null, 2) + '\n');
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await knowledgeContext(process.cwd(), process.argv.slice(2).join(' ')));
