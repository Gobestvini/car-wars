import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { build } from 'esbuild';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DrivingSpikeRoom } from '../server.js';

// A small, bounded public preview; the production game is a separate service.
let activeRooms = 0;
const maxRooms = 2;
class HostedDrivingRoom extends DrivingSpikeRoom {
  onCreate() {
    if (activeRooms >= maxRooms) throw new Error('Сервер занят: доступны две комнаты. Попробуйте позже.');
    activeRooms++;
    this.hostedSlot = true;
    try {
      super.onCreate({ npcCount: 102, reconnectSeconds: 15, seed: 20261005, collisionFixture: false });
      this.lastRespawn = new Map();
      this.onMessage('respawn', client => {
        const actor = this.sim.players.get(client.sessionId), now = performance.now();
        if (!actor || now - (this.lastRespawn.get(client.sessionId) ?? -Infinity) < 3000) return;
        const slot = this.sim.spawnSlot();
        actor.sim.spawn = { x: slot.x, y: .96, z: slot.z, yaw: slot.heading };
        actor.sim.reset(); actor.generation++; actor.pending = null;
        actor.control = { steer: 0, throttle: 0, brake: 1 };
        this.lastRespawn.set(client.sessionId, now);
        client.send('respawned');
      });
    }
    catch (error) { this.releaseSlot(); throw error; }
  }
  welcome(client) {
    const data = super.welcome(client);
    data.map.plan = this.sim.plan;
    data.presentationVersion = 1;
    return data;
  }
  onLeave(client) { this.lastRespawn?.delete(client.sessionId); super.onLeave(client); }
  async onDrop(client) {
    await super.onDrop(client);
    if (!this.sim.players.has(client.sessionId)) this.lastRespawn?.delete(client.sessionId);
  }
  releaseSlot() { if (this.hostedSlot) { this.hostedSlot = false; activeRooms--; } }
  advance() {
    super.advance();
    for (const key of ['aiMs', 'physicalCounts']) {
      const samples = this.sim.metrics[key];
      if (samples.length > 1000) samples.splice(0, 500);
    }
  }
  onBeforePatch() {
    super.onBeforePatch();
    if (this.metrics.snapshotMs.length > 1000) this.metrics.snapshotMs.splice(0, 500);
  }
  broadcastPatch() {
    const result = super.broadcastPatch();
    if (this.metrics?.encodingMs.length > 1000) this.metrics.encodingMs.splice(0, 500);
    return result;
  }
  onDispose() {
    this.releaseSlot();
    if (this.sim) super.onDispose();
  }
}

export async function startHostedServer({ port = 2577, host = '0.0.0.0' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('client.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', minify: true });
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_, res) => res.json({ ok: true, prototype: true, transport: 'ws', activeRooms, maxRooms }));
  app.get('/client.js', (_, res) => res.type('text/javascript').send(bundle.outputFiles[0].text));
  if (process.env.GAME_STATIC_DIR) {
    app.use(express.static(process.env.GAME_STATIC_DIR, { index: false }));
    app.get('/', (req, res) => {
      if (!('online' in req.query) && !('room' in req.query) && !('offline' in req.query)) return res.redirect('?online=1');
      res.sendFile('index.html', { root: process.env.GAME_STATIC_DIR });
    });
  } else app.get('/', async (_, res) => res.type('html').send(await readFile(new URL('index.html', import.meta.url), 'utf8')));
  const httpServer = http.createServer(app);
  const transport = new WebSocketTransport({ server: httpServer, perMessageDeflate: false, maxPayload: 1024 });
  const server = new Server({ transport, greet: false, gracefullyShutdown: false });
  server.define('driving', HostedDrivingRoom);
  await server.listen(port, host);
  // Colyseus uses HTTP 52x for matchmaking failures. Cloudflare treats those as
  // origin failures and replaces the JSON body. Preserve the SDK error code in
  // JSON, but use an ordinary HTTP 400 at the public HTTP boundary.
  httpServer.prependListener('request', (req, res) => {
    if (!req.url.startsWith('/matchmake/')) return;
    const writeHead = res.writeHead;
    res.writeHead = function (code, ...args) { return writeHead.call(this, code >= 520 && code < 600 ? 400 : code, ...args); };
  });
  return { server, close: () => server.gracefullyShutdown(false) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const instance = await startHostedServer();
  console.log('CarWars multiplayer preview listening on port 2577');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await instance.close(); process.exit(0); });
}
