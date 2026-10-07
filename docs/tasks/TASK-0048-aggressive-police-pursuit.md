# TASK-0048: Быстрое полицейское преследование, таран и остановка игрока

- Статус: in-progress
- Приоритет: high
- Создана: 2026-10-07
- Обновлена: 2026-10-07
- Проект: CarWars, C:\Users\gobes\OneDrive\Документы\CarWars
- Рекомендуемый исполнитель: Сильная модель, высокий уровень рассуждения: динамическая цель, физический таран, общий runtime и resource lifecycle.
- Зависимости: TASK-0047 и TASK-0046 — done (0046 depends on0044/0045, accepted/closed)

## 1. Цель и запрос пользователя

Реализовать быстрые агрессивные полицейские машины, которые преследуют игрока, намеренно врезаются в него и стараются остановить, через расширяемый API безопасного спавна в разных местах карты. Исходный запрос полностью приведён в TASK-0047; её архитектурный документ станет обязательным контрактом.

## 2. Проверенный контекст

Перепроверено 2026-10-07 после закрытия TASK-0046 и принятия ADR TASK-0047. Исходники: `CarSimulation` создаёт общий/переданный Cannon World, `traffic.js` регистрирует физические тела и один раз интегрирует shared world; pursuit ещё нет. HEAD на начало реализации: `5a351380004e48d3152f99ce2c4ab6d626aaf4a7`. Не менять пользовательские AGENTS.md/.agents. Стек: Three.js 0.180.0, cannon-es 0.20.0, Tweakpane 4.0.5, Vite 7.1.9, node:test. Симптомы не выдаются за воспроизведённые.

| Файл / символ | Проверенный контекст и значение |
| --- | --- |
| src/vehicle.js: CarSimulation/DEFAULT_TUNING | Полиция должна использовать ту же базовую физику и реальные steer/throttle/brake. |
| src/traffic.js: createTraffic, stepWorld, add/removeAt, debug | Сегодня lifecycle общего World проходит через гражданский трафик. Уточнить после0047 и0046; второй world.step запрещён. |
| src/traffic-ai.js, src/traffic-spawn.js, src/traffic-planner.js | Переиспользуемые graph/safety/control helpers; цель полиции динамическая, отличается от гражданской случайной цели. |
| src/main.js: reset/rebuildCity/carLab; src/settings.js | Интеграция, тестовый spawn и наблюдаемая игровая демонстрация. |
| docs/knowledge/police-pursuit-design.md | ADR TASK-0047 принят; выбранная граница сохраняет shared-world owner в traffic.js, а police policy и coordinate spawn вынесены отдельно. |

## 3. Область изменений

Архитектурный контракт выбран в [police-pursuit-design.md](../knowledge/police-pursuit-design.md). Область изменений:

- `src/traffic.js` — расширить единственный role-aware runtime API `createVehicleRuntime(...)`; сохранить `createTraffic(...)` façade для существующих callers/tests. Общая occupancy, fixed-step owner, role dispatch и LOD остаются в этом runtime.
- `src/vehicle-spawn.js` — general exact/pending/rejected и explicit nearest-safe coordinate placement; `traffic-spawn.js` сохраняет road-slot helpers для civilians.
- `src/police-pursuit.js` и police-фабрика в traffic assets — отдельная police policy и вид; `src/main.js` связывает player/map/2 pursuing units и read-only test API.
- `tests/police-*.test.js` — real physics, safe spawn, fixed-step/LOD/lifecycle and pursuit fixtures. Не менять player tuning, гражданские правила ради полиции, размеры карты, damage FSM, UI ареста или wanted-level. Один shared `sim.world`, один вызов `world.step` на STEP.

Работать последовательно с задачами, затрагивающими те же исходники. Не редактировать node_modules/ или dist/. Новые зависимости без необходимости не добавлять.

## 4. Требуемое поведение

- Полиция визуально отличается кузовом/раскраской/простыми маячками, создаётся тем же безопасным API в центре, на окраине и в свободной позе вне дорожной оси. Начальный игровой сценарий автора:2 преследователя через безопасную очередь, выбор spawn рядом с игроком по валидным кандидатам; count0 отключает их. Минимальный debug контрол количества/сброса либо равноценная воспроизводимая демонстрация.
- Chase policy использует позицию и скорость игрока для перехвата, steering/throttle/brake через физику; гражданские cap8/16 не ограничивают pursuit. На одинаковой свободной прямой, одинаковых стартовых параметрах и tuning police достигает≥90% скорости и разгона машины игрока к выбранному benchmark времени, без читерского добавления velocity.
- Цель — сблизиться и физически ударить/блокировать target. После контакта не переключаться на гражданское бегство; повторять сближение, удерживать давление при доступном corridor, выходить из застревания bounded recovery. Описать остановку/возврат в chase в diagnostics.
- На контролируемом fixture игрок без газа после тарана останавливается до speed<0.5 м/с на≥2 с. Для активно уезжающего игрока полиция выполняет реальный intercept/ram; гарантии остановки при любых действиях игрока нет.
- Не ехать сквозь дома, не навязывать collision-free правило между police и target, не толкать игрока телепортом. Общая occupancy содержит полицию: гражданские учитывают её как реальное препятствие. Переход LOD не пропускает контакт.
- Spawn API согласно ADR: `requestSpawn({role, position:{x,y,z}, yaw, targetId, options:{placement:'exact'|'nearest-safe'}})` возвращает discriminated `created/pending/rejected` объект с actor/request ID и reason; exact никогда не падает в центр автоматически. finite pose, playable surface/bounds/buildings обязательны; occupied pose — pending/cancellable. Не спавнить с пересечениями даже для таранной роли. После remove/reset/rebuild/dispose никаких orphan bodies/listeners/meshes/pending/reservations.
- Цель вне дороги, за препятствием, reset игрока, multiple police, blocked spawn и карта после rebuild имеют определённое поведение из ADR. Подготовить воспроизводимое управление target в fixture без нового игрового режима.

## 5. План для исполнителя

1. Перечитать ADR и проверить актуальность файлов/символов; сохранить его API/lifecycle invariant.
2. Расширить существующий shared runtime role registry без второй физики; сохранить civilian controller, signal, LOD, safety и совместимый `createTraffic` API.
3. Добавить police role/controller/visual, coordinate spawn API и main integration для двух units; police остаются physical на всём протяжении pursuit.
4. Проверить скорость/контакт/остановку, произвольные безопасные spawn и cleanup; запустить гражданский flow после появления новой роли.

Равноценное решение в этих границах допустимо; обоснованные отклонения записать в отчёт.

## 6. Критерии готовности

- [ ] Зависимости done и описание привязано к выбранному ADR.
- [x] Police benchmark≥90% игрока, physical intercept/ram воспроизводимы, fixture остановки выполнен.
- [x] Spawn в центре/на окраине/в безопасной off-road позе работает; invalid/occupied не создают overlap.
- [x] Общая физика/occupancy и гражданский flow сохранены; 12 spawn/remove циклов не оставляют bodies/meshes, count0/restart работает.
- [x] В игре показаны2 активных преследователя, count0 и повторный запуск корректны.
- [ ] Обязательные проверки выполнены и реальные результаты записаны в отчёт и INDEX.md.

## 7. Проверки

Команды выполняются из корня CarWars; актуальные scripts: npm test, npm run build, npm run dev (эквивалентно pnpm test/build/dev). Проверить доступный Node/зависимости, при необходимости использовать существующий start.ps1, не переустанавливать их автоматически.

npm test, npm run build. Новые police integration fixtures используют STEP=1/120, real CarSimulation и статические city colliders. Benchmark минимум три фиксированные раскладки: straight rear pursuit, lateral intercept и target за зданием; отдельно fixture остановки с coasting target. Повторить12 spawn/remove/reset/rebuild циклов, сравнить bodies/meshes/listeners/pending. Обязательна300-секундная гражданская регрессия default60 с полицией выключенной и mixed-role сценарий с2 полицейскими. В браузере npm run dev: keyboard/touch viewport, оба качества, follow/free, центр/окраины, попадания спереди/сбоку/сзади и возобновление преследования; фиксировать trace, скорость, контакты и ошибки. Подготовка задания не включает запуск этих проверок.

## 8. Предположения, вопросы и условия остановки

Проверенные факты приведены в разделе2; сценарии пользователя требуют воспроизведения. Числа, интерфейсы и трактовки с пометкой «предложение автора» выбраны для проверяемости и не являются дословными требованиями пользователя. В пределах этих решений дополнительное согласование не нужно.

ADR и traffic dependencies выполнены. Если актуальные исходники противоречат ADR, остановиться и обновить архитектурный контракт до кода. Runtime failure отделять от regression и записывать диагностические Node flags; не скрывать production-check failure.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0048-aggressive-police-pursuit.md в проекте CarWars. Прочитай AGENTS.md и задание целиком. Проверь актуальность контекста и зависимости; draft сначала актуализируй после их завершения. Внеси изменения в указанных границах, выполни проверки и заполни отчёт. Обнови статус задачи и docs/tasks/INDEX.md. При существенном блокере запиши причину и требуемое решение, не объявляй задачу выполненной.
```

## 10. Отчёт исполнителя

- Результат: добавлено физическое pursuit/intercept/ram/maintain-block/recover, две настраиваемые полицейские машины, вид с маячками, role-aware shared runtime и coordinate spawn exact/pending/rejected/nearest-safe.
- Изменённые файлы и зачем: `src/traffic.js` — единый actor/world/occupancy/LOD lifecycle и compatibility facade; `src/vehicle-spawn.js` — безопасная coordinate placement; `src/police-pursuit.js` — отдельная динамическая police policy; `src/main.js`, `src/settings.js` — две машины, счётчик, spawn/reset/rebuild wiring; `tests/police-pursuit.test.js` — физика, spawn, benchmark и lifecycle; `tests/traffic-liveness.test.js`, `tests/traffic-flow.test.js`, `tools/traffic-performance.cjs` — сохранённые гражданские проверки и совместимость tooling.
- Команды и фактические результаты: `node --test tests/police-pursuit.test.js` — 5/5; police держится ≥90% скорости игрока в 10-секундном straight fixture; physical collision и coasting target удержан <0.5 м/с более 2 с. `node --no-opt --no-maglev --test --test-concurrency=1 tests/traffic-liveness.test.js` — 22/22; `tests/traffic-spawn.test.js` — 5/5 (включая 60/300 traffic cases, 63.7 с); `tests/traffic-flow.test.js` — 3/3, 300 с, 709 stop intervals, 0 unexplained, 0 controller-stall (257 с); production Vite build успешен.
- Ручные проверки: открытая вкладка игры `#debug` показала `Полиция: 2`, `Активно: 2`; запуск клавиши управления отображал живую сцену без ошибок. Браузерный runner `node tools/traffic-flow-check.cjs` остановился до запуска из-за отсутствующего `playwright`; ручная матрица качества, touch viewport и полная проверка pursuit в браузере не выполнены.
- Выполненные критерии: физическое pursuit, 90% acceleration/speed envelope; центр/край/off-road spawn fixture, blocked/occupied rejection, nearest-safe; общий world и occupancy; count0/restart; 12 remove/spawn циклов без orphan body/mesh; гражданская liveness и 300-секундный flow.
- Непроверенное, блокеры и отклонения от плана: браузерный cross-quality/touch сценарий недоступен из-за отсутствующего Playwright; единый `traffic.js` выбран согласно ADR вместо дополнительного runtime-файла; полиция visual factory оставлена в traffic assets. Полный `npm test` ранее на Node 24/flags имел worker crash; релевантные наборы проверены отдельно. Build предупреждает о Three.js чанке >500KB.
- Итоговый статус и дата: in-progress, 2026-10-07 (код и автоматические сценарии готовы; требуется браузерная матрица TASK-0048).
