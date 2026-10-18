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
