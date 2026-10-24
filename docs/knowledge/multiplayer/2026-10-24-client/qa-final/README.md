# Третья независимая QA TASK-0099, 2026-10-24

**Verdict: changes-requested.** Старые QA-0099-1 и QA-0099-2 закрыты адресными проверками. Новый QA-0099-3: после выхода/нового входа одного из трёх игроков две разные машины имеют одинаковую подпись «Друг 3» и одинаковую окраску. QA-0099-4: два отдельных browser startup завершились server-side `cannot disconnect during onCreate()` до игрового smoke. Реализацию QA не менял; история прошлых приёмок сохранена в задаче.

Дата UTC в артефактах начинается23 октября22:xx, локальная дата Europe/Warsaw —24 октября. Проверялись семь файлов [по SHA-256](checked-files.json); [повторная сверка](frozen-source.json) подтвердила неизменность всех семи. HEAD изменился сторонним коммитом с6fe6491 на3a2d2536c5a89bc60f80fb6bd84030122d58a4d2 во время работы; проверенные исходники остались прежними.

## Доказательства

- [client-snapshot-prediction.txt](client-snapshot-prediction.txt): optimized Node22.23.3,21/21 (client8 + snapshot/prediction13). Включает delayed old leave ACK/error→fresh connect и два drop при незавершённом async welcome; DTO isolation/generation/deletion, input whitelist, duplicates eventId. Запуск начат наCPU0, затем собственный процесс/дочерний prediction ограниченыCPU4, чтобы не конкурировать с общим verifier ведущего. Optimization и тестовый объём не менялись; performance pass не заявлен.
- [reconnect-cancel.json](reconnect-cancel.json), [runner](reconnect-cancel.mjs): реальный SDK scheduled retry после отмены не открыл старый transport через1800мс, defect=false/serverConnected=false.
- [Node stale error](stale-error-retry.json), [runner](stale-error-retry.mjs): paused old server TCP/ошибочный transfer-start bytes0→fresh connect→resume old ACK, новая phase=playing/active=true/statuses=[]; defect=false.
- [Edge stale error](stale-error-retry-browser.json), [runner](stale-error-retry.cjs), [кадр](stale-error-retry.png): тот же UI retry сохранил новую roomId, playing/ready/active=true; pageerror=[]. Воспроизводитель прежнего дефекта изменён только на ожидание600мс после resume и assertions сохранённого playing вместо ожидания ошибочной phase.
- [Label lifecycle](label-rejoin.json), [runner](label-rejoin.cjs), [кадр](label-rejoin.png): реальный Edge, три isolated contexts; подписи считываются из фактически нарисованных CanvasTexture через прозрачный logging wrapper fillText (сам draw вызывается неизменённым). Было Вы/Друг2/Друг3; после выхода Друг2 и нового входа fresh sessionId стало Вы/Друг3/Друг3. Оба чужих labels голубые#9ddfff, машины визуально одинаковые жёлтые. Кадр просмотрен; pageerror=[]. Это нарушение различимых меток/цветов из раздела4 задачи, связанное с критерием1.
- [Offline](offline.json), [runner](offline.cjs), [кадр](offline-playing-high.png): Vite без game server, endpoint127.0.0.1:1, обычная PLAY кнопка; tick3→185,0 запросов к game endpoint, pageerror=[]. Кадр реального игрового мира просмотрен.
- [pagehide-first-failure.txt](pagehide-first-failure.txt), [pagehide.txt](pagehide.txt): два запуска pagehide/CONNECTING fixture завершились до клиента с исключением HostedDrivingRoom.onBeforePatch→fault→disconnect `cannot disconnect during onCreate()`, второй с fixed seed42. Pagehide/listener smoke в этой приёмке **not-run**, прежний QA2 pass не выдан за новый. Чтение кода: super.onCreate запускает50мс patch и simulation timer, затем Hosted.onCreate ожидает sim.ready, а Hosted metrics.patchIntervals и новый state устанавливает после await. Patch может исполниться в этом промежутке. Это server startup race вне семи замороженных client-файлов, а не доказанный client regression; требуется исправление и cold/delayed-ready regression.
- Основной16-case [browser runner](browser.cjs) был прерван после более6мин без первых PNG/итогового JSON и без подключения к game server; [исходный stdout](browser-first-timeout.txt). Причина не установлена. Начальная browser affinity была одним CPU, затем browser process trees получили обычную маску; performance не измерялся. Эти16 сценариев в текущей приёмке **не объявлены пройденными**. Перед следующим запуском в fixture добавлены только timestamp/stage сообщения; повтор не запущен по просьбе ведущего завершить rework. Зависшее собственное дерево процессов остановлено; посторонние процессы не менялись.
- [standard current full verifier](full-verifier-failed.txt), [receipt](full-receipt-failed.json): ведущий запустил обычный optimized Node22.23.3 tools/verify.js --full наCPU0.425passed/3failed, native exit3221225477 в city-boundary/city-layout/traffic-pooling. Build этим verifier не запускался (tests1/build=null); matchingReceipt не может быть положительной при ok=false. Причина native failures не установлена, affinity не решила проблему. Linux baseline433/433+build на старом source не является квитанцией текущего исправления; отдельный прежний Windows build также не заменяет текущий full.

## Команды

Корень CarWars, PowerShell; Node `C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe`, PLAYWRIGHT_MODULE `C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`:

```powershell
$qaNode='C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe'
$env:PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:ARTIFACT_DIR='docs/knowledge/multiplayer/2026-10-24-client/qa-final'
& $qaNode --test tests/multiplayer-client.test.js tests/multiplayer-snapshot.test.js tests/multiplayer-prediction.test.js
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-final/stale-error-retry.mjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-final/stale-error-retry.cjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-final/reconnect-cancel.mjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-final/label-rejoin.cjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-final/offline.cjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-final/pagehide.cjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-final/browser.cjs
```

Exit records дополнительной последовательности сохранены в additional-exits.json; pagehide exit1 не скрыт последующим offline exit0. Physical phone, WAN, performance и high/low acceptance в этой приёмке не выполнены; отдельный offline high кадр есть. Браузерные assertions используют реальные SDK/server, fixtures задают только детерминированные события/позы и открывают read-only diagnostics. Следующая независимая приёмка должна повторить обязательные16 случаев, pagehide/cleanup, cold startup и различимость после3→2→3; финальный full нужен на окончательном source.
