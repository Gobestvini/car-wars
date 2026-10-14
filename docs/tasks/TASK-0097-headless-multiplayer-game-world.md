# TASK-0097: Выделить общий серверный мир физики и AI для трёх игроков

- Статус: draft
- Приоритет: high
- Создана: 2026-10-14
- Обновлена: 2026-10-14
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Сложный рефакторинг общего мира и сохранение gameplay: gpt-6.1-sol, high.
- Зависимости: TASK-0096 — требуется done

## 1. Цель и запрос пользователя

Получить data-only simulation core, который запускается в Node и обслуживает 1–3 игроков, весь AI и игровые правила; одиночная игра использует тот же core. Сейчас это выполняется браузером и связано с одной машиной.

Исходный запрос: «внедрение мультиплеера … на карте … 3 игрока … физику … на сервер … логику AI машин тоже … хороший движок для гейм сервера». Этот файл подготовлен как задание; описанные изменения ещё не выполнялись. Конкретные gameplay rules, budgets и стек — предложения автора из [плана](../knowledge/multiplayer-server-plan.md), обязательного контекста данного задания.

## 2. Проверенный контекст

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

Контекст TASK-0096 (2026-10-14): изолированный spike создан в tools/multiplayer-spike; решения и ограничения описаны в docs/knowledge/multiplayer-server-adr.md. Проверены core0.18.18/ws-transport0.18.4/SDK0.18.5/Schema5.0.39. Production core/полный gameplay ещё не перенесены. Loss1% и optimized-runtime soak не подтверждены, nominal patch20Hz не выдержан в длинном профиле; зависимость не считается done. Сохранять draft до независимой QA и закрытия blockers, перед исполнением сверить актуальный ADR и код.

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

- Результат: Не выполнялась.
- Изменённые файлы и зачем: —
- Команды и фактические результаты: —
- Ручные проверки: —
- Выполненные критерии: —
- Непроверенное, блокеры и отклонения от плана: —
- Итоговый статус и дата: —

## 11. Отчёт QA

Не проводилась.

## Рекомендация модели исполнителя

Предпочтительно **gpt-6.1-sol, high**. Сложный рефакторинг общего мира и сохранение gameplay: gpt-6.1-sol, high. Это качественная оценка соотношения затрат и качества по доступному списку моделей и риску задачи, без утверждений о точных тарифах. Для этой серверной серии экономичная модель без запаса на архитектуру и проверки не рекомендуется.
