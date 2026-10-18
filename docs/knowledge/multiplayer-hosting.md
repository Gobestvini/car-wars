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
