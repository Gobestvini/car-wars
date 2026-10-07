import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, ingest, enqueue, recover, routeMessage, plannerPrompt, workerPrompt, validTaskPath, replyToJob, nextQueuedJob, describeJob } from '../tools/telegram/core.js';

const message = (id, chatId, userId, text, type='private') => ({ message_id:id, chat:{id:chatId,type}, from:{id:userId}, text });

test('pairing accepts only a one-time code in the owner private chat', () => {
  const state=newState('ONE-TIME');
  assert.deepEqual(ingest(state,[{update_id:1,message:message(1,20,20,'/pair ONE-TIME','group')}]),[]);
  assert.equal(state.ownerId,null);
  assert.equal(ingest(state,[{update_id:2,message:message(2,21,21,'/pair WRONG')}]).length,0);
  const paired=ingest(state,[{update_id:3,message:message(3,42,42,'/pair ONE-TIME')}]);
  assert.equal(paired[0].type,'paired'); assert.equal(state.ownerId,'42'); assert.equal(state.pairCode,null);
  assert.equal(ingest(state,[{update_id:4,message:message(4,43,43,'please change game')}]).length,0);
  assert.equal(ingest(state,[{update_id:5,message:message(5,42,99,'please change game')}]).length,0);
  assert.equal(ingest(state,[{update_id:6,message:message(6,42,42,'please change game')}]).length,1);
});

test('offset and pending updates persist together; replay-safe recovery marks running jobs interrupted', () => {
  const state=newState('ABCD'); state.ownerId='7';
  const accepted=ingest(state,[{update_id:10,message:message(4,7,7,'move camera')}]);
  assert.equal(state.offset,11); assert.equal(state.pendingUpdates[0].update.update_id,10); assert.equal(accepted.length,1);
  ingest(state,[{update_id:10,message:message(4,7,7,'move camera')}]);
  assert.equal(state.pendingUpdates.length,1);
  enqueue(state,'one'); const running=enqueue(state,'two'); running.status='running';
  recover(state); assert.equal(running.status,'interrupted');
});

test('message router handles commands, replies, images and unsupported media explicitly', () => {
  assert.deepEqual(routeMessage({text:'/reply 12 Make the light blue'}),{command:'reply',id:12,text:'Make the light blue'});
  assert.equal(routeMessage({text:'/pause'}).command,'pause');
  assert.equal(routeMessage({text:'',photo:[{file_id:'x'}]}).command,'unsupported');
  assert.match(routeMessage({video:{}}).reason,/не поддерживаются/);
  assert.deepEqual(routeMessage({caption:'Add this detail',photo:[{file_id:'x'}]}),{command:'edit',text:'Add this detail',photo:{file_id:'x'}});
});

test('model prompts preserve scope and constrain task path', () => {
  const request='Исправь поворот машины. Keep wording';
  assert.ok(plannerPrompt(request).includes(request));
  assert.ok(plannerPrompt(request).includes('blocked'));
  assert.ok(workerPrompt('docs/tasks/TASK-0001.md').includes('Do not commit or push'));
  assert.equal(validTaskPath('docs/tasks/TASK-0049-thing.md'),true);
  assert.equal(validTaskPath('../TASK-0001.md'),false);
});

test('pause preserves incoming requests and replies carry original screenshot and task context', () => {
  const state = newState('CODE');
  state.paused = true;
  const original = enqueue(state,'Fix turn','image.jpg','42',10);
  assert.equal(nextQueuedJob(state),null);
  state.paused = false;
  assert.equal(nextQueuedJob(state),original);
  original.status = 'blocked';
  const next = replyToJob(state,original.id,'Only on reverse','42',11,'Prior task report');
  assert.equal(next.imagePath,'image.jpg');
  assert.equal(next.parentId,original.id);
  assert.match(next.text,/Fix turn[\s\S]*Only on reverse[\s\S]*Prior task report/);
  assert.equal(original.status,'superseded');
  assert.equal(replyToJob(state,original.id,'duplicate','42',11),null);
  assert.equal(nextQueuedJob(state),next);
  assert.equal(state.jobs.length,2);
});

test('running status identifies the actual phase, task and elapsed time', () => {
  const now=Date.parse('2026-10-07T10:30:00Z');
  const description=describeJob({id:1,status:'running',phase:'implementing',startedAt:'2026-10-07T10:23:00Z',lastActivityAt:'2026-10-07T10:29:55Z',taskPath:'docs/tasks/TASK-0050.md'},now);
  assert.match(description,/6\.0 Luna выполняет/);
  assert.match(description,/7 мин/);
  assert.match(description,/5 сек/);
  assert.match(description,/TASK-0050/);
  assert.doesNotMatch(describeJob({id:1,status:'done',phase:'implementing',startedAt:'2026-10-07T10:23:00Z'},now),/В работе|Luna/);
});
