# Независимый повтор QA TASK-0099, 2026-10-24

**Verdict: changes-requested.** QA-0099-1 исправлен, но дополнительный real-SDK и Edge error/retry reproducer подтвердил новый major QA-0099-2: запоздалое завершение leave после ошибки старого snapshot переводит уже подключённую новую комнату из playing в offline-error, ready=false при active=true. Задача возвращена адресно в in-progress --rework, история сохранена в разделе11.16 passed browser cases не включают этот отдельный failed case.

Воспроизведение: [Node JSON](stale-error-retry.json), [Node runner](stale-error-retry.mjs), [Edge JSON](stale-error-retry-browser.json), [Edge runner](stale-error-retry.cjs), [кадр](stale-error-retry.png). Fixture задерживает server-side приём old leave через socket.pause, вызывает snapshot error ошибочным transfer-start bytes0, затем создаёт свежую комнату через UI до old socket.resume. После resume callback ошибки старой комнаты без epoch guard меняет текущую phase. Исходники реализации не менялись. Обязательна новая независимая приёмка после исправления.

Проверен diff поверх HEAD `6fe6491cb21fed3db45e50dbf3a7147e6fa557c3`; [SHA-256](checked-files.json). Исходники реализации QA не менял. Предыдущая приёмка и первоначальный major сохранены в `../qa/` и разделе11 задачи. Дата UTC в JSON начинается23 октября22:xx; локальная дата Europe/Warsaw —24 октября.

## Фактические проверки

- [client-test.txt](client-test.txt): optimized Node22.23.3,6/6; включая новый real-SDK scheduled reconnect regression.
- [reconnect-cancel.json](reconnect-cancel.json): повтор прежнего отдельного воспроизведения, ожидание1800мс, defect=false, старый сокет не открыт, serverConnected=false. [Код](reconnect-cancel.mjs).
- [browser-report.json](browser-report.json), [runner](browser.cjs), [stdout](browser.txt):16/16, Edge+Chrome,3 isolated contexts, LAN IPv4, default102 civilian.390×844 touch joystick/low; desktop1440×900/high. Проверены управление/общая карта/публичный invite, player-player collision, player-AI collision с полицейским и его damage на клиентах, repair race/один победитель, разрушенный prop и оторванное колесо до late join,12 signal approaches на3 клиентах при одинаковом authoritative tick и текущие rendered phases, fourth full, персональные wanted/arrest/respawn, menu/free camera/hidden neutral при движущемся tick, обычный reconnect,10 leave/join, отмена reconnect через UI с ожиданием1700мс и fresh create, обе ранние отмены/retry, offline branch. pageerror=[].
- Все10 leave:0 моделей, transfer/listener removers=null,3 scene children; renderer.info.memory стабильно11 geometry/12 texture. Это page-owned shared assets; освобождение памяти ОС по этим counters не заявлено.
- [pagehide.json](pagehide.json), [runner](pagehide.cjs), [stdout](pagehide.txt): дополнительный реальный Edge socket CONNECTING(0) → UI cancel → CLOSED(3) через1800мс; buffered messages=0, reconnecting=false; следующая create имеет другой roomId. Затем синтетический pagehide: все document/canvas listeners удалены, window resize/keydown/keyup/blur удалены, page-owned loop остановлен по чтению кода; city/models/prediction/timers очищены, counters57/13→1/1, pageerror=[]. Остались SDK offline и page-owned pageshow, плюс browser automation listeners.
- [connecting-cancel.json](connecting-cancel.json), [код](connecting-cancel.mjs): дополнительный Node22 native WebSocket smoke. Немедленно закрытый CONNECTING transport остаётся readyState2/CLOSING на момент1800мс; isOpen=false, buffered=0, fresh create работает. Это ограничение Node smoke; за CLOSED(3) не выдано. Отдельный Chromium case выше подтвердил CLOSED(3).
- [snapshot-prediction.txt](snapshot-prediction.txt): optimized13/13, snapshot DTO copy/isolation, generation/deletion, input authority whitelist, prediction/replay. Source read: browser не создаёт authoritative GameWorld/traffic AI/wanted/arrest/repair FSM; разрешённый prediction solver остаётся согласно актуальной постановке. Личный respawn не изменил map signature/чужую generation.
- [offline.json](offline.json), [код](offline.cjs), [кадр реальной игры](offline-playing-high.png): отдельный Vite без game server, endpoint127.0.0.1:1, обычная PLAY кнопка, local tick4→184 за1500мс,0 game-server requests/pageerrors. Старый `offline-high.png` базового runner снят ещё при fade loading overlay; как кадр игрового мира не используется.
- Визуально просмотрены portrait-arrested/portrait-low/offline-playing-high. Arrest banner и toolbar не перекрываются; кнопка целиком внутри390×844. High/low и индивидуальный police HUD сохранены на PNG. Portrait arrest получен resize desktop-страницы; touch отдельно проверен в Chrome mobile context. Физического телефона не было.

Первый расширенный fixture ошибочно требовал damage у civilian, который baseline создаёт с damage=false; timeout сохранён в browser-fixture-failure.json/txt. Финальный case использует damage-enabled police NPC и реальное физическое столкновение. Первый offline fixture пытался нажать скрытый PLAY при debug bypass; исправлен удалением debug из URL, исходный timeout сохранён в offline-fixture-failure.txt. Это ошибки QA fixture, а не дефекты реализации.

## Команды

Из корня CarWars, PowerShell:

```powershell
$qaNode='C:/Users/gobes/AppData/Local/carwars-netem/node22/node.exe'
$env:PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:ARTIFACT_DIR='docs/knowledge/multiplayer/2026-10-24-client/qa-rework'
& $qaNode --test tests/multiplayer-client.test.js
& $qaNode --test tests/multiplayer-snapshot.test.js tests/multiplayer-prediction.test.js
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-rework/reconnect-cancel.mjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-rework/browser.cjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-rework/pagehide.cjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-rework/connecting-cancel.mjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-rework/offline.cjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-rework/stale-error-retry.mjs
& $qaNode docs/knowledge/multiplayer/2026-10-24-client/qa-rework/stale-error-retry.cjs
```

Общий Windows optimized verifier failed из-за native city-boundary и других baseline failures; диагностический no-opt тоже failed на pre-rework source. Их нельзя считать passed. Production Windows optimized build ведущего passed. Отдельный текущий optimized Node22 Linux ARM64 verifier и его build выполняет ведущий; окончательная квитанция/решение фиксируются в разделе11 задачи после окончания. WAN/performance budgets к этой приёмке не относятся.
