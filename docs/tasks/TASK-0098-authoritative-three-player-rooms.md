# TASK-0098: Создать authoritative серверные комнаты на трёх игроков

- Статус: draft
- Приоритет: high
- Создана: 2026-10-14
- Обновлена: 2026-10-14
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Сетевой lifecycle, безопасность ввода и физическое время: gpt-6.1-sol, high.
- Зависимости: TASK-0096 — требуется done; TASK-0097 — требуется done

## 1. Цель и запрос пользователя

Подключить headless мир к принятому серверному framework, чтобы три сессии отправляли только ввод и получали единое серверное состояние. Клиент не может изменить физику, damage или AI сообщением.

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

server/**, src/network/protocol.js и общие validators, tests/multiplayer-room.test.js, tests/multiplayer-protocol.test.js, package.json и актуальный lockfile, server env example без секретов. Core можно расширять только для lifecycle/DTO из ADR. Игровой browser UI и hosting не входят.

Сохранить offline single-player, visual defaults и текущие модели/управление; не трогать game-template и соседние оптимизационные задачи. Возможные равноценные имена файлов допускаются с обновлением документации и зависимых заданий, без расширения поведения.

## 4. Требуемое поведение

На комнату один world, maxPlayers3 с reconnect reservations. Создание с серверным config/seed, join по roomId/code, атомарный seat allocation, возможность зайти в идущую комнату; загрузочная сессия имеет timeout и не получает активную машину до map-ready. Сервер проверяет protocol/build/map version, отправляет full state, online клиент не выбирает tuning/traffic count из localStorage.

Реализовать input/ack/roundId/events по плану и ADR, bounded input queue, finite ranges и message limits. Персона определяется сессией; forged actorId, transform, wanted или dt не влияют на состояние. Монотонные seq, замещение input и acknowledgement имеют тестируемую семантику. Neutral/brake после250 мс молчания, 60 msg/s и1KiB для input либо точные пересмотренные значения ADR с причиной.

Scheduler на monotonic time с fixed STEP120, bounded catch-up, независимым patchRate20/AI10. Не исполнять physics в message handler. Метрики tick debt, world duration, clients, bodies, wire и queue. Slow client не приводит к бесконечной bufferedAmount; ошибки одного клиента/комнаты изолированы. Unknown/oversized messages не падают в solver.

При disconnect neutral немедленно, 15с reserved seat/physical body; reconnect token привязан к одной комнате/сессии и истекает. Явный leave освобождает тело/target; empty room закрывается после reservations, dispose очищает intervals/core. Rejoin после истечения — новый игрок/full snapshot. Graceful room shutdown предупреждает клиентов, reconnect на перезапущенном процессе не обещает сохранение исчезнувшего мира.

## 5. План для исполнителя

1. Сверить версии/API принятого ADR и core после done зависимостей; записать scripts server:dev/server:start.
2. Создать room adapter, DTO/schema и join/map-ready/input handlers; обеспечить одну authority.
3. Подключить scheduler, snapshots, durable state/events и пределы очередей.
4. Реализовать reconnect/leave/cleanup и capacity race tests с настоящим SDK/transport.
5. Прогнать adversarial inputs, изоляцию двух комнат и записать результаты.

## 6. Критерии готовности

- [ ] Три настоящие SDK-сессии управляют независимыми машинами, четвёртая получает full error; гонка последнего места не создаёт четвёртое тело.
- [ ] Server snapshots всех клиентов описывают один мир, late join содержит pickups/props/damage и актуальную карту.
- [ ] Неверные/повторные/чужие команды не меняют authority, stale input тормозит; spam не ломает комнату.
- [ ] Reconnect сохраняет playerId до grace, после timeout/leave слот освобождён, две комнаты не делят bodies/state.
- [ ] Обязательные проверки ниже выполнены и записаны фактически; ограничения и невыполненные пункты перечислены.
- [ ] Отчёт заполнен; после разработки статус ready-for-qa и INDEX синхронизированы. done разрешён только независимому QA.

## 7. Проверки

### Автоматические

Рабочая директория — корень CarWars, кроме явно указанного prefix.

npm test; npm run build; node --test tests/multiplayer-room.test.js tests/multiplayer-protocol.test.js. Новые suites должны запускать реальный выбранный server и SDK на ephemeral port, закрывать sockets/rooms и не зависать. Fake timers допустимы для grace boundary, capacity/transport обязательно проверяются интеграционно. Новые npm run server:dev/server:start — контракт этой задачи, записать точное назначение в README.

Во время подготовки тесты приложения не запускались: код не менялся. Новые commands/files выше являются требованиями к исполнителю, не утверждением об их существовании сейчас. Для существующих suite failures отделить baseline failures от регрессии, не исправлять соседние проблемы без необходимости. npm/pnpm доступны; не переустанавливать зависимости без причины.

### Ручные

Запустить сервер и три SDK-клиента, отключить сеть одного, вернуть через5с, повторить после16с. Первый возврат сохраняет машину; второй требует нового join. Отправить некорректный ввод тестовым клиентом; остальные продолжают получать state. Проверить empty-room cleanup по метрикам.

QA повторяет обязательные сценарии независимо; артефакт исполнителя помогает воспроизводимости, не заменяет приёмку. Недоступная обязательная проверка явно блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Факты baseline — раздел2. Авторские решения — общий план: 1–3 игрока, max seat3, shared civilian/police world, personal wanted/respawn, shared pickups/props, no online browser solver, server120Hz. Будущий ADR может уточнить измеренные budgets/DTO; значимое изменение authority/физики или game rules согласовать и обновить зависимые задачи.

Предположение: MVP без аккаунтов и persistence, LAN/self-host сначала; публичный deploy и выбор платного сервера не входят. Домены/credentials не нужны для подготовки локального комплекта. При отсутствии done зависимости/ADR оставить draft или blocked с причиной; не начинать реализацию на недоказанном интерфейсе. Конфликт с актуальными чужими правками, несовместимость server physics или невозможный performance/latency budget требует конкретного воспроизведения/вариантов решения, а не молчаливого обхода. Не снижать NPC count и не удалять gameplay для фиктивного pass.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0098-authoritative-three-player-rooms.md в CarWars. Прочитай AGENTS.md, задание целиком и docs/knowledge/multiplayer-server-plan.md; после TASK-0096 также принятый ADR. Проверь актуальный код, локальные изменения и done зависимостей. Для draft сначала сверить результат зависимостей и перевести задачу в ready. Внеси изменения только в указанных границах, проведи автоматические и обязательные ручные проверки и заполни отчёт. Передай ready-for-qa, синхронизируй INDEX.md; done ставит независимый QA. При блокере запиши воспроизведение и необходимое решение. Не включай чужие изменения в commit/push; учитывай исключения AGENTS.md для CLI executor/QA.
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

Предпочтительно **gpt-6.1-sol, high**. Сетевой lifecycle, безопасность ввода и физическое время: gpt-6.1-sol, high. Это качественная оценка соотношения затрат и качества по доступному списку моделей и риску задачи, без утверждений о точных тарифах. Для этой серверной серии экономичная модель без запаса на архитектуру и проверки не рекомендуется.
