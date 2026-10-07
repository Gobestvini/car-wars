import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile, copyFile, cp, access, symlink, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { plannerPrompt, workerPrompt, plannerSchema, workerSchema, validTaskPath } from './core.js';
import { captureBase, publishWorktree, git } from './publish.js';

const saves = new Map();
export function saveState(path, state) {
  const previous = saves.get(path) ?? Promise.resolve();
  const next = previous.catch(()=>{}).then(async () => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(tmp, path);
  });
  saves.set(path,next);
  return next.finally(()=>{ if (saves.get(path)===next) saves.delete(path); });
}

export async function loadState(path, makeState) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; const state = makeState(); await saveState(path, state); return state; }
}

export function makeTelegram(token, fetchImpl = fetch) {
  const api = `https://api.telegram.org/bot${token}`;
  async function call(method, body) {
    const response = await fetchImpl(`${api}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(method === 'getUpdates' ? 35000 : 15000) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`Telegram ${method} failed (${response.status})`);
    return data.result;
  }
  return {
    updates: (offset) => call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }),
    send: (chat_id, text) => call('sendMessage', { chat_id, text: String(text).slice(0, 4000) }),
    async image(message) {
      const file = message.photo?.at(-1); if (!file) return null;
      const info = await call('getFile', { file_id: file.file_id });
      const response = await fetchImpl(`https://api.telegram.org/file/bot${token}/${info.file_path}`, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Telegram photo download failed (${response.status})`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const ext = info.file_path.split('.').at(-1)?.replace(/[^a-z0-9]/gi, '') || 'jpg';
      const path = join(process.env.TEMP || process.env.TMP || '.', `telegram-${randomUUID()}.${ext}`);
      await writeFile(path, bytes); return path;
    },
  };
}

function runCodex({ cwd, model, prompt, schema, imagePath, env }) {
  return new Promise((resolvePromise) => {
    const schemaFile = join(cwd, `.telegram-schema-${randomUUID()}.json`);
    const resultFile = join(cwd, `.telegram-result-${randomUUID()}.json`);
    (async () => {
      await writeFile(schemaFile, JSON.stringify(schema));
      const args = ['-a','never','exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','-s','danger-full-access','-C',cwd,'-m',model,'--output-schema',schemaFile,'-o',resultFile];
      args.push('-c', `model_reasoning_effort="${model === 'gpt-6-luna' ? 'medium' : 'high'}"`);
      if (imagePath) args.splice(args.length, 0, '--image', imagePath);
      const childEnv = { ...env }; for (const key of Object.keys(childEnv)) if (/TELEGRAM|BOT_TOKEN|PAIR_CODE/i.test(key)) delete childEnv[key];
      const child = spawn('codex', args, { cwd, env: childEnv, stdio: ['pipe','ignore','pipe'], windowsHide: true });
      let stderr = ''; child.stderr.on('data', b => { stderr = (stderr + b).slice(-6000); }); child.stdin.on('error',()=>{}); child.stdin.end(prompt);
      const timer=setTimeout(()=>child.kill(),30*60*1000);
      child.on('error', error => { clearTimeout(timer); resolvePromise({ exitCode: -1, error: error.message }); });
      child.on('close', async (code) => {
        clearTimeout(timer);
        let result = null;
        try { result = JSON.parse(await readFile(resultFile, 'utf8')); } catch { /* schema output absent */ }
        await import('node:fs/promises').then(fs => Promise.all([fs.unlink(schemaFile).catch(()=>{}),fs.unlink(resultFile).catch(()=>{})]));
        resolvePromise({ exitCode: code, result, diagnostic: stderr.slice(-1200) });
      });
    })().catch(error => resolvePromise({ exitCode: -1, error: error.message }));
  });
}

export function makeAgentRunner({ root, tempRoot, env = process.env, invoke = runCodex, publish = publishWorktree, test = async (cwd) => {
  const tests=(await readdir(join(cwd,'tests'))).filter(name=>name.endsWith('.test.js')).map(name=>join(cwd,'tests',name));
  const { exitCode, diagnostic } = await new Promise(resolvePromise => {
    const child = spawn(process.execPath, ['--test',...tests], { cwd, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    let stderr=''; child.stderr.on('data',d=>stderr=(stderr+d).slice(-5000));
    child.stdout?.on('data',d=>stderr=(stderr+d).slice(-5000));
    child.on('error',error=>resolvePromise({exitCode:-1,diagnostic:error.message}));
    child.on('close',exitCode=>resolvePromise({exitCode,diagnostic:stderr.slice(-1000)}));
    const timer=setTimeout(()=>child.kill(),30*60*1000); child.on('close',()=>clearTimeout(timer));
  });
  if (exitCode) return { ok: false, detail: diagnostic || 'node tests failed' };
  const { exitCode: buildCode, diagnostic: buildDiagnostic } = await new Promise(resolvePromise => {
    const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js','build'], { cwd, windowsHide: true, stdio: ['ignore','ignore','pipe'] });
    let stderr = ''; child.stderr.on('data', d => stderr += d); child.on('error',error=>resolvePromise({exitCode:-1,diagnostic:error.message})); child.on('close', exitCode => resolvePromise({ exitCode, diagnostic: stderr.slice(-1000) }));
    const timer=setTimeout(()=>child.kill(),30*60*1000); child.on('close',()=>clearTimeout(timer));
  });
  return buildCode ? { ok: false, detail: buildDiagnostic || 'Vite build failed' } : { ok: true };
} }) {
  return async function processJob(job, state) {
    const baseline = await captureBase(root);
      const unique=`${job.id}-${randomUUID().slice(0,8)}`;
      const base = `codex/telegram-${unique}`; const folder = join(tempRoot, `telegram-${unique}`);
    await mkdir(tempRoot, { recursive: true });
    await git(root, ['worktree','add','-b',base,folder,baseline.head]);
    try {
      await copyFile(join(root,'AGENTS.md'),join(folder,'AGENTS.md')).catch(()=>{});
      await cp(join(root,'.agents'),join(folder,'.agents'),{recursive:true,force:true}).catch(()=>{});
      const modules = join(root,'node_modules'); await access(modules); await symlink(modules,join(folder,'node_modules'),'junction');
      const safeEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/TELEGRAM|BOT_TOKEN|PAIR_CODE/i.test(key)));
      const planner = await invoke({cwd:folder,model:'gpt-6.1-sol',prompt:plannerPrompt(job.text,job.imagePath),schema:plannerSchema,imagePath:job.imagePath,env:safeEnv});
      let plan = planner.result;
      if (planner.exitCode || plan?.status !== 'ready' || !validTaskPath(plan.taskPath)) return {status:'blocked',question:plan?.question ?? planner.error ?? 'Планировщик не создал корректную задачу.',branch:base,worktree:folder,taskPath:validTaskPath(plan?.taskPath) ? plan.taskPath : null};
      const taskFile = resolve(folder,plan.taskPath); if (!taskFile.startsWith(resolve(folder,'docs','tasks') + '\\') && !taskFile.startsWith(resolve(folder,'docs','tasks') + '/')) return {status:'blocked',question:'Путь задачи находится вне docs/tasks.',branch:base,worktree:folder};
      let taskText=''; try { taskText=await readFile(taskFile,'utf8'); } catch { return {status:'blocked',question:'Планировщик указал отсутствующий файл задачи.',branch:base,worktree:folder}; }
      if (!/^\s*- Статус: ready\s*$/m.test(taskText) || !taskText.includes('## 10. Отчёт исполнителя')) return {status:'blocked',question:'Задача не имеет статуса ready или секции отчёта.',branch:base,worktree:folder};
      const worker = await invoke({cwd:folder,model:'gpt-6-luna',prompt:workerPrompt(plan.taskPath),schema:workerSchema,imagePath:job.imagePath,env:safeEnv});
      let result = worker.result;
      async function verifyDone() {
        let text;
        try { text = await readFile(taskFile,'utf8'); }
        catch { return {ok:false, detail:'Исполнитель удалил файл задачи.'}; }
        const report = text.split('## 10. Отчёт исполнителя')[1];
        if (!/^\s*- Статус: done\s*$/m.test(text) || !report?.trim() || /Не выполнялась/i.test(report) || /^\s*- \[ \]/m.test(text)) return {ok:false, detail:'В файле задачи нет полного отчёта done или остались невыполненные критерии.'};
        return test(folder);
      }
      let reason;
      if (!worker.exitCode && result?.status === 'done') {
        const checks = await verifyDone();
        if (checks.ok) return { ...await publish({root,folder,branch:base,baseline,taskPath:plan.taskPath,summary:result.summary}), worktree:folder };
        reason = checks.detail;
      }
      reason ??= result?.question ?? worker.error ?? (worker.exitCode ? worker.diagnostic : 'Исполнитель сообщил о проблеме или проверки не прошли.');
      const fallback = await invoke({cwd:folder,model:'gpt-6.1-sol',prompt:`Исправь результат задачи ${plan.taskPath}. Предыдущая проблема: ${reason}. Заверши изменения, обнови отчёт и INDEX, обязательно выполни node --test tests/*.test.js и vite build. Верни done только если оба проходят. Без commit/push и без чтения секретов.`,schema:workerSchema,imagePath:job.imagePath,env:safeEnv});
      result = fallback.result;
      if (!fallback.exitCode && result?.status === 'done') {
        const checks = await verifyDone();
        if (checks.ok) return { ...await publish({root,folder,branch:base,baseline,taskPath:plan.taskPath,summary:result.summary}), worktree:folder };
        reason = checks.detail;
      }
      return {status:result?.status === 'blocked' ? 'blocked' : 'failed',question:result?.question ?? reason ?? 'Fallback завершился без успешных проверок.',branch:base,worktree:folder,taskPath:plan.taskPath};
    } finally { /* retain completed worktree and branch for review/merge */ }
  };
}

export async function updateJob(state, id, fn) { const job = state.jobs.find(item => item.id === Number(id)); if (!job) return null; return fn(job); }
