import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveState, loadState, makeTelegram, makeAgentRunner, runCodex } from '../tools/telegram/runtime.js';
import { spawn } from 'node:child_process';
import { git } from '../tools/telegram/publish.js';

test('state writes are durable and Telegram API transport accepts an injected fake fetch', async t => {
  const folder=await mkdtemp(join(tmpdir(),'telegram-state-')); t.after(()=>rm(folder,{recursive:true,force:true}));
  const path=join(folder,'state.json');
  await saveState(path,{offset:12,jobs:[{id:1,status:'queued'}]});
  assert.equal((await loadState(path,()=>({}))).offset,12);
  const calls=[];
  const telegram=makeTelegram('never-print-this',async (url,options)=>{calls.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({ok:true,result:[]})};});
  await telegram.updates(9); await telegram.send(4,'hello');
  assert.equal(calls[0][1].offset,9); assert.equal(calls[1][1].chat_id,4);
  await assert.rejects(()=>makeTelegram('x',async()=>({ok:false,status:500,json:async()=>({ok:false})})).updates(0),/failed \(500\)/);
});

async function temporaryRepo(t) {
  const root=await mkdtemp(join(tmpdir(),'telegram-worktree-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const run=(args)=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);};
  run(['init','-b','main']); run(['config','user.email','test@example.invalid']); run(['config','user.name','Test']);
  await mkdir(join(root,'docs/tasks'),{recursive:true}); await mkdir(join(root,'tests'),{recursive:true});
  await mkdir(join(root,'node_modules'),{recursive:true});
  await writeFile(join(root,'README.md'),'fixture\n'); await writeFile(join(root,'docs/tasks/INDEX.md'),'# Index\n');
  await writeFile(join(root,'.gitignore'),'worktrees/\nnode_modules/\n');
  await writeFile(join(root,'tests/example.test.js'),"import test from 'node:test'; test('fixture',()=>{});\n");
  run(['add','.']); run(['commit','-m','fixture']);
  return root;
}

test('pipeline runs planner, Luna, then Sol fallback, and requires successful external checks', async t => {
  const root=await temporaryRepo(t); const calls=[]; let checks=0; const phases=[];
  const invoke=async options=>{
    calls.push(options.model);
    assert.equal(Object.hasOwn(options.env,'TELEGRAM_TOKEN'),false);
    if(options.model==='gpt-6.1-sol' && calls.length===1) {
      await mkdir(join(options.cwd,'docs/tasks'),{recursive:true});
      await writeFile(join(options.cwd,'docs/tasks/TASK-0001-fixture.md'),'- Статус: ready\n## 10. Отчёт исполнителя\n');
      return {exitCode:0,result:{status:'ready',taskPath:'docs/tasks/TASK-0001-fixture.md',question:null}};
    }
    await writeFile(join(options.cwd,'docs/tasks/TASK-0001-fixture.md'),'- Статус: done\n## 10. Отчёт исполнителя\nРезультат: выполнено.\n');
    return {exitCode:0,result:{status:'done',summary:'ok',question:null}};
  };
  const runner=makeAgentRunner({root,tempRoot:join(root,'worktrees'),env:{TELEGRAM_TOKEN:'hidden'},invoke,test:async()=>({ok:++checks>1}),publish:async options=>({status:'done',taskPath:options.taskPath}),onProgress:async(job,p)=>{if(p.phase)phases.push(p.phase);}});
  const result=await runner({id:3,text:'fixture request',imagePath:null});
  assert.deepEqual(calls,['gpt-6.1-sol','gpt-6-luna','gpt-6.1-sol']);
  assert.equal(result.status,'done'); assert.equal(result.taskPath,'docs/tasks/TASK-0001-fixture.md');
  assert.deepEqual(phases,['preparing','planning','implementing','checking','helping','checking','publishing']);
});

test('pipeline refuses to report done after fallback checks fail', async t => {
  const root=await temporaryRepo(t); const calls=[];
  const invoke=async options=>{
    calls.push(options.model);
    if(calls.length===1) { await mkdir(join(options.cwd,'docs/tasks'),{recursive:true}); await writeFile(join(options.cwd,'docs/tasks/TASK-0001-fixture.md'),'- Статус: ready\n## 10. Отчёт исполнителя\n'); return {exitCode:0,result:{status:'ready',taskPath:'docs/tasks/TASK-0001-fixture.md'}}; }
    await writeFile(join(options.cwd,'docs/tasks/TASK-0001-fixture.md'),'- Статус: done\n## 10. Отчёт исполнителя\nРезультат: выполнено.\n');
    return {exitCode:0,result:{status:'done',summary:'claim',question:null}};
  };
  const runner=makeAgentRunner({root,tempRoot:join(root,'worktrees'),invoke,test:async()=>({ok:false,detail:'tests failed'})});
  const result=await runner({id:4,text:'fixture',imagePath:null});
  assert.equal(result.status,'failed'); assert.equal(calls.length,3);
});

test('complete pipeline commits and pushes the task after verification', async t => {
  const root=await temporaryRepo(t);
  const remote=join(root,'worktrees','remote.git');
  await mkdir(join(root,'worktrees'));
  await git(root,['init','--bare',remote]);
  await git(root,['remote','add','origin',remote]);
  const calls=[];
  const invoke=async options=>{
    calls.push(options.model);
    const taskPath='docs/tasks/TASK-0001-fixture.md';
    if(calls.length===1) {
      await writeFile(join(options.cwd,taskPath),'- Статус: ready\n## 10. Отчёт исполнителя\nНе выполнялась\n');
      return {exitCode:0,result:{status:'ready',taskPath,question:null}};
    }
    await writeFile(join(options.cwd,taskPath),'- Статус: done\n- [x] verified\n## 10. Отчёт исполнителя\nРезультат: выполнено.\n');
    await writeFile(join(options.cwd,'README.md'),'requested change\n');
    return {exitCode:0,result:{status:'done',summary:'implemented',question:null}};
  };
  const result=await makeAgentRunner({root,tempRoot:join(root,'worktrees'),invoke,test:async()=>({ok:true})})({id:1,text:'actual pipeline'});
  assert.deepEqual(calls,['gpt-6.1-sol','gpt-6-luna']);
  assert.equal(result.published,true);
  assert.equal((await git(root,['rev-parse','origin/main'])).trim(),result.commit);
  assert.equal((await readFile(join(root,'README.md'),'utf8')).trim(),'requested change');
});

test('schema done without completed task report cannot publish', async t => {
  const root=await temporaryRepo(t); let calls=0, publications=0;
  const invoke=async options=>{
    if(++calls===1) {
      await writeFile(join(options.cwd,'docs/tasks/TASK-0001-fixture.md'),'- Статус: ready\n## 10. Отчёт исполнителя\nНе выполнялась\n');
      return {exitCode:0,result:{status:'ready',taskPath:'docs/tasks/TASK-0001-fixture.md'}};
    }
    return {exitCode:0,result:{status:'done',summary:'unverified claim'}};
  };
  const result=await makeAgentRunner({root,tempRoot:join(root,'worktrees'),invoke,test:async()=>({ok:true}),publish:async()=>{publications++;}})({id:1,text:'fixture'});
  assert.equal(result.status,'failed');
  assert.equal(publications,0);
  assert.equal(calls,3);
});

test('blocked planner retains its draft and never starts implementation', async t => {
  const root=await temporaryRepo(t); let calls=0;
  const taskPath='docs/tasks/TASK-0001-fixture.md';
  const invoke=async options=>{
    calls++;
    await writeFile(join(options.cwd,taskPath),'- Статус: draft\nНужна информация\n');
    return {exitCode:0,result:{status:'blocked',taskPath,question:'Какой поворот?'}};
  };
  const result=await makeAgentRunner({root,tempRoot:join(root,'worktrees'),invoke,test:async()=>{throw new Error('should not check');}})({id:1,text:'fixture'});
  assert.equal(result.status,'blocked');
  assert.equal(result.taskPath,taskPath);
  assert.equal(calls,1);
  assert.match(await readFile(join(result.worktree,taskPath),'utf8'),/draft/);
});

test('Codex runner streams both outputs to a log and reports activity before completion', async t => {
  const root=await temporaryRepo(t);
  const script=join(root,'fake-agent.cjs');
  await writeFile(script,"const fs=require('fs');let p='';process.stdin.on('data',d=>p+=d);process.stdin.on('end',()=>{console.log('tool started');console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:80,output_tokens:20}}));console.error('diagnostic');fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({ok:true}));});");
  const logPath=join(root,'agent.log');let activities=0;
  const result=await runCodex({cwd:root,model:'gpt-6-luna',prompt:'test',schema:{type:'object'},env:process.env,logPath,onActivity:()=>activities++,spawnImpl:(_cmd,args,options)=>{
    assert.equal(args.at(-1),'-');assert.ok(args.includes('--json'));
    assert.ok(args.includes('tool_output_token_limit=2000'));
    assert.ok(args.includes('model_reasoning_effort="medium"'));
    return spawn(process.execPath,[script,...args],options);
  }});
  assert.equal(result.exitCode,0);
  assert.equal(result.result.ok,true);
  assert.deepEqual(result.usage,{input_tokens:100,cached_input_tokens:80,output_tokens:20});
  assert.ok(activities>=2);
  assert.match(await readFile(logPath,'utf8'),/gpt-6-luna[\s\S]*tool started/);
  assert.match(await readFile(logPath,'utf8'),/diagnostic/);
});

test('deliberately resumed request preserves its worktree and does not create another task', async t => {
  const root=await temporaryRepo(t);const folder=join(root,'worktrees','telegram-1-resume');
  const branch='codex/telegram-1-resume';await git(root,['worktree','add','-b',branch,folder,'HEAD']);
  const taskPath='docs/tasks/TASK-0001-fixture.md';
  await writeFile(join(folder,taskPath),'- Статус: in-progress\n## 10. Отчёт исполнителя\nНачата реализация\n');
  await writeFile(join(folder,'README.md'),'partial implementation\n');
  const models=[];
  const runner=makeAgentRunner({root,tempRoot:join(root,'worktrees'),invoke:async options=>{
    models.push(options.model);assert.equal(options.cwd,folder);assert.match(await readFile(join(folder,'README.md'),'utf8'),/partial implementation/);
    await writeFile(join(folder,taskPath),'- Статус: done\n## 10. Отчёт исполнителя\nВыполнено\n');
    return {exitCode:0,result:{status:'done',summary:'continued'}};
  },test:async()=>({ok:true}),publish:async()=>({status:'done'})});
  const result=await runner({id:1,text:'same request',resumeWorktree:true,worktree:folder,branch,taskPath});
  assert.equal(result.status,'done');assert.deepEqual(models,['gpt-6-luna']);
});
