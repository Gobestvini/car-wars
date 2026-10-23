import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { Server, Room } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { build } from 'esbuild';
import { Encoder } from '@colyseus/schema';
import { SpikeWorld, STEP } from './world.js';
import { WorldState, syncState } from './state.js';
import { validateInput } from './protocol.js';
Encoder.BUFFER_SIZE = 256 * 1024;

export class DrivingSpikeRoom extends Room {
  createWorld(options) { return new SpikeWorld(options); }
  onCreate(options = {}) {
    this.maxClients = 3;
    this.reconnectSeconds = options.reconnectSeconds ?? 15;
    this.collisionFixture = options.collisionFixture === true;
    this.sim = this.createWorld({ npcCount: options.npcCount ?? 102, seed: options.seed ?? 20261005 });
    this.state = new WorldState();
    this.patchRate = 50;
    this.metrics = { schedulerMs: [], snapshotMs: [], encodingMs: [], wireBytes: 0, payloadBytes: 0, frames: 0,
      droppedSeconds: 0, maxDebtSeconds: 0, invalidInputs: 0, rateLimited: 0, byClient: new Map() };
    this.buckets = new Map();
    this.accumulator = 0; this.lastTime = performance.now();
    syncState(this.state, this.sim.snapshot());
    if(options.registerMessages!==false){
    this.onMessage('input', (client, payload) => {
      const now = performance.now(); let bucket = this.buckets.get(client.sessionId);
      if (!bucket || now - bucket.start >= 1000) { bucket = { start: now, count: 0 }; this.buckets.set(client.sessionId, bucket); }
      if (++bucket.count > 60) { this.metrics.rateLimited++; return; }
      const input = validateInput(payload);
      if (!input || JSON.stringify(payload).length > 1024) { this.metrics.invalidInputs++; return; }
      this.sim.input(client.sessionId, input);
    });
    this.onMessage('hello', client => client.send('welcome', this.welcome(client)));
    this.onMessage('full', client => client.send('full', this.sim.snapshot()));
    this.onMessage('*', () => { this.metrics.invalidInputs++; });
    }
    this.setSimulationInterval(() => this.advance(), 1000 / 60);
  }
  welcome(client) {
    return { playerId: client.sessionId, roomId: this.roomId, protocolVersion: 1, roundId: 'round-1',
      snapshot: this.sim.snapshot(), map: { buildings: [...this.sim.plan.buildings,
        ...this.sim.plan.boundaryBuildings].map(b => [b.x,b.z,b.width,b.depth]),
      roads: this.sim.graph.directed.map(e => [e.start.x,e.start.z,e.end.x,e.end.z]) } };
  }
  onAuth(client, options) {
    if (options.protocolVersion !== 1) throw new Error('Protocol version mismatch');
    return true;
  }
  meter(client) {
    const raw = client.ref; // WebSocketClient.ref, measured before compression (disabled).
    if (raw.__spikeMeter) return;
    raw.__spikeMeter = true;
    const send = raw.send.bind(raw);
    raw.send = (data, ...args) => {
      const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
      const wire = bytes + (bytes < 126 ? 2 : bytes <= 65535 ? 4 : 10);
      this.metrics.wireBytes += wire; this.metrics.payloadBytes += bytes; this.metrics.frames++;
      this.metrics.byClient.set(client.sessionId, (this.metrics.byClient.get(client.sessionId) || 0) + wire);
      return send(data, ...args);
    };
  }
  onJoin(client) {
    this.meter(client); const actor=this.sim.addPlayer(client.sessionId);
    if(this.collisionFixture) {
      const i=this.sim.players.size-1,b=actor.sim.body;
      b.position.set(i===2?15:0,1,i===0?-4:i===1?4:0);
      b.quaternion.setFromEuler(0,i===1?Math.PI:0,0);
      b.velocity.set(0,0,i===0?8:i===1?-8:0);
    }
    syncState(this.state, this.sim.snapshot());
  }
  async onDrop(client) {
    this.sim.disconnect(client.sessionId);
    try { await this.allowReconnection(client, this.reconnectSeconds); }
    catch { this.sim.removePlayer(client.sessionId); this.buckets.delete(client.sessionId); }
  }
  onReconnect(client) {
    this.meter(client); const actor = this.sim.players.get(client.sessionId);
    if (actor) actor.connected = true;
  }
  onLeave(client) { this.sim.removePlayer(client.sessionId); this.buckets.delete(client.sessionId); }
  onBeforePatch() {
    const before=performance.now();syncState(this.state,this.sim.snapshot());
    this.state.contactCount=this.sim.contacts;
    this.metrics.snapshotMs.push(performance.now()-before);
  }
  broadcastPatch() {
    const before=performance.now();const result=super.broadcastPatch();
    if(this.metrics)this.metrics.encodingMs.push(performance.now()-before);
    return result;
  }
  advance() {
    const begin = performance.now(), seconds = (begin - this.lastTime) / 1000; this.lastTime = begin;
    const available = this.accumulator + seconds, budget = STEP * 10;
    this.metrics.maxDebtSeconds = Math.max(this.metrics.maxDebtSeconds, available);
    this.metrics.droppedSeconds += Math.max(0, available - budget);
    this.accumulator = Math.min(available, budget);
    while (this.accumulator + 1e-10 >= STEP) { this.sim.step(); this.accumulator -= STEP; }
    this.metrics.schedulerMs.push(performance.now() - begin);
    // Research runs use bounded recording, not unbounded metrics over a service lifetime.
    if (this.metrics.schedulerMs.length > 50000) this.metrics.schedulerMs.splice(0, 10000);
    if (this.sim.metrics.stepMs.length > 50000) this.sim.metrics.stepMs.splice(0, 10000);
  }
  onDispose() { this.sim.dispose(); this.buckets.clear(); }
}

export async function startServer({ port = 0, npcCount = 102, reconnectSeconds = 15, browser = false } = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const transport = new WebSocketTransport({ server: httpServer, perMessageDeflate: false, maxPayload: 1024 });
  const gameServer = new Server({ transport, greet: false, gracefullyShutdown: false });
  gameServer.define('driving', DrivingSpikeRoom, { npcCount, reconnectSeconds });
  if (browser) {
    const bundle = await build({ entryPoints: [fileURLToPath(new URL('browser-client.js', import.meta.url))],
      bundle: true, write: false, format: 'esm', platform: 'browser' });
    app.get('/client.js', (_, res) => res.type('text/javascript').send(bundle.outputFiles[0].text));
    app.get('/', async (_, res) => res.type('html').send(await readFile(new URL('browser.html', import.meta.url), 'utf8')));
  }
  app.get('/health', (_, res) => res.json({ ok: true, prototype: true }));
  await gameServer.listen(port, '127.0.0.1');
  return { gameServer, transport, port: httpServer.address().port,
    close: () => gameServer.gracefullyShutdown(false) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startServer({ port: Number(process.env.PORT || 2577), browser: true,
    npcCount: Number(process.env.NPC_COUNT || 102) });
  console.log(`Spike UI: http://127.0.0.1:${s.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await s.close(); process.exit(0); });
}
