# Hosted multiplayer preview

Live: **https://api.plusvibegames.com/carwars/** (2026-10-18).
Create a room and send its invitation link to the other two players. Each browser
controls its own car with WASD/arrows or the on-screen buttons. This is the existing
authoritative physics/traffic prototype, with a Canvas map, not the production
Three.js game. Rooms disappear when all players leave; there is no saved progress.

The White Tower VPS runs this as an independent Docker Compose project on the
existing `tower-edge` network. No host game port is published. Caddy strips
`/carwars/` and proxies HTTP matchmaking and WebSocket traffic to
`carwars-multiplayer:2577`. Keep the trailing slash on the browser URL.

## Build and activate on the VPS

Use a source export of a committed revision, not the shared working directory:

```sh
git archive --format=tar --output=carwars.tar HEAD package.json src tools/multiplayer-spike
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
```

The smoke uses real Colyseus SDK sessions over public HTTPS/WSS. It checks a shared
map/105 actors, the fourth-player rejection, shared input acknowledgement/movement,
identity-preserving reconnection, a two-room ceiling and proxy-safe error JSON.
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
