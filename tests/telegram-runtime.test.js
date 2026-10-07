import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveState, loadState, makeTelegram, makeAgentRunner } from '../tools/telegram/runtime.js';
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
  const root=await temporaryRepo(t); const calls=[]; let checks=0;
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
  const runner=makeAgentRunner({root,tempRoot:join(root,'worktrees'),env:{TELEGRAM_TOKEN:'hidden'},invoke,test:async()=>({ok:++checks>1}),publish:async options=>({status:'done',taskPath:options.taskPath})});
  const result=await runner({id:3,text:'fixture request',imagePath:null});
  assert.deepEqual(calls,['gpt-6.1-sol','gpt-6-luna','gpt-6.1-sol']);
  assert.equal(result.status,'done'); assert.equal(result.taskPath,'docs/tasks/TASK-0001-fixture.md');
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
