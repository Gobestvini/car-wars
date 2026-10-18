# Multiplayer preview on the shared White Tower VPS

Verified 2026-10-18: [deployment runbook](../../tools/multiplayer-spike/deploy/README.md),
live URL https://api.plusvibegames.com/carwars/.

- Page loads as White Tower despite correct HTTP responses → the game origin has
  a root-scoped service worker → serve the prototype from the existing separate
  API origin, with a `/carwars/` prefix stripped by Caddy. Verified by browser:
  room creation, invitation in a second tab, both players visible. This does not
  imply every unrelated origin is safe; inspect service-worker scope first.
- SDK receives Cloudflare 522 text instead of a room-full/not-found error →
  Colyseus 0.18.18 puts its own 52x codes into HTTP status → normalize only those
  matchmaking statuses to HTTP 400, preserve SDK JSON code/message. Verified
  through real Cloudflare HTTPS plus public SDK rejection checks. This is not a
  real origin timeout and should not trigger firewall/DNS changes.
- A research room becomes a long-lived public service → repeated metric samples
  and unrestricted room creation need bounds → deployed subclass caps two rooms
  and metric histories; Compose caps resources and logs. Actual ARM64 Docker tests
  (5/5), public three-client movement/reconnect/cap smoke passed. No production
  load, packet loss, mobile hardware or full Three.js gameplay acceptance claimed.
- Existing live games share Caddy → use a unique container/network alias and a
  scoped handler; validate and hot-reload rather than restart the platform. Keep
  the bind-mounted config inode when editing. White Tower's existing web/Telegram
  revision and both API health checks remained intact; container uptimes retained.
  Reapply the CarWars route installer if White Tower later replaces Caddyfile.

The prototype is separate from the production multiplayer backlog. TASK-0096 QA
limitations and the draft downstream tasks were not accepted or reopened here.

## Main Three.js client integration, 2026-10-18

- To retain the existing visual game without starting a second local simulation,
  the boot entry selects `src/multiplayer/game.js` for `online=1` / invitation links.
  It uses the existing city scene with its supported scene-only collider adapter,
  original GLB cars, lights, occlusion, camera and damage effects. Server `welcome`
  supplies `map.plan`; clients never guess a seed/road width from local defaults.
- Decoded Schema actor arrays mutate in place → copy each network frame into a
  bounded 12-frame buffer before interpolation; use shortest-arc quaternion slerp,
  snap on generation changes and cap extrapolation. Five regression tests passed.
- Root-relative deployments and GitHub Pages need the same room endpoint → fixed
  default HTTPS/WSS backend plus optional `VITE_GAME_SERVER_URL`; model/static URLs
  retain Vite's relative base. Server root redirects to online mode except explicit
  `offline=1`; otherwise the offline menu link would return to the online lobby.
- Returning a crashed car is a server command, not a client pose update → room
  chooses an unoccupied spawn, resets only that player, increments generation and
  applies a 3-second cooldown. Public SDK tests confirmed independent reset and
  cooldown; the same shared physical world retains the other two players.
- Confirmed: 40 relevant ARM64 Node 22 tests, Vite build, public ten-scenario SDK
  smoke, three-browser local/public 3D room and keyboard driving. Full broad suite
  did not finish the pre-existing exhaustive perimeter test within the test budget;
  it is not a full-suite pass. Hardware phone, packet-loss budgets and the offline
  police/pickup/prop gameplay have not been accepted for online mode.

## Correction after player report: jitter and NPC driving through houses

Verified 2026-10-18; raw results: [before](multiplayer/2026-10-18-smoothing/before-60s.json),
[after](multiplayer/2026-10-18-smoothing/after-300s.json). Earlier connection/render
acceptance missed long-lived NPC motion and effective snapshot cadence.

- Cause: `plan.landmarks` contains IDs of buildings already present in `buildings`.
  The spike treated those IDs as building objects, creating three non-finite static
  boxes. `map-contract.js` now owns finite collider descriptors, excludes duplicate
  landmark IDs and hashes the complete server plan/colliders. Browser verifies the
  SHA-256 and checks collider parity before accepting input/rendering that world.
  A test records every actual house/curb collider from `createCityScene` and compares
  it with the server contract; another rejects a tampered network map.
- Cause: far NPC were removed from cannon and advanced by a gradual yaw change plus
  straight motion; their turn radius cut through blocks. Logical NPC now advance
  along the existing junction path geometry, wait for signals/occupied junctions,
  and test their complete footprint against a shared spatial building index. Cars
  near the union of player positions remain physical. One-minute simulation checks
  confirm real movement, no house overlap and no path-boundary teleport; three
  physical players also hit an ordinary/landmark/perimeter house in one solver.
- Cause: high-frequency Schema array mutations/encoding and the research `--no-opt`
  runtime flags cost server time. Hosted motion now uses independent compact binary
  full frames (positions, normalized quaternions, velocity, damage, player wheels,
  generation and input ack); Schema retains lifecycle. Node 22.23.3 uses normal
  optimization after actual ARM64 soak. This does not diagnose the old Node 24 bug.
- Cause: extrapolation was cancelled at 500 ms by returning the old unprojected
  snapshot, visibly pulling cars backwards. The client now holds its bounded pose,
  adapts its interpolation delay, smooths small packet corrections and rejects
  extrapolation into server-map houses. It still runs no local physics or AI.
- New rooms generate a random seed on the server and send the complete plan once;
  no online `createCityPlan` call is used. Existing offline behavior is unchanged.
  Motion presentation version 2 rejects stale clients with a reload message.
  Room callbacks and asynchronous map validation are scoped to the current room;
  packets from a departed room cannot enter the new map's presentation buffer.
  A real SDK test switches through three hosted rooms and verifies map hashes and
  replacement of player identities in every retained motion frame.

Same VPS / 1.5 CPU quota / Node 22 optimized / seed 20261005 / 3 SDK players +102
NPC: old 60-second profile had 95.30 physics Hz, 5.64 patch Hz, p95 patch gap 254 ms,
12.27 dropped simulation seconds and 49 NPC IDs observed inside houses. Fixed
300-second profile: 119.996 physics Hz, 19.11 patch Hz, p95/p99 patch gap 64.42/79.73
ms, 0 dropped seconds, 0 observed NPC centres inside houses, 95.01 KiB/s per client.
Durations differ; these are server/socket observations, not a WAN-to-screen latency
or physical-phone performance measurement. The original world/traffic remained a
research implementation; this does not silently accept unrelated backlog tasks.

## Follow-up: driving responsiveness remains unaccepted

2026-10-18: the player reported that driving still feels jerky and highly delayed.
The server cadence/collision soak above did not establish responsive driving.
[Source research and code audit](multiplayer-client-prediction.md) confirm that the
online client still waits for authoritative poses and buffers its own car; it has
no local physics prediction or input replay. The recommended next architecture is
client prediction/reconciliation with server-owned results and map, plus consistent
timing for nearby collisions. This is a researched proposal, not a deployed fix or
a measured diagnosis of every source of stutter on the player's device.
