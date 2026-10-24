# Независимая QA TASK-0099, 2026-10-24

Verdict: changes-requested. Основной browser runner прошёл12 сценариев; отдельный real-SDK reproducer нашёл повторное открытие старого WebSocket после cancel в reconnecting. Точные критерии/ограничения находятся в разделе11 TASK-0099.

Артефакты:
- browser-report.json + desktop-{holding,arresting,arrested}.png, portrait-{low,arrested}.png, offline-high.png.
- reconnect-cancel.json и reconnect-cancel.mjs — отдельный дефект, не входит в базовый passed browser report.
- pagehide.json и pagehide.cjs — CDP listener inventory и renderer counters после pagehide.
- checked-files.json — проверенные SHA-256 diff поверх6fe6491.
- client-test.txt —5/5 optimized Node22.
- browser.cjs — независимая адаптация browser runner с дополнительными проверками mobile arrest и memory после10 leave/join.

Из корня репозитория (PowerShell):

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:ARTIFACT_DIR='docs/knowledge/multiplayer/2026-10-24-client/qa-repeat'
& "$env:LOCALAPPDATA/carwars-netem/node22/node.exe" docs/knowledge/multiplayer/2026-10-24-client/qa/browser.cjs
& "$env:LOCALAPPDATA/carwars-netem/node22/node.exe" docs/knowledge/multiplayer/2026-10-24-client/qa/reconnect-cancel.mjs
& "$env:LOCALAPPDATA/carwars-netem/node22/node.exe" docs/knowledge/multiplayer/2026-10-24-client/qa/pagehide.cjs

```

Reproducer/pagehide сохраняют результат в qa/, browser использует ARTIFACT_DIR. Для pagehide событие синтетическое; проверка не доказывает освобождение памяти процесса ОС. Screenshot portrait-arrested получен изменением viewport уже подключённой desktop-страницы; touch joystick отдельно проверен на mobile Chrome context. Реального телефона не было. Кадры high/low визуально проверены; WAN/network budgets не измерялись.

