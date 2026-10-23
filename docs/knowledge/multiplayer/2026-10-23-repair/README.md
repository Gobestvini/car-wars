# Общий серверный ремонт: 2026-10-23

Реализация и приёмка подэтапа [TASK-0110](../../../tasks/TASK-0110-multiplayer-shared-repair.md). Это не приёмка всего multiplayer release.

`browser-report.json` — три изолированных Edge/WebGL контекста, 102 NPC, hosted Colyseus и Vite на локальных портах; 1440×900 high, 390×844 low/touch emulation, 844×390 late observer. До ремонта: damage 0.8, 651 изменённая координатная тройка кузова, detached wheel. После серверного подбора: damage 0, deformation 0, все колёса attached, pickup instance determinant 0. Подтверждены late join, reconnect с тем же sessionId, cleanup leave и новая комната с available pickups.

Скриншоты просмотрены: `desktop-damaged.png`/`desktop-repaired.png`, `portrait-before.png`/`portrait-repaired.png`. Portrait показывает ту же ремонтируемую машину через тестовый camera focus; наблюдатель ею не управляет. Набор тестов не измеряет WAN latency/input-to-display/производительность телефона.

Воспроизведение из корня:

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node tests/multiplayer-repair-browser.cjs
```

Путь Playwright зависит от установленной среды; скрипт также поддерживает обычный `playwright` из Node resolution и `ARTIFACT_DIR`. Он поднимает и закрывает собственные hosted/Vite/browser, не обращается к публичной комнате. Operator fixture задаёт исходные повреждения/позы, затем отдельную начальную точку проезда в 2.2 м перед аптечкой. Все последующие положения и ремонт рассчитываются серверными шагами. Публичный протокол setters не получает. Другие клиенты и pickup state берутся из настоящего транспорта.

Невалидные попытки и исправление harness: первый запуск не успел загрузить страницу за 30 с; увеличено ожидание загрузки. SDK не переподключает комнаты младше пяти секунд — добавлено ожидание минимального возраста. Во время медленного screenshot исходная машина могла сместиться мимо pickup; теперь точка начала самого проезда задаётся после снимков и до движения. Эти попытки не считаются pass. Итоговый скрипт прошёл; initial race/height/disconnect/wheel/pose invariants независимо проверяются Node suites. Общий verifier, запущенный во время правки harness, дважды завершил 407/407 и build, но отклонил квитанцию из-за смены fingerprint; окончательный результат и независимый QA записываются в задаче.

Новый переносимый приём здесь не вводится: server-owned транзакция исполняется один раз после общего solver, сортируется по playerId, а client replay только воспроизводит физику и принимает authoritative repair. Применимость ограничена этим gameplay/транспортом и указанной проверкой.

Финальный стабильный full verifier: 407/407, Vite build успешен, receipt ok=true; точная квитанция и независимая приёмка — в разделах 10–11 TASK-0110.
