# TASK-0097: Выделить общий серверный мир физики и AI для трёх игроков

- Статус: in-progress
- Приоритет: high
- Создана: 2026-10-14
- Обновлена: 2026-10-23
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Сложный рефакторинг общего мира и сохранение gameplay: gpt-6.1-sol, high.
- Зависимости: TASK-0096 — требуется done

## Актуальная сверка 2026-10-23

Эта сверка имеет приоритет над историческим baseline и будущими путями ниже. Проверены исходники рабочего дерева поверх `5416e88`; чужие локальные изменения не являются завершённой частью этого задания. Общая карта выпуска: [что осталось до сетевого релиза](../knowledge/multiplayer-release-readiness.md).

**Уже реализовано:** Серверный мир уже есть в tools/multiplayer-spike/world.js (SpikeWorld): общий cannon world, 120 Hz, три игрока, union LOD для 102 civilian, карта/коллайдеры и props. Это действующая основа preview, а не ещё не начатый перенос.

**Остаётся:** Не выделен единый production core для offline/online; остаются серверные police/wanted/arrest, attribution толчков нескольким игрокам и полная gameplay/cleanup приёмка. Общие repair pickups реализованы и приняты независимым QA в TASK-0110 (2026-10-23). Это не завершает 0097.

**Статус `in-progress`:** активная частично реализованная задача; 0110 принята; дальше общий core и серверные police/wanted/arrest.

Архитектурное уточнение: запрет online solver ниже относится к первоначальному server-only варианту. С 2026-10-18 выбран и реализован non-authoritative client prediction/reconciliation, см. [план](../knowledge/multiplayer-server-plan.md) и [проверки prediction](../knowledge/multiplayer-client-prediction.md). Authority, AI, damage и игровые транзакции остаются серверными. Первоначальный no-go TASK-0096 нельзя автоматически применять к текущему клиенту; его отрицательные измерения сохранены как история, а итоговые budgets всё ещё требуют проверки. Не менять стек и не удалять prediction ради выполнения устаревшего текста.

Фактические пути: `tools/multiplayer-spike/world.js`, `server.js`, `deploy/server.js`, `src/multiplayer/{game,room-client,frame-codec,snapshot-buffer,prediction,prediction-world}.js`; предполагаемые `server/`, `src/simulation/` и `src/network/` ниже ещё не созданы. Перенос в production core остаётся требованием 0097, существующее preview поведение надо сохранить. Автопроверки: `node tools/verify.js --full` и соответствующие `tools/multiplayer-spike/tests/*`; не восстанавливать удалённый Telegram verifier.

Прежние пустые отметки критериев означают отсутствие полной приёмки, а не отсутствие всей реализации. Исторические артефакты 18–19 октября перечислены в общей карте; чтение этих отчётов не считается новым запуском тестов или новой QA-приёмкой.

## 1. Цель и запрос пользователя

Получить data-only simulation core, который запускается в Node и обслуживает 1–3 игроков, весь AI и игровые правила; одиночная игра использует тот же core. Сейчас это выполняется браузером и связано с одной машиной.

Исходный запрос: «внедрение мультиплеера … на карте … 3 игрока … физику … на сервер … логику AI машин тоже … хороший движок для гейм сервера». Первоначальная постановка подготовлена 2026-10-14; фактический прогресс указан в актуальной сверке выше. Конкретные gameplay rules, budgets и стек — предложения автора из [плана](../knowledge/multiplayer-server-plan.md), обязательного контекста данного задания.

## 2. Исторический проверенный контекст (2026-10-14–16)

2026-10-14, HEAD b6c0763be369bc49cb2cc6f39eb03ed58f0a0afd, main. ESM/Three.js0.180.0/cannon-es0.20.0/Vite7.1.9, физика120Hz; серверного framework в package.json нет. Исследован рабочий код, а не только документация. Уже имеются чужие staged/unstaged/untracked изменения, включая src/traffic.js, src/traffic-ai.js, src/city-boundary.js, package.json, AGENTS.md и task tooling. Не откатывать/не коммитить их; переснять git status перед реализацией. Полный перечень изменяемых файлов текущей сессии не является whitelist будущего исполнителя.

| Файл / символ | Проверенное назначение | Точка работы |
| --- | --- | --- |
| src/main.js / startGame, fixed-step callback | Браузерный цикл и gameplay | Разделение offline/online |
| src/vehicle.js / CarSimulation, STEP, prepare/postStep | cannon-es; STEP=1/120, допускает общий world | Shared server physics |
| src/traffic.js / createVehicleRuntime, stepWorld, TRAFFIC_PHYSICS_ZONE | AI/physical-logical NPC вместе с THREE и одним player | Headless core и union LOD |
| src/traffic-ai.js, traffic-planner.js, traffic-junction.js | Маршруты и управление NPC | Сохранить реальные правила AI |
| src/city-generator.js / createCityPlan; city-layout.js / cityLayoutSignature | Seed-based карта | Server seed/config/version |
| src/city-scene.js / createCityScene; street-prop-physics.js / StreetPropPhysics | Рендер/коллайдеры и prop gameplay | Data-only геометрия и multi-player attribution |
| src/police-pursuit.js / createPolicePursuit | По умолчанию targetId='player' | Общий pool с несколькими целями |
| src/wanted-system.js, arrest-system.js, repair-pickups.js | Сейчас вызываются main для одного игрока | Индивидуальное состояние/общие pickups |
| src/start-screen.js, driving-input.js, joystick.js, game-loop.js | Старт, ввод, local timing | UI/input adapters |
| package.json; tests/*.test.js | npm test/build/dev | Проверки существующего поведения |

При зависимостях таблица описывает baseline до серии; после done зависимости обязательно проверить фактические новые пути/API и обновить задание. Прочитать принятый docs/knowledge/multiplayer-server-adr.md, когда он появится; отсутствующий ADR блокирует этапы после0096.

Контекст TASK-0096 (2026-10-16): изолированный tools/multiplayer-spike и ADR сохранены, core0.18.18/ws-transport0.18.4/SDK0.18.5/Schema5.0.39. Реальная kernel netem loss1% матрица и optimized Node22.23.3 soak теперь выполнены, основной исследовательский результат прошёл независимую QA; см. актуальный статус/отчёт TASK-0096 и docs/knowledge/multiplayer/2026-10-16. Production core/полный gameplay ещё не перенесены. ADR сохраняет no-go: browser p95 при RTT100/loss1 выше200мс, measured cadence ниже nominal; короткие patch30/60 пробы тоже не прошли latency. Сохранять draft до закрытия архитектурного gate, а не только смены статуса0096. Следующий вариант в ADR — unreliable authoritative transport; online client solver без отдельного решения не вводить.

## 3. Область изменений

src/simulation/**, src/vehicle.js, src/traffic*.js, src/police-*.js, src/city-scene.js, src/city-generator.js, src/road-surface.js, src/street-prop-physics.js, src/vehicle-spawn*.js, src/repair-pickups.js, src/wanted-system.js, src/arrest-system.js, src/main.js, релевантные tests/**. Выделить visual adapter из traffic.js, общий data-only collider builder из city-scene.js. Рендер, материалы, модели и управление сохранить; сетевой room/UI сюда не входят.

Сохранить offline single-player, visual defaults и текущие модели/управление; не трогать game-template и соседние оптимизационные задачи. Возможные равноценные имена файлов допускаются с обновлением документации и зависимых заданий, без расширения поведения.

## 4. Требуемое поведение

Реализовать createGameWorld с addPlayer/removePlayer/setPlayerInput/step/snapshot/dispose по принятому ADR. Ни core, ни его транзитивные импорты не требуют THREE, document/window, DOM, renderer или GLTF. World/materials принадлежат core, несколько CarSimulation получают их явно. Для каждого fixed substep подготовить всех игроков/NPC, сделать ровно один world.step(STEP), затем postStep и gameplay; не вызывать CarSimulation.step для каждого игрока.

Вынести static colliders/road height/props из scene builder так, чтобы offline и сервер использовали один plan и collision signature. Отделить визуальную appearance от authoritative spawn phase: headless появление не требует mesh и всё равно блокирует ввод/коллизии до безопасной активации. Spawn scheduling отвязать от frame advance и перевести на simulation time.

Обобщить playerOccupancy, LOD, contact retention, эвакуацию NPC, видимость для despawn и pending spawn на всех игроков. Машины игроков всегда физические, NPC physical возле любого из трёх и logical далеко от всех. Сохранять скорости/повреждения/id при promotion. Не удваивать world и не отключать AI для удалённых клиентов.

На серверный core перенести нарушения/светофоры/wanted/arrest/repair/damage/props; состояние на playerId. Полиция — общий runtime, cap из ADR, стабильный target selection. Разрушение props/причинность NPC толчка атрибутируются конкретному игроку; current StreetPropPhysics singleton playerPushedUntil не должен смешивать игроков. Совместное потребление pickup разрешается один раз по tick/playerId. Respawn одной машины не reset мира. Snapshot достаточен для late join, событийные id устойчивы и не требуют доступа к meshes.

Offline adapter сохраняет single-player defaults, камеру, клавиатуру/джойстик, деформацию, мигалки, следы, дым, repair и retry/newRound; visual modules подписываются на DTO/события core. Не переносить эффекты на сервер.

## 5. План для исполнителя

1. После done0096 перечитать ADR и фактический протокол; обновить эту задачу и only then ready.
2. Выделить data-only colliders и core; сначала сохранить offline один игрок и existing tests.
3. Отделить AI actor records от scene objects/pools и привязать visual adapter по entityId/generation.
4. Заменить singleton player на registry; перенести gameplay и union LOD, добавить многопользовательские fixtures.
5. Сравнить offline поведение и headless snapshot, проверить lifecycle, затем заполнить отчёт/ready-for-qa.

## 6. Критерии готовности

- [ ] Headless import и пять минут мира 3+102 NPC работают без THREE/DOM; solver вызван один раз на substep.
- [ ] Три далёких игрока имеют физические NPC вокруг каждого; NPC между зонами не дублируется и не теряет состояние.
- [ ] Wanted/арест/repair/respawn индивидуальны, police/props/signals общие; pickup в одном tick ремонтирует одного eligible.
- [ ] Повторное создание/dispose мира очищает bodies/listeners/таймеры; offline функциональность сохранена.
- [ ] Обязательные проверки ниже выполнены и записаны фактически; ограничения и невыполненные пункты перечислены.
- [ ] Отчёт заполнен; после разработки статус ready-for-qa и INDEX синхронизированы. done разрешён только независимому QA.

## 7. Проверки

### Автоматические

Рабочая директория — корень CarWars, кроме явно указанного prefix.

npm test и npm run build. Добавить tests/multiplayer-world.test.js и tests/headless-import.test.js, выполнить node --test tests/multiplayer-world.test.js tests/headless-import.test.js. Покрыть shared world step count, union LOD, concurrent pickup, multi-player props attribution/police target/respawn, 20 create/dispose циклов, fixed-seed baseline одного игрока с физическим tolerance вместо bit-exact cross-platform обещания.

Во время подготовки тесты приложения не запускались: код не менялся. Новые commands/files выше являются требованиями к исполнителю, не утверждением об их существовании сейчас. Для существующих suite failures отделить baseline failures от регрессии, не исправлять соседние проблемы без необходимости. npm/pnpm доступны; не переустанавливать зависимости без причины.

### Ручные

Обязательно offline поездка: клавиатура и mobile viewport джойстик, бордюр/здание, занос/следы, повреждение/отрыв колеса/repair, розыск и арест, retry и новая карта, low/high. Проверить appearance и сохранение модели/колёс. Реальный телефон нужен только для утверждений о physical-device performance; отсутствие записать.

QA повторяет обязательные сценарии независимо; артефакт исполнителя помогает воспроизводимости, не заменяет приёмку. Недоступная обязательная проверка явно блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Факты baseline — раздел2. Авторские решения — общий план: 1–3 игрока, max seat3, shared civilian/police world, personal wanted/respawn, shared pickups/props, no online browser solver, server120Hz. Будущий ADR может уточнить измеренные budgets/DTO; значимое изменение authority/физики или game rules согласовать и обновить зависимые задачи.

Предположение: MVP без аккаунтов и persistence, LAN/self-host сначала; публичный deploy и выбор платного сервера не входят. Домены/credentials не нужны для подготовки локального комплекта. При отсутствии done зависимости/ADR оставить draft или blocked с причиной; не начинать реализацию на недоказанном интерфейсе. Конфликт с актуальными чужими правками, несовместимость server physics или невозможный performance/latency budget требует конкретного воспроизведения/вариантов решения, а не молчаливого обхода. Не снижать NPC count и не удалять gameplay для фиктивного pass.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0097-headless-multiplayer-game-world.md в CarWars. Прочитай AGENTS.md, задание целиком и docs/knowledge/multiplayer-server-plan.md; после TASK-0096 также принятый ADR. Проверь актуальный код, локальные изменения и done зависимостей. Для draft сначала сверить результат зависимостей и перевести задачу в ready. Внеси изменения только в указанных границах, проведи автоматические и обязательные ручные проверки и заполни отчёт. Передай ready-for-qa, синхронизируй INDEX.md; done ставит независимый QA. При блокере запиши воспроизведение и необходимое решение. Не включай чужие изменения в commit/push; учитывай исключения AGENTS.md для CLI executor/QA.
```

## 10. Отчёт исполнителя

### Сверка и возобновление, 2026-10-23

- Результат: Серверный мир уже есть в tools/multiplayer-spike/world.js (SpikeWorld): общий cannon world, 120 Hz, три игрока, union LOD для 102 civilian, карта/коллайдеры и props. Это действующая основа preview, а не ещё не начатый перенос.
- Оставшиеся требования/блокеры: Не выделен единый production core для offline/online; остаются серверные police/wanted/arrest, attribution толчков нескольким игрокам и полная gameplay/cleanup приёмка. Общие repair pickups реализованы и приняты независимым QA в TASK-0110 (2026-10-23). Это не завершает 0097.
- Проверено сейчас: чтение перечисленных исходников, тестов и сохранённых отчётов; статусы синхронизированы с INDEX. Это не полная игровая приёмка.
- Изменённые файлы: эта задача, INDEX и общая карта выпуска. Реализация следующего подэтапа и его собственные проверки отражаются в TASK-0110.
- Исторические проверки: см. ссылки общей карты; не объявлены повторёнными сегодня.
- Итоговый статус: `in-progress`, 2026-10-23. `done` только после выполнения остатка и независимого QA.

## 11. Отчёт QA

Не проводилась.

## Рекомендация модели исполнителя

Предпочтительно **gpt-6.1-sol, high**. Сложный рефакторинг общего мира и сохранение gameplay: gpt-6.1-sol, high. Это качественная оценка соотношения затрат и качества по доступному списку моделей и риску задачи, без утверждений о точных тарифах. Для этой серверной серии экономичная модель без запаса на архитектуру и проверки не рекомендуется.
