import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer, quaternionSlerp } from '../src/multiplayer/snapshot-buffer.js';
import { validateInput } from '../tools/multiplayer-spike/protocol.js';
const actor=(x=0,generation=1)=>({id:'player',role:'player',generation,pose:[x,1,0,0,0,0,1,10,0,0,0,0,0],
  wheels:Array.from({length:28},(_,i)=>i%7===0?x:0),damage:0,ack:1,connected:true,steering:0});
const state=(tick,a)=>({tick,actors:new Map([[a.id,a]])});
test('online snapshots copy Schema values and interpolate positions and wheels',()=>{
  const buffer=new SnapshotBuffer(),a=actor();buffer.push(state(1,a),100);
  a.pose[0]=10;a.wheels[0]=10;buffer.push(state(2,a),150);
  assert.equal(buffer.frames[0].actors.get('player').pose[0],0);
  const sample=buffer.sample(215,'different-player')[0]; // target 125
  assert.equal(sample.pose[0],5);assert.equal(sample.wheels[0],5);
});
test('presentation bounds extrapolation, freezes stale state and rejects older ticks',()=>{
  const buffer=new SnapshotBuffer();buffer.push(state(10,actor()),100);buffer.push(state(9,actor(99)),110);
  assert.equal(buffer.frames.length,1);
  assert.equal(buffer.sample(400,'player')[0].pose[0],.8);
  assert.equal(buffer.sample(700,'player')[0].pose[0],.8); // hold the capped pose; never snap backwards on timeout
  for(let i=11;i<100;i++)buffer.push(state(i,actor()),i*100);
  assert.equal(buffer.frames.length,12);
});
test('respawn generations snap immediately and deleted actors do not linger',()=>{
  const buffer=new SnapshotBuffer();buffer.push(state(1,actor(0)),100);buffer.push(state(2,actor(50,2)),200);
  assert.equal(buffer.sample(210,'other')[0].pose[0],50);
  const replacement={...actor(),id:'friend'};buffer.push(state(3,replacement),300);
  assert.deepEqual(buffer.sample(320,'friend').map(a=>a.id),['friend']);
});
test('quaternions follow shortest arc, including opposite representations',()=>{
  assert.deepEqual(quaternionSlerp([0,0,0,1],[0,0,0,-1],.5),[0,0,0,1]);
  const halfway=quaternionSlerp([0,0,0,1],[0,1,0,0],.5);
  assert.ok(Math.abs(halfway[1]-Math.SQRT1_2)<1e-8);assert.ok(Math.abs(Math.hypot(...halfway)-1)<1e-8);
});
test('online handbrake extends the input whitelist without allowing authority fields',()=>{
  const input={roundId:'round-1',seq:1,steer:0,throttle:1,brake:0,handbrake:true};
  assert.equal(validateInput(input).handbrake,true);
  assert.equal(validateInput({...input,handbrake:'true'}),null);
  assert.equal(validateInput({...input,damage:0}),null);
  delete input.handbrake;assert.equal(validateInput(input).handbrake,false);
});
