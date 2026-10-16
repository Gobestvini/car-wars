# TASK-0102: Режим города: серверные роли 3+1 и раунд на две минуты

- Статус: draft
- Приоритет: high
- Создана: 2026-10-16
- Обновлена: 2026-10-16
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Роли, сетевые транзакции и гонки финала матча требуют уверенного разбора серверной архитектуры.
- Зависимости: TASK-0101 — требуется done

## 1. Цель и запрос пользователя

Ввести server-authoritative режим city-hunt-v1: город как четвёртая сессия без машины против трёх гонщиков, серверный раунд 120 с, захват и итог. Подготовить контракт hand/cards для следующего этапа. Сейчас city — отключённая заглушка, полноценная multiplayer основа ещё не внедрена.

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

Будущие server/rooms/driving-room.js, src/simulation/game-world.js и src/network/protocol.js после 0097–0101; новые src/simulation/city-hunt-round.js, city-card-state.js, city-mode-config.js; tests/city-hunt-round.test.js, city-hunt-roles.test.js, city-card-state.test.js. Existing arrest-system.js/police-pursuit.js — только совместимое расширение targetId/mode policy. Не реализовывать physical effects, city UI/camera, аккаунты или публичный deploy.

Сохранять offline/free-drive поведение и лимит трёх гонщиков, текущую физику, управление и визуальные defaults. Область задачи — конкретный этап второго режима. Равноценные новые имена файлов допускаются с синхронизацией документации, контрактов и следующих задач.

## 4. Требуемое поведение

Прочитать весь docs/knowledge/city-hunt-mode-design.md. Этот документ — обязательные правила, не предложение исполнителю заново выбирать игровой дизайн.

1. Mode-bound capacities: free-drive остаётся 3 racers, city-hunt допускает 1 city+3 racers (maxClients4). Суммарный cap не заменяет role cap. City не addPlayer(CarSimulation); у него отдельный director record. Атомарные join/reservation, отказ второй city/четвёртому racer/пятому участнику. Racer не может отправить cityCard, city не может drive; role не доверять message body.
2. Waiting/countdown3 с/active120 с/finished, map-ready и 4 readiness; старт только city, race double-start безопасна. До активной фазы новые карточки запрещены. Countdown отменяется при уходе участника. Активная фаза пользуется монотонным server deadline, не накоплением simulation dt; скрытая вкладка и stalls не удлиняют матч. На 120000 мс время выигрывает спор с новым capture, финал ровно один.
3. City выигрывает, когда все 3 captured/forfeited до deadline, racers — если хотя бы 1 active по истечению. Capture через per-player arrest2 с holding+5 с arrest с реальным targetId и police clear path. Chase profile3 действует с начала режима без необходимости нарушать ПДД. Destroyed damage1 не даёт immunity, но сама поломка не считается арестом. Сохранить прежнюю free-drive arrest/damage/wanted policy.
4. Captured input/respawn/rejoin не воскрешают. Cleanup body/contacts/targets после capture на безопасном tick, racer остаётся spectating session. Disconnect15 с и явно заданные forfeit правила/readiness/rematch из дизайна; время продолжает идти. Round epoch и stale commands не влияют на следующий матч. Restart процесса не восстанавливает утраченный ephemeral матч.
5. Регистрировать 5 card definitions из таблицы дизайна (patrol/roadblock/spikes/red-light/intercept), energy4/max8/+1 каждые 3 с, reservations/cooldown/result cache/retry backoff. Контроллер hand требует executor interface; на этом этапе live executor unavailable возвращает feature-unavailable без расхода. Fake executor в unit tests проверяет транзакции; это не доказательство физических способностей. UI city-hunt не включать до 0104.
6. Предложенный контракт: createCityHuntRound({clock,roster,world,config}), advance(nowMs,events), ready/start/leave/disconnect/reconnect/playCard/snapshot/dispose. Подстроить точные interfaces к принятой основе, сохранив ownership. Card IDs/config immutable/versioned, таймеры числовые server times, никаких приватных Node/CANNON объектов в DTO. Snapshot включает phase/deadline/result/captured/forfeit/hand/effects reservations, доступен reconnect. requestId idempotency bounded256 и replay watermark,2 новых card commands/s,8 queued.

## 5. План для исполнителя

1. После done0101 сверить actual core/rooms/protocol и blockers0096; обновить контекст и только затем ready. Не строить новый production room на tools/multiplayer-spike.
2. Выделить config/round FSM и role roster; применить независимый clock, наблюдать completion после world step.
3. Адаптировать per-player arrest и mode chase eligibility, отложенный cleanup тела и запрет captured respawn.
4. Добавить hand command controller/DTO и executor contract без live side effects; покрыть duplicates/refund/epoch.
5. Проверить free-drive3 и city-hunt3+1 реальным SDK; записать результаты и ready-for-qa.

## 6. Критерии готовности

- [ ] Room capacity и role authorization реально работают для 4 SDK-сессий; city body не существует, free-drive не получил 4-го гонщика.
- [ ] 120 с, countdown,119999/120000/120001 мс adjudication, один outcome и независящий от FPS deadline подтверждены clock tests.
- [ ] Все 3 захвата/выхода/повторного входа, destroyed arrest, captured spectate/respawn и city/racer disconnect соответствуют дизайну.
- [ ] Snapshot/reconnect/idempotency/energy reservations стабильны; недоступные world effects не расходуют энергию.
- [ ] Обязательные проверки ниже выполнены; фактические результаты и ограничения записаны.
- [ ] Отчёт заполнен; исполнитель передал ready-for-qa и синхронизировал INDEX. done ставит только независимый QA.

## 7. Проверки

### Автоматические

Из корня npm test; npm run build. Создать и выполнить node --test tests/city-hunt-round.test.js tests/city-hunt-roles.test.js tests/city-card-state.test.js. Clock tests без настоящего ожидания 120 с: stale phase, repeated finish,15 с grace, countdown cancel, stall/drop debt, энергия+regen/cap и same requestId/different payload. Role tests используют настоящие server/SDK после 0098, не только fake transport; assert body count=3, role counts и гонку последнего места. Новые test files — результат этой задачи, сейчас их нет.

Рабочая директория — корень CarWars. При подготовке документа игровые тесты и сборка не запускались, код не менялся. Новые test files/runners — требования к реализации, сейчас их нет. Команды сервера сверить после done зависимостей: будущий npm run server:start сейчас не существует. Для финальной квитанции использовать актуальный tools/verify.js, если он остаётся применим; старые удалённые Telegram tools не восстанавливать.

### Ручные

После actual server:start из 0098 подключить 4 SDK clients,2 из них претендуют на city: допускается только один. Один короткий серверный матч 120 с с браузером-наблюдателем из существующего multiplayer UI; скрыть city tab/остановить render клиента — deadline продолжается. Full city presentation ещё отсутствует, не выдавать этот этап за playable mode.

Независимый QA повторяет обязательные сценарии самостоятельно. Тесты, сборка, screenshot и реальное устройство — разные виды подтверждения. Недоступный обязательный сценарий блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Проверенные факты — раздел 2 и контекст дизайна. Предложения автора: city-hunt-v1, пять карт, экономика энергии, командные условия победы, grace 15 с, safety и TTL. Это исходный детерминированный MVP; баланс матчами не проверен. Использовать принятую мультиплеерную основу и описанный контракт, не выбирать весь стек заново.

Невыполненная зависимость не допускает ready. Если core/server/protocol после TASK-0097–0101 расходится с дизайном, записать расхождение и обновить задание до разработки. Изменения требований 120 с, 3+1 и серверной authority согласовать. Не уменьшать число гонщиков/NPC и не переводить всех NPC в физическую симуляцию из-за камеры города. Локальный fake backend не заменяет сервер. Публичный хостинг, аккаунты, монетизация, случайная колода и туман войны не входят.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0102-city-hunt-server-round-and-roles.md в CarWars. Прочитай AGENTS.md, задание целиком, docs/knowledge/city-hunt-mode-design.md и актуальный multiplayer ADR. Задача draft: проверь done зависимостей, сверь реальные core/room/protocol и обнови контекст; только после этого переведи ready. Реализуй указанный этап, сохрани offline/free-drive, выполни автоматические и обязательные ручные проверки, заполни раздел 10. После разработки передай ready-for-qa и синхронизируй INDEX; done ставит независимый QA с собственным разделом 11. Недоступные обязательные проверки укажи как блокер. Не откатывай и не коммить чужие изменения; соблюдай исключения AGENTS.md для CLI-вызовов.
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

Предпочтительно **gpt-6.1-sol, high**. Роли, сетевые транзакции и гонки финала матча требуют уверенного разбора серверной архитектуры. Это качественная оценка по доступному списку моделей и сложности, без утверждений о точных тарифах. Возможностей модели достаточно при готовой мультиплеерной основе, явном контракте и перечисленных проверках.
