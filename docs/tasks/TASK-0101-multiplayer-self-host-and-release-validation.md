# TASK-0101: Подготовить запуск игрового сервера и итоговую проверку мультиплеера

- Статус: blocked
- Приоритет: high
- Создана: 2026-10-14
- Обновлена: 2026-10-23
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Развёртывание, нагрузка, интеграционная приёмка и интерпретация рисков: gpt-6.1-sol, high.
- Зависимости: TASK-0100 — требуется done

## Актуальная сверка 2026-10-23

Эта сверка имеет приоритет над историческим baseline и будущими путями ниже. Проверены исходники рабочего дерева поверх `5416e88`; чужие локальные изменения не являются завершённой частью этого задания. Общая карта выпуска: [что осталось до сетевого релиза](../knowledge/multiplayer-release-readiness.md).

**Уже реализовано:** Уже есть Dockerfile/compose/Caddy, hosted HTTPS/WSS preview, health/capacity и bounded metrics; сохранены ARM64 и public smoke/browser результаты 18 октября.

**Остаётся:** Зависимость TASK-0100 не завершена. Нужны origin allowlist, readiness/draining и проверенный bounded shutdown, 20 lifecycle циклов, sizing двух комнат/default 102+police/stress300, итоговая gameplay/browser/network матрица и независимый QA. Физический телефон и текущая версия публичной выкладки сегодня не проверялись.

**Статус `blocked`:** частично реализовано, продолжение и приёмка зависят от перечисленных незавершённых этапов; это не пустой черновик и не готовый релиз.

Архитектурное уточнение: запрет online solver ниже относится к первоначальному server-only варианту. С 2026-10-18 выбран и реализован non-authoritative client prediction/reconciliation, см. [план](../knowledge/multiplayer-server-plan.md) и [проверки prediction](../knowledge/multiplayer-client-prediction.md). Authority, AI, damage и игровые транзакции остаются серверными. Первоначальный no-go TASK-0096 нельзя автоматически применять к текущему клиенту; его отрицательные измерения сохранены как история, а итоговые budgets всё ещё требуют проверки. Не менять стек и не удалять prediction ради выполнения устаревшего текста.

Обновление после QA0097, 2026-10-23: общий offline/hosted core `src/simulation/{game-world,vehicle-runtime}.js` принят, включая police/wanted/arrest/repair/props causality. Room adapters — `tools/multiplayer-spike/{server,deploy/server}.js`, клиент — `src/multiplayer/{game,room-client,frame-codec,snapshot-buffer,prediction,prediction-world}.js`; прежний `world.js` сохраняется для research harness. Не повторять перенос core; текущие остатки этой задачи сохраняются. [Контракт core](../knowledge/multiplayer-shared-core.md). Автопроверки: `node tools/verify.js --full` и соответствующие `tools/multiplayer-spike/tests/*`; не восстанавливать удалённый Telegram verifier.

Прежние пустые отметки критериев означают отсутствие полной приёмки, а не отсутствие всей реализации. Исторические артефакты 18–19 октября перечислены в общей карте; чтение этих отчётов не считается новым запуском тестов или новой QA-приёмкой.

## 1. Цель и запрос пользователя

Получить воспроизводимый self-host комплект и подтверждение полного сценария трёх игроков с server physics/AI, включая нагрузку и восстановление соединения. Публичное развёртывание по невыбранному адресу не выполняется.

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

Dockerfile игрового сервера, compose.yaml или deploy/multiplayer/**, .env server example без секретов, README.md, VERIFICATION.md, docs/knowledge/multiplayer/**, server health/limits/graceful shutdown, tools/multiplayer-load/**, package scripts и релевантные tests/**. game-template, Telegram, аккаунты/leaderboards/Redis/cluster не входят.

Сохранить offline single-player, visual defaults и текущие модели/управление; не трогать game-template и соседние оптимизационные задачи. Возможные равноценные имена файлов допускаются с обновлением документации и зависимых заданий, без расширения поведения.

## 4. Требуемое поведение

Задокументировать offline dev, online client+server dev, production build/start, env URL, ports, Node/package versions, WSS reverse proxy пример и Docker image с pinned compatible base. Нельзя положить server secret в VITE_* или browser bundle. Клиент HTTPS соединяется по WSS; разрешённые origins конфигурируются и неправильные отклоняются. Health отвечает без secrets, readiness не допускает join при draining/shutdown.

Конфиг max rooms/clients и admission при перегрузке по измерениям; одну комнату не распределять по разным processes. SIGTERM отключает admission, сообщает clients, закрывает sockets/worlds/intervals за bounded timeout. Процесс restart теряет ephemeral комнаты: понятный error и создание новой, без обещаний persistence. Invite code — доступ по ссылке, не authenticated identity; reconnect token отдельно.

Нагрузка default3 игрока+102 civilians+полиция по ADR, минимум5мин после warmup; стресс300 и несколько комнат отдельными профилями. Собрать p50/p95/p99 полного substep и scheduler, serialization/wire bytes, debt, CPU, GC/RSS/heap и entity/body/listener counts. Бюджеты плана: p95≤6мс,p99≤8.33мс для substep, wire≤150KiB/s/client, heap последних2мин≤10% при описанном GC методе. Если ADR обоснованно меняет budgets, сохранить сравнительные исходные результаты; нельзя считать нижнюю NPC нагрузку достаточным pass.

Изоляция: две комнаты с разным seed, disconnect одной/вредный client не влияет на другую. Lifecycle20 create/join/leave/dispose циклов без residual bodies/timers. Итоговая матрица три устройства/LAN, keyboard/touch, latency profiles из0100, full/late join/reconnect/props/repair/wanted/arrest/respawn; подтвердить server authority с выключенным browser physics/AI. Финальный release только после независимого QA; недоступные ручные проверки не объявлять выполненными.

## 5. План для исполнителя

1. После done0100 собрать actual commands/config/contracts в единую эксплуатационную документацию.
2. Добавить контейнеризацию, proxy пример, health/readiness/admission/shutdown и проверку client bundle на secrets.
3. Создать bounded load runner с настоящими SDK clients и archived raw metrics.
4. Провести single-room default/stress и measured multi-room tests, определить рекомендуемую capacity конкретного hardware.
5. Пройти итоговую browser matrix, записать ограничения и передать ready-for-qa независимому QA.

## 6. Критерии готовности

- [ ] Чистое окружение запускается по README, контейнер и WSS smoke проверены, server/client config разделены.
- [ ] Default workload соответствует budget либо воспроизводимый blocker не позволяет выдать release за готовый.
- [ ] Shutdown/admission/origin/version ошибки понятны; room lifecycle и изоляция выдерживают интеграционные тесты.
- [ ] Итоговая gameplay/network/browser матрица подтверждена артефактами и готова к независимому QA.
- [ ] Обязательные проверки ниже выполнены и записаны фактически; ограничения и невыполненные пункты перечислены.
- [ ] Отчёт заполнен; после разработки статус ready-for-qa и INDEX синхронизированы. done разрешён только независимому QA.

## 7. Проверки

### Автоматические

Рабочая директория — корень CarWars, кроме явно указанного prefix.

npm test; npm run build; npm run server:start (из0098); docker compose config и docker compose build/run согласно принятому пути compose. Добавить tests/multiplayer-lifecycle.test.js и выполнить node --test tests/multiplayer-lifecycle.test.js. Добавить npm run multiplayer:load и выполнить documented default/stress/multiroom profiles с реальными SDK/transport. Наличие Docker проверить заранее; если недоступен, контейнерная приёмка blocked, не объявлять её pass.

Во время подготовки тесты приложения не запускались: код не менялся. Новые commands/files выше являются требованиями к исполнителю, не утверждением об их существовании сейчас. Для существующих suite failures отделить baseline failures от регрессии, не исправлять соседние проблемы без необходимости. npm/pnpm доступны; не переустанавливать зависимости без причины.

### Ручные

Обязательно3 независимых клиента, минимум2 устройства/браузера и touch viewport; 5мин совместной езды, late join после разрушения prop, repair race, арест/respawn одного, fourth full, reconnect, HTTPS/WSS через настроенный proxy, остановка/рестарт сервера, offline без server. Физический телефон и удалённый hosting проверять только если доступны; отдельно назвать ограничения.

QA повторяет обязательные сценарии независимо; артефакт исполнителя помогает воспроизводимости, не заменяет приёмку. Недоступная обязательная проверка явно блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Факты baseline — раздел2. Авторские решения — общий план: 1–3 игрока, max seat3, shared civilian/police world, personal wanted/respawn, shared pickups/props, no online browser solver, server120Hz. Будущий ADR может уточнить измеренные budgets/DTO; значимое изменение authority/физики или game rules согласовать и обновить зависимые задачи.

Предположение: MVP без аккаунтов и persistence, LAN/self-host сначала; публичный deploy и выбор платного сервера не входят. Домены/credentials не нужны для подготовки локального комплекта. При отсутствии done зависимости/ADR оставить draft или blocked с причиной; не начинать реализацию на недоказанном интерфейсе. Конфликт с актуальными чужими правками, несовместимость server physics или невозможный performance/latency budget требует конкретного воспроизведения/вариантов решения, а не молчаливого обхода. Не снижать NPC count и не удалять gameplay для фиктивного pass.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0101-multiplayer-self-host-and-release-validation.md в CarWars. Прочитай AGENTS.md, задание целиком и docs/knowledge/multiplayer-server-plan.md; после TASK-0096 также принятый ADR. Проверь актуальный код, локальные изменения и done зависимостей. Для draft сначала сверить результат зависимостей и перевести задачу в ready. Внеси изменения только в указанных границах, проведи автоматические и обязательные ручные проверки и заполни отчёт. Передай ready-for-qa, синхронизируй INDEX.md; done ставит независимый QA. При блокере запиши воспроизведение и необходимое решение. Не включай чужие изменения в commit/push; учитывай исключения AGENTS.md для CLI executor/QA.
```

## 10. Отчёт исполнителя

### Сверка и возобновление, 2026-10-23

- Результат: Уже есть Dockerfile/compose/Caddy, hosted HTTPS/WSS preview, health/capacity и bounded metrics; сохранены ARM64 и public smoke/browser результаты 18 октября.
- Оставшиеся требования/блокеры: Зависимость TASK-0100 не завершена. Нужны origin allowlist, readiness/draining и проверенный bounded shutdown, 20 lifecycle циклов, sizing двух комнат/default 102+police/stress300, итоговая gameplay/browser/network матрица и независимый QA. Физический телефон и текущая версия публичной выкладки сегодня не проверялись.
- Проверено сейчас: чтение перечисленных исходников, тестов и сохранённых отчётов; статусы синхронизированы с INDEX. Это не полная игровая приёмка.
- Изменённые файлы: эта задача, INDEX и общая карта выпуска. Реализация следующего подэтапа и его собственные проверки отражаются в TASK-0110.
- Исторические проверки: см. ссылки общей карты; не объявлены повторёнными сегодня.
- Итоговый статус: `blocked`, 2026-10-23. `done` только после выполнения остатка и независимого QA.

## 11. Отчёт QA

Не проводилась.

## Рекомендация модели исполнителя

Предпочтительно **gpt-6.1-sol, high**. Развёртывание, нагрузка, интеграционная приёмка и интерпретация рисков: gpt-6.1-sol, high. Это качественная оценка соотношения затрат и качества по доступному списку моделей и риску задачи, без утверждений о точных тарифах. Для этой серверной серии экономичная модель без запаса на архитектуру и проверки не рекомендуется.
