# Независимый QA TASK-0097 — 2026-10-23

Решение: **принято**. Проверен рабочий diff реализации поверх `25bac72`, включая финальную правку пустой строки `spawn-phase.js`. Реализация в ходе QA не изменялась QA-агентом. Чужие staged/unstaged файлы не входили в область приёмки.

## Автоматические проверки

- Независимо вызван `matchingReceipt(process.cwd())` из `tools/verify.js`: финальная квитанция Node 24.19.0 `ok=true`, tests/build=0, fingerprint `a9cad65c2882c80e190459f24daa3ffbb95f6a2eb3b5cb0bd298d404ad294ac9`; это выполненные ведущим 419 тестов и Vite build на неизменённых входах, повторно использованные по qa-tasks.
- Node **22.23.3**, без `--no-opt`: `node --test tests/headless-import.test.js tests/multiplayer-world.test.js tools/multiplayer-spike/tests/hosted-gameplay.test.js tools/multiplayer-spike/tests/hosted-prediction.test.js tools/multiplayer-spike/tests/hosted-destruction.test.js tools/multiplayer-spike/tests/hosted-repair.test.js tools/multiplayer-spike/tests/hosted-room.test.js` — **17/17**.
- `ARTIFACT_DIR=docs/knowledge/multiplayer/2026-10-23-core/qa/soak node tests/multiplayer-world-soak.mjs` на Node 22.23.3 — [300 секунд симуляции](soak/soak.json), 36 000 ticks/solver calls, три игрока, 102 civilian, 3→6 police, конечные pose/velocity. Время ускоренного прогона 43.263 с; p95/p99 step 2.689/4.172 мс. Параллельно работал Edge, это не измерение выделенного VPS.
- Проверены import с запрещённым Three и без DOM, один solver, безопасная appearance, union LOD трёх наблюдателей, сохранность id/damage при promotion, персональные нарушения и причинность props, стабильные police targets/quotas, арест только назначенной цели, индивидуальный respawn, один eligible pickup при конфликте, fixed-seed visual/headless parity, 20 create/dispose, обычное здание и scheduling при 30/60/120 FPS. Реальные SDK подтвердили late join, reconnect, серверные damage/props/repair/wanted/arrest, rejected forged gameplay и независимый respawn.

## Браузерная приёмка

Edge headless WebGL, desktop 1440×900/high и portrait 390×844/low с native CDP touch. `PLAYWRIGHT_MODULE=C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`.

- Повтор `tests/game-world-browser.cjs`, `ARTIFACT_DIR=.../qa/offline` — [2/2, errors=[]](offline/report.json). Keyboard W/D/Space; native joystick strength=1; appearance и GLB; деформация 651 vertices/отрыв колеса/damage smoke; pickup возвращает колесо и геометрию; реальный prop contact создаёт wanted; physics/FSM завершают arrest с HUD; кнопка начинает новый раунд с новым seed и очищенным состоянием. Все скриншоты сохранены рядом с JSON.
- Дополнительный независимый [fixture](extra-browser.cjs), `ARTIFACT_DIR=.../qa/extra node docs/knowledge/multiplayer/2026-10-23-core/qa/extra-browser.cjs` — [2/2, errors=[]](extra/report.json). Реальная боковая скорость кузова вызывает skid при настоящих wheel physics, **active tire smoke 2/high и 1/low**, tracks 88/60; wheelSupport бордюра даёт contact y=0.15; actual solver contact со сгенерированным домом удерживает кузов снаружи стены. Никаких синтетических wheel DTO или вызовов emit() нет. Повторены также damage/repair/arrest/newRound на обеих настройках.
- `ARTIFACT_DIR=.../qa/online node tests/multiplayer-repair-browser.cjs` — [три клиента, late join/reconnect/new room, errors=[]](online/browser-report.json). High/low и визуальное восстановление общего ремонта на новом hosted core.
- Визуально просмотрены driving/skid/curb/building, повреждение/repair portrait и arrest desktop PNG: модель и колёса сохранены, следы видны, HUD читаем, мигалки видны, восстановленная машина отображается корректно. Счётчики частиц подтверждают слабый по интенсивности шинный и damage smoke; это не оценка художественного баланса дыма.

## Ограничения и неудачные постановки

Оператор задаёт начальные позы/скорость/повреждение, затем работают настоящий fixed-step core, контакты, gameplay и visual consumers. Для воспроизводимого arrest полицейский удерживается на тормозе; полноценная сложная погоня проверена логикой pursuit suite, а не отдельной длительной ручной сессией. Физический телефон не проверялся; для этой задачи он нужен лишь для утверждений о physical-device performance, которых здесь нет. WAN/public deployment/полные room lifecycle и online HUD относятся к последующим этапам.

Первая дополнительная постановка skid дала timeout: одиночная скорость быстро ушла до порога до накопления emitter; повтор с внешним удержанием скорости 1.2 с прошёл. Первый curb fixture заезжал со стороны застройки; выбор подхода с асфальта исправил постановку. Опрос контакта здания каждые 10 мс пропустил короткий contact на portrait; финальный fixture наблюдает каждый выполненный solver tick, сохраняя ровно один вызов исходного solver. Это изменения только QA harness; воспроизводимого дефекта реализации не обнаружено.
