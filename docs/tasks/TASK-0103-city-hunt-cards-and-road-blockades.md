# TASK-0103: Карты города: полиция, перекрытия и серверные способности

- Статус: draft
- Приоритет: high
- Создана: 2026-10-16
- Обновлена: 2026-10-16
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Нужны согласованная физика, динамические маршруты, безопасный спавн и атомарные ресурсы.
- Зависимости: TASK-0102 — требуется done

## 1. Цель и запрос пользователя

Подключить 5 настоящих серверных карт города к общему физическому миру и AI: размещать police, закрывать любой пригодный конец дороги, ставить шипы, переключать сигнал и назначать перехват. Получить ограниченные безопасные эффекты, реплицируемые всем участникам.

Исходный запрос: второй режим «за город», подключение к серверу с 3 гонщиками; за 2 минуты поймать игроков, размещать police перетаскиванием карточек, высокий обзор всей карты, полное перекрытие любого конца дороги и дополнительные подходящие способности. Конкретное правило «поймать всех 3 / один выжил — победа команды racers»,4 connections, costs/TTL/cooldowns и пять карт — решения автора для согласованного MVP.

Обязательный самостоятельный контекст: [дизайн режима](../knowledge/city-hunt-mode-design.md), [серверный ADR](../knowledge/multiplayer-server-adr.md), отчёт QA TASK-0096. Задание понятно без истории чата при наличии репозитория и этих документов.

## 2. Проверенный контекст

Проверено 2026-10-16, HEAD 3598b662375a613f822e011b46a8e92555a12a9c, main. Исследовано текущее рабочее дерево. Уже есть чужие staged/unstaged/untracked изменения, включая src/traffic.js, src/traffic-ai.js, src/city-boundary.js, package.json, AGENTS.md, инструменты задач и документы. Не откатывать и не включать их в свой коммит; перед реализацией повторить git status. Стек: Three.js 0.180.0, cannon-es 0.20.0, Vite 7.1.9; npm test/build/dev существуют.

| Файл / символ | Наблюдение в текущем коде | Зачем исполнителю |
| --- | --- | --- |
| src/start-screen.js / createStartScreen | City disabled, coming-soon | Включение реальной роли |
| src/main.js / startGame, PerspectiveCamera, newRound | Follow camera/fog и локальный игровой цикл | Режимы и presentation |
| src/arrest-system.js / createArrestSystem | Цель literal player, 2+5 с, damage 1 отменяет арест | Захват отдельного гонщика без иммунитета |
| src/traffic.js / createVehicleRuntime, registerRole, requestSpawn, cancelSpawn | Общий NPC runtime, singleton player | Спавн и мир с несколькими гонщиками |
| src/vehicle-spawn.js / findSafeSpawnPose | Exact/nearest-safe, pending | Ограниченное ожидание спавна |
| src/police-pursuit.js / createPolicePursuit | Физические steering/throttle controls | Цели полиции |
| src/traffic-signals.js / createTrafficSignals | Фазы вычисляются от времени | Временный all-red override |
| src/city-generator.js / createCityPlan, src/city-layout.js / containsCityPoint | Нерегулярная seed-based карта | IDs, граница, камера и размещение |
| src/vehicle.js / CarSimulation, STEP | 120 Hz, cannon, общий world | Серверная физика |
| tools/multiplayer-spike/server.js / DrivingSpikeRoom | maxClients 3, body на каждую сессию | Нельзя использовать как готовый сервер 3+1 |

Production server/ и src/network/ сейчас отсутствуют. Новые пути из раздела 3 — ожидаемый результат TASK-0097–0101 или данного этапа; они ещё не существуют. TASK-0096 blocked после QA, TASK-0097–0101 draft. Поэтому эта задача draft. После done зависимостей сверить фактические интерфейсы, файлы и команды, исправить устаревшие точки входа и только затем переводить в ready. Не обходить блокеры независимого QA прототипа.

## 3. Область изменений

Новые src/simulation/city-card-actions.js, city-road-closures.js, city-effect-registry.js, card-placement.js; simulation core/config/protocol после 0102; src/traffic.js, traffic-ai.js/traffic-planner.js/traffic-signals.js, police-pursuit.js, vehicle-spawn.js, vehicle.js только через совместимые hooks. Новые tests/city-card-actions.test.js, city-road-closures.test.js, city-card-lifecycle.test.js. Визуальную card tray/камеру оставить 0104, physics engine не менять, game-template не трогать.

Сохранять offline/free-drive поведение и лимит трёх гонщиков, текущую физику, управление и визуальные defaults. Область задачи — конкретный этап второго режима. Равноценные новые имена файлов допускаются с синхронизацией документации, контрактов и следующих задач.

## 4. Требуемое поведение

Обязателен весь docs/knowledge/city-hunt-mode-design.md, особенно таблица 5 карт, размещение, network lifecycle и реальные замечания ADR. Balance values перенести без расхождений в общий versioned config, не писать разные cooldown в UI/server.

1. Patrol:2 энергии/cooldown4 с,1 police на 30 с, telegraph1.5 с, lane snap≤6 м, безопасный yaw/height. Активные+reserved police≤6, auto police spawn отключён только в city-hunt. Начальная цель ближайший active racer; последующая policy по режиму, без пересоздания отдельного world/runtime. Pending не может ждать неограниченно.
2. Roadblock:3/14 с, cap2, telegraph1.5 с, TTL12 с. Target stable(edgeId,nodeId) поддерживает оба конца каждого пригодного undirected road segment. Collider поперёк полного road+sidewalk passage, толщина 1 м/высота 2.5 м и inset=roadWidth/2+1 м; не закрыть соседние въезды перекрёстка и не оставить объезд по тротуару. За геометрическим исключением дать конкретный reason. CANNON collider и bidirectional graph closure одной tick-транзакцией, один routingVersion. AI всех ролей перепланирует/ждёт/разворачивается безопасно, не телепортируется и не продолжает путь сквозь барьер.
3. Spikes:3/16 с, cap2, telegraph1.5 с/TTL10 с. Swept road crossing racer применяет temporary grip×0.7,power×0.75 на 3 с, без instantaneous velocity mutation/удаления колеса/здоровья. Refresh без stack, multi-racer hit независим, police/civilian immune. Compose transient modifier поверх прежних tuning/damage; после expiry/round cleanup параметры исходные.
4. Red-light:1/10 с, cap1, warning0.5 с/TTL8 с; только controlled intersection, все подходы красные. Civilian obey stop line, гонщики управляются как прежде, police emergency policy продолжает погоню. Override истекает к phase(now), не reset clock и не permanent all-red.
5. Intercept:2/10 с, cap1, TTL8 с. Marker active racer, до 2 nearest operational/unreserved police (distance thenID), current приказ не перехватывать новой дублирующей командой.0 подходящих →reject без расхода; пойманная цель освобождает приказ, нет respawn/boost/teleport. По окончании снять override.
6. Общий reserve→warning→revalidate→activate/commit→expire/cancel. Occupancy/geometry всех игроков/логических и физических NPC/props/effects, safety12 м от active racer, swept horizon1.5 с/clearance2 м; активация проверяет свежую occupancy+0.25 с. Unsafe initial/cancelled pending не тратит энергию/cooldown, cancel получает retry backoff2 с; commit atomically расходует reservation и включает cooldown. Shutdown/round finish отменяют pending и cleanup без stale callbacks в новом roundId.
7. Replication включает target/effect phase/activation/expiry/actual snapped pose и per-racer debuff. Клиент не выбирает цену/collider/actorId/police velocity. Дублирующиеся requestId/late retries не создают second entity; full snapshot содержит долговечное текущее состояние, а не только одноразовые FX. City full-map view не расширяет server physical zones за union трёх racer bodies.

## 5. План для исполнителя

1. Сверить executor/DTO/config после done0102, общие obstacle/route hooks и collision parity после 0097.
2. Выделить canonical endpoint registry и placement validators на фактической topology; проверить оба конца и короткие segments.
3. Подключить police spawn lease и real barrier/graph mask, затем swept spikes/transient multipliers, signal override и intercept.
4. Связать lifecycle/reservations с hand controller и snapshots; cleanup/idempotency/round reset без утечек.
5. Провести integration fixtures всех 5 карт и physics traversal tests, записать факты/ограничения, передать ready-for-qa.

## 6. Критерии готовности

- [ ] Все 5 карт создают именно описанное server gameplay действие с единой ценой/cooldown/TTL и caps, никакого mock success.
- [ ] Barrier физически блокирует всю ширину и тротуар, graph закрыт в обе стороны и открыт после TTL; оба конца дороги доступны.
- [ ] Реальные машины/шипы/сигналы/police targets соблюдают правила и не появляются поверх racers или props.
- [ ] Refund/reservation/duplicate/cancelled old epoch/cleanup соблюдены; LOD union не зависит от city camera.
- [ ] Обязательные проверки ниже выполнены; фактические результаты и ограничения записаны.
- [ ] Отчёт заполнен; исполнитель передал ready-for-qa и синхронизировал INDEX. done ставит только независимый QA.

## 7. Проверки

### Автоматические

npm test; npm run build; node --test tests/city-card-actions.test.js tests/city-road-closures.test.js tests/city-card-lifecycle.test.js. Fixture seeds20261005/20261006/20261007, road widths12/15/30; оба конца всех fixture edges и malformed/stale IDs. Для barrier тестировать настоящие CarSimulation approach/sidewalk bypass collision, graph parity и rebuild после expiry; swept high-speed racer crosses entire strip за 1tick; concurrent racers; damaged tuning+modifier restore; red expiry vs baseline phase; no-free-police mode; cap6 с pending. Не считать render ghost доказательством server collider.

Рабочая директория — корень CarWars. При подготовке документа игровые тесты и сборка не запускались, код не менялся. Новые test files/runners — требования к реализации, сейчас их нет. Команды сервера сверить после done зависимостей: будущий npm run server:start сейчас не существует. Для финальной квитанции использовать актуальный tools/verify.js, если он остаётся применим; старые удалённые Telegram tools не восстанавливать.

### Ручные

Сервер и 4 SDK sessions, временный debug placement client допускается вместо будущей tray. Всем одновременно видны одинаковые effect IDs/times; вмешать moving racer во время 1.5 с warning — unsafe активация отменена. Проехать в перекрытие обеими полосами/по тротуару, после 12 с проезд доступен; проверки шипов, traffic red и intercept. Это backend integration, visual/touch проверка ожидает 0104.

Независимый QA повторяет обязательные сценарии самостоятельно. Тесты, сборка, screenshot и реальное устройство — разные виды подтверждения. Недоступный обязательный сценарий блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Проверенные факты — раздел 2 и контекст дизайна. Предложения автора: city-hunt-v1, пять карт, экономика энергии, командные условия победы, grace 15 с, safety и TTL. Это исходный детерминированный MVP; баланс матчами не проверен. Использовать принятую мультиплеерную основу и описанный контракт, не выбирать весь стек заново.

Невыполненная зависимость не допускает ready. Если core/server/protocol после TASK-0097–0101 расходится с дизайном, записать расхождение и обновить задание до разработки. Изменения требований 120 с, 3+1 и серверной authority согласовать. Не уменьшать число гонщиков/NPC и не переводить всех NPC в физическую симуляцию из-за камеры города. Локальный fake backend не заменяет сервер. Публичный хостинг, аккаунты, монетизация, случайная колода и туман войны не входят.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0103-city-hunt-cards-and-road-blockades.md в CarWars. Прочитай AGENTS.md, задание целиком, docs/knowledge/city-hunt-mode-design.md и актуальный multiplayer ADR. Задача draft: проверь done зависимостей, сверь реальные core/room/protocol и обнови контекст; только после этого переведи ready. Реализуй указанный этап, сохрани offline/free-drive, выполни автоматические и обязательные ручные проверки, заполни раздел 10. После разработки передай ready-for-qa и синхронизируй INDEX; done ставит независимый QA с собственным разделом 11. Недоступные обязательные проверки укажи как блокер. Не откатывай и не коммить чужие изменения; соблюдай исключения AGENTS.md для CLI-вызовов.
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

Предпочтительно **gpt-6.1-sol, high**. Нужны согласованная физика, динамические маршруты, безопасный спавн и атомарные ресурсы. Это качественная оценка по доступному списку моделей и сложности, без утверждений о точных тарифах. Возможностей модели достаточно при готовой мультиплеерной основе, явном контракте и перечисленных проверках.
