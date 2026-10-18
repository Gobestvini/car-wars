import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';

const endpoint = process.argv[2] || 'http://127.0.0.1:2577';
const clients = [];
async function until(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw Error('Timed out waiting for shared state'); await sleep(25); }
}
const attach = r => { r.onMessage('welcome', () => {}); r.onMessage('full', () => {}); clients.push(r); return r; };
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
  const a = attach(await sdk.create('driving', { protocolVersion: 1 }));
  const b = attach(await new Client(endpoint).joinById(a.roomId, { protocolVersion: 1 }));
  const c = attach(await new Client(endpoint).joinById(a.roomId, { protocolVersion: 1 }));
  await until(() => clients.every(r => r.state.actors?.size === 105));
  assert.equal(b.state.signature, a.state.signature);
  await assert.rejects(sdk.joinById(a.roomId, { protocolVersion: 1 }), /locked|full/i);
  const before = a.state.actors.get(a.sessionId).pose.slice(0, 3);
  for (let seq = 1; seq <= 20; seq++) {
    a.send('input', { roundId: 'round-1', seq, throttle: .7, steer: .2, brake: 0 });
    await sleep(34);
  }
  await until(() => clients.slice(0, 3).every(r => r.state.actors.get(a.sessionId)?.ack === 20));
  assert.notDeepEqual(a.state.actors.get(a.sessionId).pose.slice(0, 3), before);
  const identity = c.sessionId, token = c.reconnectionToken;
  c.reconnection.enabled = false; c.connection.close(4001);
  await until(() => a.state.actors.get(identity)?.connected === false);
  const resumed = attach(await sdk.reconnect(token));
  assert.equal(resumed.sessionId, identity);
  await until(() => resumed.state.actors?.size === 105);
  // The hosted service has a hard cap, including rooms created through direct SDK calls.
  const second = attach(await sdk.create('driving', { protocolVersion: 1 }));
  await assert.rejects(sdk.create('driving', { protocolVersion: 1 }), /занят|две комнаты/);
  assert.notEqual(second.roomId, a.roomId);
  console.log(JSON.stringify({ ok: true, endpoint, checks: ['3 independent clients', '102 NPC', 'same map', '4th rejected',
    'shared movement and applied input', 'reconnect preserves identity', '2-room cap', 'proxy-safe error JSON'], signature: a.state.signature }));
} finally {
  await Promise.allSettled(clients.filter(r => r.connection?.isOpen).map(r => r.leave()));
}
