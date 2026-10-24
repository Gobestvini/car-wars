# TASK-0099 — четвёртая независимая приёмка, 2026-10-24

**Verdict: changes-requested, in-progress / Возврат QA: да.** QA-подагент исходники не изменял, commit/push не выполнял. HEAD `3a2d2536c5a89bc60f80fb6bd84030122d58a4d2` и рабочий diff: восемь файлов в `checked-files.json`. `frozen-source.json` подтверждает совпадение8/8 SHA-256 до возврата в разработку. Основные client/browser проверки прошли, но окончательный Linux full failed436/437; startup clock дефект независимо воспроизведён ниже. Новый source после rework требует новой независимой приёмки и успешного full/build.

## Среда и команды

Windows, optimized Node22.23.3 x64, 32 logical CPU. Браузерные процессы и основной runner запускались с полной маской CPU. Edge и Chrome, headless WebGL, сервер по LAN IPv4, три isolated contexts, desktop1440×900/high и mobile390×844/touch/low. Физический телефон, WAN и performance budgets не проверялись; задача допускает два независимых браузера. Это smoke/функциональная приёмка, не performance benchmark.

Из корня проекта, PowerShell:

```powershell
$qaOut='docs/knowledge/multiplayer/2026-10-24-client/qa-accept'
$env:PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:ARTIFACT_DIR=$qaOut
& 'C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe' --test tests/multiplayer-client.test.js tests/multiplayer-snapshot.test.js tests/multiplayer-prediction.test.js
& 'C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe' "$qaOut/browser.cjs"
& 'C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe' "$qaOut/label-rejoin.cjs"
& 'C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe' "$qaOut/pagehide.cjs"
& 'C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe' "$qaOut/stale-error-retry.cjs"
& 'C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe' "$qaOut/stale-error-retry.mjs"
& 'C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe' "$qaOut/reconnect-cancel.mjs"
& 'C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe' "$qaOut/offline.cjs"
```

Основной runner скопирован из предыдущей QA с отдельной директорией, stage timestamps и промежуточным JSON после каждого case; продуктовый код не подменяется. Через Vite route добавлена только read/debug-ссылка на closures. Label reproducer измеряет фактический RGB фона CanvasTexture, прежний hardcoded background удалён из QA-fixture. Offline runner использует обычный PLAY, не debug bypass; дополнительный catch сохраняет диагностику при повторном отказе.

## Результаты

- `client-snapshot-prediction.txt`:23/23,0failed. Client10, включая delayed250ms real-SDK cold create (tick0,0early patch,102civilian,playing/faults0), stale error/slow leave, два drop при async welcome, cancel reconnect. Snapshot/prediction13:DTO copy/isolation, generation/deletion, whitelist/events и разрешённый prediction.
- `browser-report.json`, `browser.txt`, `browser-exit.json`:16/16cases,errors=[],exit0. Default102 civilian, общая карта/invite, server-applied keyboard/touch, player-player и player-AI collision/damage, один winner repair, durable prop/detached wheel latejoin без старых effects,12traffic-signal approaches на3clients в одно authoritative time, fourth full, personal wanted/holding/arresting/arrested/respawn, menu/freecam/hidden neutral и живой server tick, reconnect/fullstate,10leave/join, отмена reconnect/admission/map-loading и retry, offline загрузка.
- Все10leave:models0,transfers/listeners=null,scene children3; renderer memory стабильно11geometry/12texture. Это счётчики Three.js, не доказательство освобождения памяти ОС.
- `label-rejoin.json/png`:старый QA-0099-3 не воспроизводится; после3→2→3 survivor остаётся «Друг2», replacement получает «Друг1». RGB фона различны:157/223/255 и201/244/156, local255/226/156. pageerrors=[],defect=false. Кадр просмотрен.
- `pagehide.json`:старый reconnect transport при реальном CONNECTING0 после UI cancel достигает CLOSED3,buffer0,reconnecting=false,phaseidle через1800ms; свежая create работает. После synthetic pagehide canvas/document listeners пусты, игровые resize/keydown/keyup/blur сняты;models/city/prediction/timers очищены. Renderer58/13→1/1,errors=[].
- `stale-error-retry-browser.json/png` и `stale-error-retry.json`:paused old TCP ack после нового successful join не меняет roomId/playing/ready/active/status;defect=false. `reconnect-cancel.json`:через1800ms oldOpen=false,serverConnected=false,defect=false.
- `offline.json`, `offline-playing-high.png`:отдельный Vite без game server, endpoint127.0.0.1:1; обычный PLAY, tick3→188,0game endpoint requests,0pageerrors. Кадр просмотрен.
- Визуально просмотрены `portrait-low.png`, `portrait-arrested.png`, `desktop-arrested.png`, `label-rejoin.png`, `offline-playing-high.png`. Portrait баннерx8..218 и toolbarx257..382 не пересекаются; restart внутри390×844. High/low сохраняют текущий город/модели/HUD.
- Source review:authority/gameplay/AI остаются серверными; клиентский prediction разрешён актуальным заданием. Personal HUD выбирает local sessionId, respawn — серверный command. Старые async callbacks проверяют connectionEpoch/welcomeEpoch после await; leave инвалидирует эпохи, закрывает retired transport и снимает подписки. Для labels удаление устаревших visuals происходит до выделения номера новым. Hosted inherited timers выключаются синхронно до await ready, свои cadence запускаются после state/metrics, lastTime/accumulator сбрасываются.

## Сохранённые отказы и ограничения

Первый основной browser process оборвался после stagecancel-reconnect до итоговогоJSON, без JSstack (`browser-first-native-exit.txt`); точный native exit первого запуска не был отдельно записан. Повтор прошёл весь runner с exit0. Первый standalone reconnect-cancel Node завершился nativeAV-1073741819 (`additional-exits.txt`); повтор отдельного CLI наCPU0 прошёл exit0. Affinity не объявлена решением или доказанной причиной. Браузеры наCPU0 не ограничивались.

Первый отдельный offline smoke получил timeout30s после PLAY (`offline-first-timeout.txt`); подробная state/pageerror-диагностика в первом fixture не сохранялась, причина не установлена. Повтор без изменения source прошёл exit0 с фактическим движением tick; скрытым успехом первый запуск не считается.

Исторический Linux433/433 и Windows full native failures не заменяют финальный gate. Окончательный [Linux receipt](../linux-final/receipt.json) failed:436/437 за1102,24s, build skipped. [Suite](../linux-final/full-tests.txt), [изолированный map-ready повтор](../linux-final/isolated-map-ready-failed.txt). Native/V8 ошибок нет. Diagnostic4002 в исходном isolated output относится к намеренному old-build rejection; он не доказывает malformed input дефект.

## Новый QA-0099-5 — startup clock, major

Независимый real-SDK `startup-clock.mjs`, без правки исходников, повторяет cold room через delayed `sim.ready`3000ms и задаёт `mapReadyMs:1800`, `onWelcome`500ms. [JSON](startup-clock.json): create3331,809ms, clock age после create3332ms, при beginLoad3345ms. Новый клиент был отключён code4004 через5,879ms после beginLoad, до onWelcome; loadingTimeouts1, defect=true. Ожидание: полные1800ms отсчитываются от beginLoad. Отдельный optimized Node22 CLI наCPU0 завершился exit0, диагностический результат — failed contract, не pass. [stdout](startup-clock.txt), [stderr](startup-clock.stderr.txt).

`ClockTimer.tick()` передаёт всем delayed timers общий deltaTime, и `Delayed` прибавляет его к elapsedTime. После awaited map initialization Hosted room сбрасывает physics lastTime/accumulator, но не синхронизирует Colyseus clock.currentTime. Первый clock.tick начисляет init elapsed таймеру, созданному позднее. Требуется синхронизация clock до own cadence и regression с init delay больше loading deadline. Disposable Linux probe ведущего с clock.start прошёл только адресный map-ready test ([probe](../linux-final/clock-fix-probe-passed.txt)); это не финальный source/full/build. QA не исправлял код; ведущий начал rework после сохранения этого воспроизведения. Task/INDEX возвращаются в in-progress через queue CLI с --rework.
