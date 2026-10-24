# TASK-0099 — пятая независимая приёмка, 2026-10-24

Проверка отдельного QA-подагента поверх HEAD `3a2d2536c5a89bc60f80fb6bd84030122d58a4d2`. Реализация не менялась; commit/push не выполнялись. Восемь исходных SHA-256 совпали с переданным `.git/task0099-clock-sha256.txt`; запись — `checked-files.json`. Предыдущие QA-артефакты не перезаписывались.

**Verdict: passed, done.** Все критерии и обязательные сценарии подтверждены новым независимым прогоном. Финальные `frozen-source.json` и Linux `source-match.json` подтверждают8/8 совпавших SHA-256. Предыдущие замечания QA-0099-1–5 закрыты, новых дефектов не выявлено.

## Среда и воспроизведение

Windows x64, optimized Node **22.23.3**, `NODE_OPTIONS` отсутствует, без affinity/no-opt. Edge **155.0.4283.62** и Chrome **155.0.8059.85**, headless WebGL. Браузеры работают на полной CPU-маске. LAN IPv4, три isolated contexts, 1440×900/high и 390×844/touch/low. Физический телефон, WAN и performance budgets не проверялись; два независимых браузера соответствуют разрешённой LAN-матрице задания.

Из корня проекта, PowerShell:

```powershell
$qaDir='docs/knowledge/multiplayer/2026-10-24-client/qa-clock'
$node22='C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe'
$env:PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:ARTIFACT_DIR=$qaDir
& $node22 --test tests/multiplayer-client.test.js tests/multiplayer-snapshot.test.js tests/multiplayer-prediction.test.js
& $node22 --test tests/multiplayer-room.test.js tools/multiplayer-spike/tests/hosted-room.test.js
& $node22 node_modules/vite/bin/vite.js build
& $node22 "$qaDir/startup-clock.mjs"
& $node22 "$qaDir/startup-clock-expiry.mjs"
& $node22 "$qaDir/browser.cjs"
& $node22 "$qaDir/label-rejoin.cjs"
& $node22 "$qaDir/pagehide.cjs"
& $node22 "$qaDir/stale-error-retry.cjs"
& $node22 "$qaDir/stale-error-retry.mjs"
& $node22 "$qaDir/reconnect-cancel.mjs"
& $node22 "$qaDir/offline.cjs"
```

Runner-копии взяты из `qa-accept` и направлены в новую директорию. Browser fixtures через Vite добавляют только read/debug-ссылку на closures; product source не подменяется. Standalone startup-clock — прежнее независимое real-SDK воспроизведение QA-0099-5; второй вариант изменяет только fixture presentation delay, чтобы проверить продолжающееся действие loading timeout. Все команды запускались с stdout/stderr в одноимённые durable `.txt`; коды — `*-exit.json` и `additional-exits.json`. Нативных падений и повторов с fallback controller в этом прогоне не было.

## Фактические результаты

- **23/23 client/snapshot/prediction**, exit0: cancellation, late admission, pending map/retry, stale old error с paused TCP leave, два drop во время async welcome, labels churn, cold create с готовностью2500ms/deadline1600ms/presentation250ms; DTO/generation/isolation/input whitelist/events и разрешённый prediction.
- **6/6 room/hosted**, exit0: root room5 плюс отдельный hosted1. Проверены map-ready/version/full/seat race/timeout, authority/epochs/durable state, malformed/overflow, reconnect reservation/fault isolation/empty-room cleanup, slow reader/shutdown и три смены реальных комнат. Логи `room-hosted.txt` и `room-hosted.stderr.txt`.
- **Самостоятельный production build**, exit0, Vite1.97s. `build.txt`, `build.stderr.txt`, `build-exit.json`. Единственное предупреждение — стандартное сообщение о chunk больше500kB; errors отсутствуют.
- **QA-0099-5 закрыт адресно:** `startup-clock.json`: forced map-ready3000ms, deadline1800ms, presentation500ms; create3174.305ms, clock age после create0ms/при beginLoad9ms, connected=true/playing, loadingTimeouts0, eject отсутствует, defect=false. Старый repro на прежнем source давал eject через5.879ms; старый результат сохранён в `qa-accept`.
- **Deadline действует:** `startup-clock-expiry.json`: тот же cold startup, presentation2200ms; eject4004 через1792.113ms после beginLoad при deadline1800ms, loadingTimeouts1, connected=false, defect=false. Погрешность менее одного cadence tick; async initialization больше не начисляется новому таймеру. Exit0 здесь означает завершение диагностического сценария; ожидаемый результат — отказ слишком медленному клиенту.
- **16/16 expanded browser cases**, exit0/errors=[]: общая signature/invite; independent keyboard/touch с server-applied input; player-player/player-AI collision и damage; общий repair с одним winner; durable destroyed prop и detached wheel late join без historical effects;12 signal approaches на3clients в одно authoritative time; fourth full; персональные wanted/holding/arresting/arrested/respawn; menu/free camera/hidden neutral при растущем server tick; reconnect/fullstate;10leave/join; UI cancel reconnect/admission/map-loading и retry; offline load. `browser-report.json`, `browser.txt`, `browser-exit.json`.
- **10leave/join:** после каждого leave models0/transfers=null/listeners=null/scene children3; renderer стабильно11geometry/12texture. Это Three.js counters, не измерение памяти ОС.
- **Labels3→2→3:** survivor остаётся «Друг2», replacement получает «Друг1»; реальные CanvasTexture backgrounds RGB201/244/156 и157/223/255, local255/226/156. `label-rejoin.json`, defect=false/errors=[].
- **CONNECTING cancel и pagehide:** transport0→CLOSED3, open=false/reconnecting=false/buffer0/idle через1800ms; fresh create успешен. Synthetic pagehide очистил canvas/document listeners и игровые window resize/keydown/keyup/blur, models/city/prediction/timers; renderer56/13→1/1, errors=[]. `pagehide.json`.
- **Stale old async error/leave и scheduled reconnect:** Node и Edge сохраняют новую roomId/playing/ready/active, defect=false; отложенный retry старой комнаты через1800ms не открывает transport/serverConnected=false. JSON и stdout хранятся отдельно.
- **Offline без доступного game server:** отдельный Vite, endpoint127.0.0.1:1, обычный PLAY, tick5→188, game-server requests0/errors0. `offline.json`, `offline-playing-high.png`.
- Визуально просмотрены `portrait-low.png`, `portrait-arrested.png`, `desktop-arrested.png`, `label-rejoin.png`, `offline-playing-high.png`. Баннер ареста x8..218 и toolbar x257..382 не перекрываются, restart внутри390×844; low/high сохраняют текущие модели/город/HUD.

Source review подтверждает: authoritative GameWorld/AI/wanted/arrest/repair FSM остаются на сервере, browser prediction разрешён актуальной постановкой; HUD выбирает local sessionId, respawn — server command. Connection/welcome epochs проверяются после await; retireRoom обезвреживает старый SDK retry; final leave снимает transfers/signals/timers и очищает presentation. Labels выделяются после удаления stale visuals. Inherited timers выключаются до await map ready, clock/physics accumulator и собственная cadence стартуют после готовности Hosted state/metrics. ClockTimer передаёт Delayed общий deltaTime; текущий clock.start устраняет cold initialization debt.

## Финальный gate

Ведущий запустил действующий `node tools/verify.js --full` на optimized Linux ARM64 Node22.23.3 в существующем изолированном контейнере; QA самостоятельно прочитал его сырые журналы, квитанцию, состояние контейнера и хэши после завершения. **437/437 passed,0failed/skipped/cancelled,1171.702s; build passed8.95s; exit0/OOMKilled=false**. [Квитанция](../linux-clock/receipt.json): ok=true/tests0/build0, at2026-10-24T09:19:38.417Z, fingerprint`0a82af2478bedee603455499d8aa11ee8374da9b3287e911cde06e48d95479c2`. [Suite](../linux-clock/full-tests.txt), [build](../linux-clock/build.txt), [verifier](../linux-clock/verifier.txt), [container](../linux-clock/container-state.json), [source8/8](../linux-clock/source-match.json).

Контейнер: cpuset0, availableParallelism1, CPU1/1536MiB, без опубликованных портов/health probe. Immutable cached base image`sha256:f109b3e7b9cac0f905e2730701ec375d4adefead611d18e551daeb02c5fe932f`; ведущий подтвердил отсутствие изменений остального export base. Новый export восьми файлов и повторная локальная сверка совпали с исходным проверенным manifest. Успешная квитанция переиспользована для неизменённого проверяемого source; второй параллельный full не запускался. Удалённый `tools/telegram/verify.js` из старого текста навыка не восстанавливался.

Как описано в [Linux environment README](../linux-clock/README.md), export исключает посторонний незавершённый H3 experiment и использует установленные зависимости из committed pinned root/spike manifests. Квитанция относится к этому Linux export и не является `matchingReceipt` всего текущего Windows дерева; в Windows root она не копировалась. Восемь файлов TASK-0099 совпадают8/8, все обнаруженные штатным verifier437 root tests выполнены, отдельные связанные hosted tests также прошли в QA.

Исторические Windows native failures и прежний Linux436/437 сохранены и не объявлены успехом. Их первопричина в Windows не установлена; новый Linux pass не доказывает её исправление. В этой независимой Windows-проверке все адресные тесты/browser/SDK/build прошли без native/timeout failures и без fallback controller. Физический телефон/WAN/performance budgets не проверялись; эти ограничения не отменяют разрешённую матрицу двух браузеров текущей задачи и не означают приёмку TASK-0100/0101. Освобождение памяти ОС по GPU counters не заявляется.

## Покрытие критериев

1. Общая карта/три игрока/NPC/signals/независимый input/fourth full: browser16, labels churn и client DTO checks.
2. Player-player/AI damage/repair/props/wanted/arrest: browser16 сравнивает server tick/state; late join восстанавливает durable prop/wheel без старых effects.
3. Authority и personal respawn/blur: source review, whitelist/unit/room tests и browser personal generation/map/neutral assertions; разрешённый prediction сохранён.
4. Cancel/error/retry/reconnect/offline/lifecycle: client23, standalone SDK/Edge regressions,10leave/join, CONNECTING/pagehide counters и unreachable-endpoint offline PLAY.
5. Обязательные автоматические/браузерные/визуальные проверки выполнены: full437/build, targeted23+6, browser16, отдельные сценарии и просмотр пяти PNG; ограничения перечислены выше.
6. Отчёт и статусы синхронизированы; независимый QA перевёл задачу в done через адресный queue CLI.
