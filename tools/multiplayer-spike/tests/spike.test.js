import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { SpikeWorld, STEP } from '../world.js';
import { validateInput } from '../protocol.js';
import { startServer } from '../server.js';

async function until(predicate, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out'); await sleep(20); }
}
const input = (seq, throttle = .7) => ({ roundId: 'round-1', seq, steer: 0, throttle, brake: 0 });

test('headless city colliders are deterministic and a building blocks a real CarSimulation', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const w = new SpikeWorld({ npcCount: 0, playerCount: 1 });
  const again = new SpikeWorld({ npcCount: 0 });
  assert.equal(w.signature, again.signature);
  assert.ok(w.colliders.boxes.length > 100 && w.colliders.prisms.length > 20);
  const building = w.plan.buildings.find(b => b.depth > 10);
  const a = w.players.get('scripted-0'), b = a.sim.body;
  b.position.set(building.x, 1, building.z - building.depth / 2 - 5);
  b.quaternion.setFromEuler(0,0,0); b.velocity.set(0,0,15);
  for(let i=0;i<120;i++) w.step();
  assert.ok(w.contacts > 0);
  assert.ok(b.position.z < building.z - building.depth / 2);
  assert.equal(w.steps,120); assert.ok(Math.abs(w.world.time-120 * STEP)<1e-10);
  w.dispose(); again.dispose(); assert.equal(w.world.bodies.length,0);
});

test('three cars share one solver and collide; queued input is consumed only by a tick', () => {
  const w = new SpikeWorld({ npcCount: 0, playerCount: 3 });
  const cars = [...w.players.values()];
  for(let i=0;i<3;i++) { cars[i].sim.body.position.set(i===2?15:0,1,i===0?-4:i===1?4:0);
    cars[i].sim.body.quaternion.setFromEuler(0,i===1?Math.PI:0,0);
    cars[i].sim.body.velocity.set(0,0,i===0?8:i===1?-8:0); }
  assert.equal(w.input(cars[0].id, validateInput(input(2))),true);
  assert.equal(cars[0].lastSeq,-1);
  assert.equal(w.input(cars[0].id,validateInput(input(1))),false);
  for(let i=0;i<120;i++) w.step();
  assert.equal(cars[0].lastSeq,2); assert.equal(cars[0].lastAppliedTick,1);
  assert.ok(w.contacts>0); assert.equal(w.steps,120);
  assert.equal(cars[0].control.brake,1);
  assert.throws(()=>w.addPlayer('fourth'),/full/);
  w.dispose();
});

test('real AI helpers create all requested actors, union-zone physics, finite snapshots', () => {
  const w=new SpikeWorld({npcCount:102,playerCount:3});
  const players=[...w.players.values()];
  // Place each player by a different NPC so each contributes to the union.
  for(let i=0;i<3;i++) players[i].sim.body.position.copy(w.npcs[30*i].sim.body.position);
  w.think();
  for(let i=0;i<3;i++) assert.equal(w.npcs[30*i].physical,true);
  for(let i=0;i<240;i++) w.step();
  assert.equal(w.npcs.length,102); assert.ok(w.metrics.aiMs.length>=20);
  for(const a of [...w.snapshot().players,...w.snapshot().actors]) assert.ok([...a.p,...a.q,...a.v].every(Number.isFinite));
  w.dispose();
});

test('input whitelist rejects forged authority, NaN, stale epochs and invalid ranges',()=>{
  for(const bad of [{...input(1),playerId:'victim'},{...input(1),position:[100,0,0]},
    {...input(1),throttle:NaN},{...input(1),seq:1.2},{...input(1),brake:-1},
    {...input(1),steer:Infinity},{...input(1),seq:2147483648},{...input(1),roundId:'old'}]) assert.equal(validateInput(bad),null);
  assert.ok(validateInput(input(3)));
});

test('actual Colyseus SDK: capacity, schema, input ack, late join, reserved reconnect, expiry and cleanup', async () => {
  const s = await startServer({npcCount:12,reconnectSeconds:.4});
  const sdk = new Client(`http://127.0.0.1:${s.port}`), clients=[];
  const join = async id => { const r=id?await sdk.joinById(id,{protocolVersion:1}):await sdk.create('driving',{protocolVersion:1});
    r.onMessage('welcome',()=>{});r.onMessage('full',()=>{}); clients.push(r); return r; };
  try {
    const a=await join(); a.send('input',input(1));
    await until(()=>a.state.actors?.get(a.sessionId)?.ack===1);
    const before=a.state.actors.get(a.sessionId).pose.slice(0,3);
    const b=await join(a.roomId), c=await join(a.roomId);
    await until(()=>c.state.actors?.size===15);
    assert.equal(c.state.signature,a.state.signature);assert.ok(c.state.tick>0);
    await assert.rejects(sdk.joinById(a.roomId,{protocolVersion:1}),/locked|full/i);
    const room=await matchMaker.getLocalRoomById(a.roomId);
    const ticks=room.sim.steps;
    a.send('input',{...input(5),playerId:b.sessionId});
    for(let seq=2;seq<75;seq++)a.send('input',input(seq));
    await sleep(100);
    assert.ok(room.metrics.invalidInputs>0 && room.metrics.rateLimited>0);
    assert.ok(room.sim.steps>ticks);
    assert.ok(room.metrics.wireBytes>0);
    assert.notDeepEqual(a.state.actors.get(a.sessionId).pose.slice(0,3),before);
    const token=c.reconnectionToken, identity=c.sessionId;
    c.reconnection.enabled=false; c.connection.close(4001);
    await until(()=>room.sim.players.get(identity)?.connected===false);
    await assert.rejects(sdk.joinById(a.roomId,{protocolVersion:1}),/locked|full/i);
    const resumed=await sdk.reconnect(token); clients.push(resumed);
    resumed.onMessage('welcome',()=>{});resumed.onMessage('full',()=>{});
    assert.equal(resumed.sessionId,identity);
    await until(()=>resumed.state.actors?.size===15);
    const token2=resumed.reconnectionToken;
    resumed.reconnection.enabled=false;resumed.connection.close(4001);
    await until(()=>!room.sim.players.has(identity));
    await assert.rejects(sdk.reconnect(token2));
    const d=await join(a.roomId);assert.notEqual(d.sessionId,identity);
    await d.leave();await b.leave();await a.leave();
    await until(()=>room.sim.world.bodies.length===0);
  } finally {
    for(const c of clients) if(c.connection?.isOpen) await c.leave();
    await s.close();
  }
});
