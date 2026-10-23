import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import express from 'express';
import { build } from 'esbuild';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { hostedRoomType } from '../hosted-room.js';
import { ROOM_LIMITS } from '../../../src/multiplayer/protocol.js';

export async function startHostedServer({ port = 2577, host = '0.0.0.0', maxRooms=2, roomOptions={} } = {}) {
  const admission={rooms:new Set(),maxRooms};
  const app = express();
  app.disable('x-powered-by');
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('client.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', minify: true });
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_, res) => res.json({ ok: true, prototype: true, transport: 'ws', mapVersion:3,motionVersion:6,activeRooms:admission.rooms.size,maxRooms }));
  app.get('/client.js', (_, res) => res.type('text/javascript').send(bundle.outputFiles[0].text));
  if (process.env.GAME_STATIC_DIR) {
    app.use(express.static(process.env.GAME_STATIC_DIR, { index: false }));
    app.get('/', (req, res) => {
      if (!('online' in req.query) && !('room' in req.query) && !('offline' in req.query)) return res.redirect('?online=1');
      res.sendFile('index.html', { root: process.env.GAME_STATIC_DIR });
    });
  } else app.get('/', async (_, res) => res.type('html').send(await readFile(new URL('index.html', import.meta.url), 'utf8')));
  const httpServer = http.createServer(app);
  const transport = new WebSocketTransport({ server: httpServer, perMessageDeflate: false, maxPayload: ROOM_LIMITS.transportBytes });
  const server = new Server({ transport, greet: false, gracefullyShutdown: false });
  server.define('driving', hostedRoomType(admission,roomOptions));
  await server.listen(port, host);
  // Colyseus uses HTTP 52x for matchmaking failures. Cloudflare treats those as
  // origin failures and replaces the JSON body. Preserve the SDK error code in
  // JSON, but use an ordinary HTTP 400 at the public HTTP boundary.
  httpServer.prependListener('request', (req, res) => {
    if (!req.url.startsWith('/matchmake/')) return;
    const writeHead = res.writeHead;
    res.writeHead = function (code, ...args) { return writeHead.call(this, code >= 520 && code < 600 ? 400 : code, ...args); };
  });
  let closing;return {server,rooms:admission.rooms,close:()=>closing??=server.gracefullyShutdown(false)};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const instance = await startHostedServer();
  console.log('CarWars multiplayer preview listening on port 2577');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await instance.close(); process.exit(0); });
}
