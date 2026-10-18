import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { decodeFrame } from '../../../src/multiplayer/frame-codec.js';
import { verifyMap } from '../../../src/multiplayer/map-contract.js';

const endpoint = process.argv[2] || 'http://127.0.0.1:2577';
const clients = [];
const joinOptions={protocolVersion:1,presentationVersion:3};
async function until(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw Error('Timed out waiting for shared state'); await sleep(25); }
}
const state = r => r.motionFrame || r.state;
const attach = r => { r.onMessage('welcome', () => {}); r.onMessage('full', () => {});
  r.onMessage('frame',bytes=>{r.motionFrame=decodeFrame(bytes);}); clients.push(r); return r; };
try {
  const deadline = Date.now() + 15000;
  while (true) {
    try { assert.equal((await (await fetch(`${endpoint}/health`)).json()).ok, true); break; }
    catch (error) { if (Date.now() > deadline) throw error; await sleep(500); }
  }
  const missing = await fetch(`${endpoint}/matchmake/joinById/no-such-room`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1 }),
  });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /not found/);
  const sdk = new Client(endpoint);
  const a = attach(await sdk.create('driving', joinOptions));
  const b = attach(await new Client(endpoint).joinById(a.roomId, joinOptions));
  const c = attach(await new Client(endpoint).joinById(a.roomId, joinOptions));
  await until(() => clients.every(r => state(r).actors?.size === 105));
  assert.equal(b.state.signature, a.state.signature);
  await assert.rejects(sdk.joinById(a.roomId, joinOptions), /locked|full/i);
  const before = state(a).actors.get(a.sessionId).pose.slice(0, 3);
  for (let seq = 1; seq <= 20; seq++) {
    a.send('input', { roundId: 'round-1', seq, throttle: .7, steer: .2, brake: 0 });
    await sleep(34);
  }
  await until(() => clients.slice(0, 3).every(r => state(r).actors.get(a.sessionId)?.ack === 20));
  assert.notDeepEqual(state(a).actors.get(a.sessionId).pose.slice(0, 3), before);
  const generation = state(a).actors.get(a.sessionId).generation;
  let welcome;
  a.onMessage('welcome', data => { welcome = data; }); a.send('hello');
  await until(() => welcome);
  assert.equal(welcome.map.plan.seed, a.state.seed);
  assert.ok(welcome.map.plan.buildings.length > 100);
  await verifyMap(welcome.map,a.state.signature);
  a.onMessage('respawned', () => {}); a.send('respawn');
  await until(() => state(b).actors.get(a.sessionId).generation === generation + 1);
  assert.equal(state(b).actors.get(b.sessionId).generation, 1);
  a.send('respawn'); await sleep(150);
  assert.equal(state(a).actors.get(a.sessionId).generation, generation + 1);
  const identity = c.sessionId, token = c.reconnectionToken;
  c.reconnection.enabled = false; c.connection.close(4001);
  await until(() => state(a).actors.get(identity)?.connected === false);
  const resumed = attach(await sdk.reconnect(token));
  assert.equal(resumed.sessionId, identity);
  await until(() => state(resumed).actors?.size === 105);
  // The hosted service has a hard cap, including rooms created through direct SDK calls.
  const second = attach(await sdk.create('driving', joinOptions));
  await assert.rejects(sdk.create('driving', joinOptions), /занят|две комнаты/);
  assert.notEqual(second.roomId, a.roomId);
  console.log(JSON.stringify({ ok: true, endpoint, checks: ['3 independent clients', '102 NPC', 'same map', '4th rejected',
    'shared movement and applied input', 'reconnect preserves identity', '2-room cap', 'proxy-safe error JSON',
    'authoritative 3D map', 'individual rate-limited respawn'], signature: a.state.signature }));
} finally {
  await Promise.allSettled(clients.filter(r => r.connection?.isOpen).map(r => r.leave()));
}
