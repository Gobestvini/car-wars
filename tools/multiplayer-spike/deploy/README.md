# Hosted 3D multiplayer

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
wheel, damage and signal-clock state; online does not construct cannon or run AI.
Snapshots interpolate remote cars and bound local extrapolation to 80 ms. After
500 ms without new state, extrapolation stops and the client brakes/shows a warning.

Online supports shared free driving with 102 civilians, three physical players,
collisions/damage and individual respawn. Police/wanted/arrest, repair pickups and
destructible street props are still offline-only. Rendered street props/trees are
decorative in online mode. The deployed server remains the bounded research world;
this integration does not accept the full production multiplayer backlog.

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

Runtime: Node 22.23.3 on ARM64, 102 NPC per room, maximum two rooms / three players
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
```

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
  unexplained optimized Node 24 process exits. The hosted process retains those
  flags; this is not a diagnosis or production performance approval.

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
