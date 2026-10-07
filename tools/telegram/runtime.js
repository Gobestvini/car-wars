import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile, copyFile, cp, access, symlink, appendFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { plannerPrompt, workerPrompt, plannerSchema, workerSchema, validTaskPath } from './core.js';
import { captureBase, publishWorktree, git } from './publish.js';
import { economySettings, economicalInstructions, createEventReader } from './economy.js';
import { verify } from './verify.js';
import { knowledgeContext, recordKnowledge } from './knowledge.js';

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

export function runCodex({ cwd, model, prompt, schema, imagePath, env, logPath, phase = 'planning', onActivity = () => {}, spawnImpl = spawn }) {
  return new Promise((resolvePromise) => {
    const schemaFile = join(cwd, `.telegram-schema-${randomUUID()}.json`);
    const resultFile = join(cwd, `.telegram-result-${randomUUID()}.json`);
    (async () => {
      await writeFile(schemaFile, JSON.stringify(schema));
      const args = ['-a','never','exec','--ignore-user-config','--ephemeral','--json','--skip-git-repo-check','-s','danger-full-access','-C',cwd,'-m',model,'--output-schema',schemaFile,'-o',resultFile];
      const settings = economySettings(phase);
      args.push('-c', `model_reasoning_effort="${settings.effort}"`, '-c', `tool_output_token_limit=${settings.toolOutputTokenLimit}`);
      if (imagePath) args.splice(args.length, 0, '--image', imagePath);
      const childEnv = { ...env }; for (const key of Object.keys(childEnv)) if (/TELEGRAM|BOT_TOKEN|PAIR_CODE/i.test(key)) delete childEnv[key];
      args.push('-');
      let writes = Promise.resolve();
      if (logPath) { await mkdir(dirname(logPath),{recursive:true}); await appendFile(logPath, `\n[${new Date().toISOString()}] ${model}\n`); }
      const output = bytes => {
        if (logPath) writes = writes.then(()=>appendFile(logPath,bytes)).catch(error=>console.error(`Agent log: ${error.code || 'write failed'}`));
        Promise.resolve(onActivity()).catch(error=>console.error(`Agent progress: ${error.code || 'save failed'}`));
      };
      let usage = null;
      const events = createEventReader(event => { if (event.type === 'turn.completed') usage = event.usage ?? null; });
      const child = spawnImpl('codex', args, { cwd, env: childEnv, stdio: ['pipe','pipe','pipe'], windowsHide: true });
      child.stdout.on('data', bytes => { events.push(bytes); output(bytes); });
      let stderr = ''; child.stderr.on('data', b => { stderr = (stderr + b).slice(-6000); output(b); }); child.stdin.on('error',()=>{}); child.stdin.end(prompt);
      const timer=setTimeout(()=>child.kill(),30*60*1000);
      child.on('error', error => { clearTimeout(timer); resolvePromise({ exitCode: -1, error: error.message }); });
      child.on('close', async (code) => {
        clearTimeout(timer);
        events.flush();
        await writes;
        let result = null;
        try { result = JSON.parse(await readFile(resultFile, 'utf8')); } catch { /* schema output absent */ }
        await import('node:fs/promises').then(fs => Promise.all([fs.unlink(schemaFile).catch(()=>{}),fs.unlink(resultFile).catch(()=>{})]));
        resolvePromise({ exitCode: code, result, usage, diagnostic: stderr.slice(-1200) });
      });
    })().catch(error => resolvePromise({ exitCode: -1, error: error.message }));
  });
}

export function makeAgentRunner({ root, tempRoot, env = process.env, invoke = runCodex, publish = publishWorktree, onProgress = async () => {}, test = verify }) {
  return async function processJob(job, state) {
    await onProgress(job,{phase:'preparing'});
    const baseline = await captureBase(root);
      const unique=`${job.id}-${randomUUID().slice(0,8)}`;
      const resume = Boolean(job.resumeWorktree && job.worktree && job.branch && validTaskPath(job.taskPath));
      const base = resume ? job.branch : `codex/telegram-${unique}`; const folder = resume ? resolve(job.worktree) : join(tempRoot, `telegram-${unique}`);
    if (resume && (!folder.startsWith(resolve(tempRoot) + (process.platform === 'win32' ? '\\' : '/')) || !/^codex\/telegram-[\w-]+$/.test(base))) throw new Error('Неверный рабочий каталог для продолжения запроса.');
    await mkdir(tempRoot, { recursive: true });
    if (!resume) await git(root, ['worktree','add','-b',base,folder,baseline.head]);
    else {
      if ((await git(folder,['branch','--show-current'])).trim() !== base || (await git(folder,['rev-parse','HEAD'])).trim() !== baseline.head) throw new Error('Сохранённая ветка требует согласования с текущим HEAD перед продолжением.');
    }
    const metadata = {branch:base,worktree:folder};
    let lastActivity = 0;
    const invokeModel = async (phase,model,prompt,schema) => {
      await onProgress(job,{...metadata,phase,model});
      const stage = {phase,model,usage:null};
      job.stages = [...(job.stages ?? []), stage];
      await onProgress(job,{stages:job.stages});
      const context = await knowledgeContext(folder, job.text + ' ' + (job.taskPath ?? ''));
      const answer = await invoke({cwd:folder,model,phase,prompt:prompt + '\n' + economicalInstructions(phase === 'planning' ? 'planner' : phase === 'implementing' ? 'worker' : 'helper') + '\n' + context,schema,imagePath:job.imagePath,env:safeEnv,
        logPath:join(root,'tools','telegram',`job-${job.id}.log`),
        onActivity:async()=>{ if(Date.now()-lastActivity < 5000) return; lastActivity=Date.now(); await onProgress(job,{lastActivityAt:new Date().toISOString()}); },
      });
      stage.usage = answer.usage ?? null;
      stage.finishedAt = new Date().toISOString();
      await onProgress(job,{stages:job.stages});
      return answer;
    };
    const safeEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/TELEGRAM|BOT_TOKEN|PAIR_CODE/i.test(key)));
    try {
      await copyFile(join(root,'AGENTS.md'),join(folder,'AGENTS.md')).catch(()=>{});
      await cp(join(root,'.agents'),join(folder,'.agents'),{recursive:true,force:true}).catch(()=>{});
      const modules = join(root,'node_modules'); await access(modules);
      try { await access(join(folder,'node_modules')); } catch { await symlink(modules,join(folder,'node_modules'),'junction'); }
      const planner = resume ? {exitCode:0,result:{status:'ready',taskPath:job.taskPath}} : await invokeModel('planning','gpt-6.1-sol',plannerPrompt(job.text,job.imagePath),plannerSchema);
      let plan = planner.result;
      if (planner.exitCode || plan?.status !== 'ready' || !validTaskPath(plan.taskPath)) return {status:'blocked',question:plan?.question ?? planner.error ?? 'Планировщик не создал корректную задачу.',branch:base,worktree:folder,taskPath:validTaskPath(plan?.taskPath) ? plan.taskPath : null};
      const taskFile = resolve(folder,plan.taskPath); if (!taskFile.startsWith(resolve(folder,'docs','tasks') + '\\') && !taskFile.startsWith(resolve(folder,'docs','tasks') + '/')) return {status:'blocked',question:'Путь задачи находится вне docs/tasks.',branch:base,worktree:folder};
      let taskText=''; try { taskText=await readFile(taskFile,'utf8'); } catch { return {status:'blocked',question:'Планировщик указал отсутствующий файл задачи.',branch:base,worktree:folder}; }
      if (!/^\s*- Статус: (ready|in-progress)\s*$/m.test(taskText) || !taskText.includes('## 10. Отчёт исполнителя')) return {status:'blocked',question:'Задача не имеет статуса ready/in-progress или секции отчёта.',branch:base,worktree:folder};
      await onProgress(job,{taskPath:plan.taskPath});
      const worker = await invokeModel('implementing','gpt-6-luna',workerPrompt(plan.taskPath) + (resume ? '\nThis request was deliberately paused for listener maintenance. Preserve and inspect existing uncommitted implementation; continue the same task, do not create a replacement.' : ''),workerSchema);
      let result = worker.result;
      async function verifyDone() {
        await onProgress(job,{phase:'checking',model:null});
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
        if (checks.ok) { await recordKnowledge(folder,{taskPath:plan.taskPath,summary:result.summary,checked:checks}); await onProgress(job,{phase:'publishing'}); return { ...await publish({root,folder,branch:base,baseline,taskPath:plan.taskPath,summary:result.summary}), worktree:folder }; }
        reason = checks.detail;
      }
      reason ??= result?.question ?? result?.summary ?? worker.error ?? (worker.exitCode ? worker.diagnostic : 'Исполнитель сообщил о проблеме или проверки не прошли.');
      if (/exitCode: 3221225477/.test(reason ?? '') && !/AssertionError/.test(reason)) return {status:'blocked',question:'Процесс Node аварийно завершился (0xC0000005). Полный журнал: .telegram-check-logs/tests.log. Сначала требуется устранить проблему среды; автоматический повтор через Sol остановлен для экономии токенов.',branch:base,worktree:folder,taskPath:plan.taskPath};
      const fallback = await invokeModel('helping','gpt-6.1-sol',`Исправь результат задачи ${plan.taskPath}. Предыдущая проблема: ${String(reason).slice(-1800)}. Заверши изменения, обнови отчёт и INDEX, обязательно выполни node tools/telegram/verify.js --full (полные тесты и сборка), а также остальные обязательные проверки задачи. Верни done только если оба проходят. Без commit/push и без чтения секретов.`,workerSchema);
      result = fallback.result;
      if (!fallback.exitCode && result?.status === 'done') {
        const checks = await verifyDone();
        if (checks.ok) { await recordKnowledge(folder,{taskPath:plan.taskPath,summary:result.summary,checked:checks}); await onProgress(job,{phase:'publishing'}); return { ...await publish({root,folder,branch:base,baseline,taskPath:plan.taskPath,summary:result.summary}), worktree:folder }; }
        reason = checks.detail;
      }
      return {status:result?.status === 'blocked' ? 'blocked' : 'failed',question:result?.question ?? reason ?? 'Fallback завершился без успешных проверок.',branch:base,worktree:folder,taskPath:plan.taskPath};
    } finally { /* retain completed worktree and branch for review/merge */ }
  };
}

export async function updateJob(state, id, fn) { const job = state.jobs.find(item => item.id === Number(id)); if (!job) return null; return fn(job); }
