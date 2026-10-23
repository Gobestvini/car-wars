# Hosted 3D multiplayer

Source update TASK-0098, 2026-10-23: `npm run server:start` runs this hosted
entrypoint on port2577; `npm run server:dev` watches/restarts it during local
development. Install root dependencies and `npm ci --prefix tools/multiplayer-spike`
first; use Node22.23.3, as pinned in Docker. A restart loses ephemeral rooms.
Protocol1 now requires presentation6/build `carwars-ws-6`/map3/generator `city-1`.
Update browser and server together. A loading seat has no player body until
verified `map-ready`; reconnect repeats verification. Loading20s, reconnect15s,
input1KiB/60Hz, transport4KiB/120Hz, output256KiB per socket; full snapshots use
bounded32KiB chunks. [Contract and limits](../../../docs/knowledge/multiplayer-rooms.md).
These source changes were tested locally and were not deployed to the live URL below.

Source update, 2026-10-23 (TASK-0097; deployment below was not repeated): the
hosted adapter now creates the same `src/simulation/game-world.js` as offline.
It includes 102 civilians, up to three players, three baseline/six expanded
police, personal wanted/arrest/respawn and shared repair/props. Gameplay state is
server-owned; the complete online wanted/arrest HUD is still TASK-0099. Default
three-client smoke expects 108 actors; expanded police can bring this to 111.
The historical live URL and measurements below describe the deployed October 18
preview, not verification that this source update is running there. Current
acceptance and remaining release gates: [release readiness](../../../docs/knowledge/multiplayer-release-readiness.md).

Live: **https://api.plusvibegames.com/carwars/** (2026-10-18).
The deployed root opens the main game's Three.js city, car models, lighting,
camera and damage effects in online mode. Create a room and send its invitation
link to the other two players. Each controls their own car using WASD/arrows,
Space for handbrake, or the same directional touch gesture as the offline game.
R / «Вернуть машину» safely resets only that player's car. «Пригласить» opens the
selectable invitation link and pauses only local input; other players continue.
Rooms disappear when all players leave; there is no saved progress.

The main menu also has «Играть с друзьями» on the normal static/GitHub Pages build.
`?online=1&room=ROOM_ID` joins an invitation; `?offline=1` opens the existing offline
game, including on this VPS. Optional `VITE_GAME_SERVER_URL` overrides the public
endpoint at build time. The server supplies the actual city plan and all actor,
wheel, damage and signal-clock state. The browser now runs non-authoritative cannon
prediction for its car, other players and nearby physical NPC; AI and all final
results remain on the server. Server-ticked input history supports reconciliation
and replay; its own car has no network interpolation delay. Distant NPC use a
server-tick interpolation timeline. After 500 ms without new state prediction
stops and the server's input-silence brake protects the car.

Online supports shared free driving with 102 civilians, three physical players,
collisions, body deformation, individual respawn, and destructible lamps, bins,
benches, signals and trees. Server-owned object lifecycles survive late joins and
reconnects within the room; nearby contacts are predicted locally. Debris fades
after five simulation seconds, as in offline street-prop physics. This paragraph
describes the original preview coverage; see the source update above for the
shared gameplay core. Full production multiplayer acceptance remains outstanding.

The White Tower VPS runs this as an independent Docker Compose project on the
existing `tower-edge` network. No host game port is published. Caddy strips
`/carwars/` and proxies HTTP matchmaking and WebSocket traffic to
`carwars-multiplayer:2577`. Keep the trailing slash on the browser URL.

## Build and activate on the VPS

Use a source export of a committed revision, not the shared working directory:

```sh
git archive --format=tar --output=carwars.tar HEAD package.json pnpm-lock.yaml pnpm-workspace.yaml index.html vite.config.js src public tools/multiplayer-spike
# Upload, extract to /srv/carwars/releases/RELEASE, then run there:
docker build -f tools/multiplayer-spike/deploy/Dockerfile -t carwars-preview:RELEASE .
CARWARS_RELEASE=RELEASE docker compose -f tools/multiplayer-spike/deploy/compose.yaml config --quiet
CARWARS_RELEASE=RELEASE docker compose -f tools/multiplayer-spike/deploy/compose.yaml up -d
python3 tools/multiplayer-spike/deploy/configure-caddy.py /srv/tower/checkout/server/deploy/Caddyfile
```

The installer backs up Caddyfile, preserves its inode (it is bind-mounted), validates
inside the actual Caddy container and hot-reloads. It restores the previous config
if validation/reload fails. The route lives in the deployed White Tower config;
if a future White Tower release replaces that file, rerun this installer. This
deployment does not modify White Tower source or recreate its API/payment services.
Keep the previous image/release to roll back by running Compose with its release tag.
An active room is lost whenever this preview container is recreated/restarted.

Runtime: optimized Node 22.23.3 on ARM64, 102 NPC per room, maximum two rooms / three players
per room, reconnect grace 15 seconds. Container limits: 1.5 CPU, 768 MiB RAM, 128
processes, bounded logs, read-only filesystem, non-root process and no capabilities.
Docker restarts the service after a process/host restart. Metrics retained by the
research room are bounded for this long-lived service. No extra rented resources.

## Verify

```sh
docker run --rm --entrypoint node carwars-preview:RELEASE --test tools/multiplayer-spike/tests/spike.test.js
node tools/multiplayer-spike/deploy/smoke.js https://api.plusvibegames.com/carwars
docker stats --no-stream carwars-preview-multiplayer-1
node --test tests/multiplayer-snapshot.test.js
node --test tests/multiplayer-world-safety.test.js
node --test tests/multiplayer-prediction.test.js tools/multiplayer-spike/tests/hosted-prediction.test.js
# Isolated 5-minute probe, without publishing ports or occupying public rooms:
docker run --rm --no-healthcheck --cpus=1.5 --memory=768m -e PROBE_SECONDS=300 --entrypoint node carwars-preview:RELEASE tools/multiplayer-spike/deploy/runtime-probe.js
```

The prediction transport uses presentation version 3 and binary frame version 2;
stale clients must reload. Frame fields include angular velocity, smoothed engine
throttle, server controls, applied tick and detached-wheel dynamics. Hosted Schema
contains room scalars only; complete binary frames carry actor lifecycle as well
as motion. Clients queue the latest frame and reconcile at most once per render,
so retransmission bursts do not cause repeated replay of obsolete snapshots.

The optional `&netdebug=1` URL adds a hidden `#online-diagnostics` JSON output for
read-only acceptance. It includes actual render intervals, local step count,
correction/replay counters and key-event-to-local-step time. This is not a
photodiode/input-to-display measurement and should not appear in normal UI.

For real TCP delay/loss tests, build the separate `Dockerfile.netem` from the game
image and run `prediction-netem.sh RELEASE ONE_WAY_MS LOSS_PERCENT JITTER_MS` on
the VPS. It creates a private bridge and four temporary containers (server plus
three independent SDK prediction clients), with no published ports. Only these
test containers receive NET_ADMIN; the live Compose service keeps its capabilities
removed. The test activates a collision fixture through its own in-process room,
never through a public client position command. Results stay in
`/srv/carwars/probes/carwars-predict-*`; the script removes its own containers and
network. Headless event-loop timing is separate from browser/GPU acceptance.

Release `dc4f4b0` was built and verified on ARM64 Node 22.23.3: 29 profile tests,
four 40-second real TCP netem profiles with three independent prediction clients
and 102 NPC (including 150ms / jitter / 1% loss per direction), public SDK smoke
and three public Three.js clients. Desktop browser p95 frame interval was 16.8ms;
recorded key-event-to-local-step times were 1.4–14.6ms. These are distinct from
input-to-display and from the weaker ARM headless client budgets. Full results and
rare collision correction limits: [prediction evidence](../../../docs/knowledge/multiplayer-client-prediction.md).

The smoke uses real Colyseus SDK sessions over public HTTPS/WSS. It checks a shared
map/105 actors, the fourth-player rejection, shared input acknowledgement/movement,
identity-preserving reconnection, a two-room ceiling and proxy-safe error JSON.
It also checks the authoritative city plan, per-player respawn and its rate limit.
It temporarily occupies both rooms; run when the preview is empty. Also verify the
White Tower web/Telegram build-info and `/health`, `/test/health` on its API origin.

## Confirmed pitfalls

- Do not host this under `play.plusvibegames.com`: White Tower's root-scoped offline
  service worker can serve White Tower instead of this page. Browser acceptance
  exposed this after HTTP/SDK checks had passed. The separate API origin has no
  such worker; native White Tower API paths retain their existing routing.
- Colyseus 0.18.18 emits HTTP 52x for some matchmaking failures. Cloudflare replaces
  that JSON with its own error page. The hosted entry point normalizes just those
  matchmaking HTTP statuses to 400 and retains the original SDK code/message in
  JSON. Confirmed through the Cloudflare origin before the move to the API origin.
- The existing research scripts use `--no-opt --no-concurrent-recompilation` after
  unexplained optimized Node 24 exits. The hosted Node 22 process now uses ordinary
  optimization, verified by the later ARM64 five-minute probe below. Do not apply
  the Node 24 research workaround to this runtime without measuring it.

## Acceptance, 2026-10-18

Source baseline for the first release is the committed project revision plus only
the new `deploy/` files; unrelated staged/working changes were excluded. Existing
five spike tests passed both locally and inside the actual ARM64 image. Public
SDK smoke passed. In-app browser created a room and a second tab joined via its
invitation; both displayed two players and 102 NPC on the map. Existing White Tower
web/Telegram remained at revision `efc53f8`, both API health checks returned 200 and
all three existing containers retained their uptime across Caddy hot reloads.

This validates deployment and basic shared-world behavior, not production gameplay,
packet-loss/latency budgets, physical-phone behavior or TASK-0097–0101 acceptance.
Those tasks and the existing TASK-0096 QA restrictions are unchanged.

### Main 3D integration, 2026-10-18

The same live origin now serves a built main-game client rather than the diagnostic
Canvas page. Five presentation/protocol regression tests plus five existing spike
tests passed locally. Forty relevant physics/input/map/model/network tests passed
in the actual ARM64 Node 22 image. Vite production build passed (existing Three.js
chunk-size warning). Public SDK smoke passed all ten scenarios, including respawn.
Three local and three public browser tabs joined one room and rendered the city;
keyboard driving changed only the controlled player's speed. Renderer console had
no errors in those checks. Physical-phone and portrait/touch acceptance remain
unverified: the in-app browser's viewport override did not change its actual size.

The broad root suite was attempted separately: Windows finished 357 other tests
but its existing exhaustive city-boundary test was stopped; the isolated Linux
full run also exceeded a 120-second budget in that unrelated perimeter scenario.
These are not full-suite passes. The targeted 40-test Linux run above passed.
Foreign in-progress city-boundary/traffic changes were excluded from deployment.
Native `msgpackr-extract` is explicitly unapproved in pnpm config; its JavaScript
fallback works in the browser, and image installation disables lifecycle scripts.

### Player-reported collision/cadence correction, 2026-10-18

Connection checks alone had missed two defects: numeric landmark IDs became NaN
static boxes, and far NPC moved without colliders on incorrect corner trajectories.
The authoritative map contract now validates finite descriptors and transfers its
versioned plan/colliders with SHA-256 verification before rendering. Every new room
gets a server-generated seed; `CARWARS_FIXED_SEED` is only an operator diagnostic
override. Three clients in one room receive the same plan/hash. Late join/reconnect
reuse that room's map. Old presentation clients must reload for version 2.

Full movement frames replace high-frequency Schema pose/wheel array mutations in
the hosted service; actor lifecycle remains Schema. Far NPC follow sampled road
and junction paths with full-footprint building guards, and near-player collision
continues in the common cannon world. Client interpolation adapts to packet gaps
and no longer snaps back to an older position when a network stall crosses 500 ms.

The raw before/after artifacts and precise restrictions live in
`docs/knowledge/multiplayer/2026-10-18-smoothing/`. The fixed five-minute ARM64 run
with three players and 102 NPC kept 120 Hz physics / 19.11 Hz patches, p95 gap 64.42
ms, zero dropped simulation time and zero NPC centres observed inside houses.
Output was 95.01 KiB/s per client. This is a socket/server probe, not a phone test
or WAN input-to-visible-response acceptance. Geometry corruption, rendered collider
parity, real three-player building collisions, logical NPC turns, frame codec and
stalled extrapolation have regression checks. Broad root-suite limitations above
still apply; unrelated dirty city/traffic files remain excluded from releases.

## Online gameplay parity fixes (2026-10-18)

Presentation version 4, motion frame 3, signed map version 3. See
[destruction and joystick verification](../../../docs/knowledge/multiplayer-destruction.md).
Old online pages must reload. The directional joystick now updates its knob on
pointer movement, resets to centre on a new gesture and ignores unrelated pointers.
