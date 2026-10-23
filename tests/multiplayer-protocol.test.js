import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInput,validateCommands } from '../tools/multiplayer-spike/protocol.js';
import { validMapReady,mapReadyMessage,JOIN_OPTIONS,ROOM_LIMITS } from '../src/multiplayer/protocol.js';
import { listenSnapshots } from '../src/multiplayer/transfers.js';
import { cadence } from '../tools/multiplayer-spike/room-clock.js';

test('session/round command whitelist rejects non-finite, foreign and stale authority',()=>{
  const p={roundId:'r',seq:5,steer:0,throttle:1,brake:0};assert.ok(validateInput(p,'r'));
  for(const extra of [{actorId:'b'},{wanted:6},{dt:100},{position:[0,0,0]},{seq:NaN},{seq:2147483648},{throttle:Infinity},{roundId:'old'}])assert.equal(validateInput({...p,...extra},'r'),null);
  const c={roundId:'r',generation:2,commands:[[1,0,1,0,0],[2,0,1,0,1]]};assert.ok(validateCommands(c,'r'));
  for(const extra of [{roundId:'old'},{actorId:'b'},{commands:[[2,0,1,0,0],[1,0,1,0,0]]},{commands:[[2,NaN,1,0,0]]},{commands:Array.from({length:25},(_,i)=>[i,0,1,0,0])}])assert.equal(validateCommands({...c,...extra},'r'),null);
});
test('deadline scheduling compensates a quantized timer and skips stalled patches without a catch-up burst',()=>{
  for(const hz of [20,60]){
    let time=0,task,calls=0;const times=[];
    const stop=cadence(hz,()=>{calls++;times.push(time);time+=2;},{now:()=>time,schedule:(fn,delay)=>{task={fn,at:Math.ceil((time+Math.max(1,delay))/15.625)*15.625};return 1;},cancel:()=>{task=null;}});
    while(task.at<10000){time=task.at;task.fn();}assert.ok(Math.abs(calls-hz*10)<=1,JSON.stringify({hz,calls}));
    time+=2000;task.fn();const after=calls;assert.ok(after<=hz*10+1);stop();assert.equal(task,null);
  }
});
test('map-ready binds nonce, round, actual signature and build; transfer rejects unbounded/out-of-order data',()=>{
  const expected={nonce:'n',roundId:'r',signature:'s',buildId:JOIN_OPTIONS.buildId,mapVersion:3};
  assert.ok(validMapReady(mapReadyMessage({...expected,snapshot:{mapSignature:'s'}}),expected));
  for(const [key,value]of Object.entries(expected))assert.equal(validMapReady({...expected,[key]:String(value)+'x'},expected),false);
  assert.equal(validMapReady({...expected,playerId:'b'},expected),false);
  const handlers={},errors=[];let dto;listenSnapshots({onMessage:(type,cb)=>handlers[type]=cb},{welcome:x=>dto=x,error:e=>errors.push(e)});
  handlers['transfer-start']({id:1,kind:'welcome',bytes:ROOM_LIMITS.transferBytes+1});assert.equal(errors.length,1);
  const data=new TextEncoder().encode('{"ok":true}');handlers['transfer-start']({id:2,kind:'welcome',bytes:data.length});
  const chunk=new Uint8Array(data.length+8),v=new DataView(chunk.buffer);v.setUint32(0,2);v.setUint32(4,1);chunk.set(data,8);
  handlers['transfer-chunk'](chunk);assert.equal(errors.length,2);assert.equal(dto,undefined);
  handlers['transfer-start']({id:3,kind:'welcome',bytes:data.length});v.setUint32(0,3);v.setUint32(4,0);handlers['transfer-chunk'](chunk);assert.deepEqual(dto,{ok:true});
});
