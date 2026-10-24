# TASK-0099: client acceptance

Executed 2026-10-23–24 (UTC timestamps in JSON). The directory name is an artifact grouping, not a claim of a physical-device test.

- `browser-report.json`: Edge + Chrome, three independent contexts, default102 civilians and server police, LAN IPv4 server endpoint; WebGL headless Windows. Portrait390×844 is touch emulation; no physical phone was used.
- Screenshots: desktop holding/arresting/arrested, portrait low, offline high. Inspected visually after the run.
- `tests/multiplayer-client-browser.cjs`: real room factory + Vite + installed Edge/Chrome. Private operator fixtures set poses/velocities, wanted violations and stationary police; actual shared physics decides collision, pickup collection and arrest. These setters are injected in the test, never added to the public client/wire.
- Twelve recorded scenarios include shared player damage, repair race (one winner), destroyed prop before late join, no historical event playback, fourth full, independent HUD/respawn, neutral menu/free-camera/hidden input, reconnect,10 leave/join cycles, cancellation before admission and during map loading, retry and offline start.

Reproduce from repository root (PowerShell):

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:ARTIFACT_DIR='docs/knowledge/multiplayer/2026-10-24-client/repeat'
& "$env:LOCALAPPDATA/carwars-netem/node22/node.exe" tests/multiplayer-client-browser.cjs
& "$env:LOCALAPPDATA/carwars-netem/node22/node.exe" --test tests/multiplayer-client.test.js
& "$env:LOCALAPPDATA/carwars-netem/node22/node.exe" tools/verify.js --full
```

Browser checks establish the local/LAN client contract. WAN latency, target VPS capacity and final release remain0100/0101.

## Optimized Linux baseline

`linux/receipt.json`, `full-tests.txt`, `build.txt` and `container-state.json`: isolated ARM64 Node22.23.3,1.5CPU/1536MiB;433/433 tests and build passed (1104.5s and7.17s). No published ports/live service changes. Dependencies use committed pinned manifests, excluding the foreign H3 experiment. `linux-source-sha256.json` proves the then-current seven client/test files matched the export. This source preceded QA-0099-2/welcomeEpoch repair and therefore is baseline evidence, not the final-code receipt. Windows native failures are recorded in checks-summary.json without an asserted cause.

## Final current-code verification

[Final Linux export](linux-clock/README.md):437/437 tests + production build, optimized Node22.23.3;8/8 source checksums match the working tree after the startup clock repair. [Checks summary](checks-summary.json) distinguishes failed Windows runs, the old433-test Linux baseline, the436/437 failed startup-clock run and this final pass. Independent current-code browser/startup/deadline/cleanup evidence is in [qa-clock](qa-clock/README.md); its verdict is recorded in the task.
