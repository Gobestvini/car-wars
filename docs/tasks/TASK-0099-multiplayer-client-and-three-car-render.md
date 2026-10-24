# TASK-0099: Подключить онлайн-режим и отображение трёх игроков

- Статус: done
- Приоритет: high
- Создана: 2026-10-14
- Обновлена: 2026-10-24
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Интеграция крупного main.js, модели и lifecycle: gpt-6.1-sol, high.
- Зависимости: TASK-0097 — требуется done; TASK-0098 — требуется done

## Актуальная сверка 2026-10-24

Эта сверка имеет приоритет над историческим baseline и будущими путями ниже. Проверены исходники рабочего дерева поверх `3a2d253`; чужие локальные изменения не являются завершённой частью этого задания. Общая карта выпуска: [что осталось до сетевого релиза](../knowledge/multiplayer-release-readiness.md).

**Результат:** завершены персональный online HUD wanted/arrest, create/join/invite, keyboard/touch, cancel подключения/загрузки/reconnect, retry и cleanup клиента. Исправлены пять выявленных независимым QA lifecycle/startup дефектов. Общая физика, AI и gameplay остаются серверными; выбранный non-authoritative prediction сохранён.

**Статус `done`:** независимый QA принял24 октября:23 client/snapshot/prediction +6 server/room,16 браузерных сценариев и отдельные reproducer/cleanup/offline/high-low; финальный Linux full437/437+build. [Окончательный QA](../knowledge/multiplayer/2026-10-24-client/qa-clock/README.md). Старые отрицательные результаты сохранены в разделах10–11.

**Остаётся до сетевого выпуска:** TASK-0100 — сглаживание и полная network/browser матрица; TASK-0101 — эксплуатация/нагрузка/релиз. Физический телефон, WAN budgets и capacity не объявлены проверенными этим этапом; публичный игровой сервер автоматически не обновлялся.

Архитектурное уточнение: запрет online solver ниже относится к первоначальному server-only варианту. С 2026-10-18 выбран и реализован non-authoritative client prediction/reconciliation, см. [план](../knowledge/multiplayer-server-plan.md) и [проверки prediction](../knowledge/multiplayer-client-prediction.md). Authority, AI, damage и игровые транзакции остаются серверными. Первоначальный no-go TASK-0096 нельзя автоматически применять к текущему клиенту; его отрицательные измерения сохранены как история, а итоговые budgets всё ещё требуют проверки. Не менять стек и не удалять prediction ради выполнения устаревшего текста.

Обновление после QA0097/0098, 2026-10-23: общий offline/hosted core `src/simulation/{game-world,vehicle-runtime}.js` принят, включая police/wanted/arrest/repair/props causality. Room adapters — `tools/multiplayer-spike/{hosted-room,room-clock,server,deploy/server}.js`, клиент — `src/multiplayer/{game,room-client,frame-codec,snapshot-buffer,prediction,prediction-world}.js`; прежний `world.js` сохраняется для research harness. Не повторять перенос core; текущие остатки этой задачи сохраняются. [Контракт core](../knowledge/multiplayer-shared-core.md), [map-ready/build/limits](../knowledge/multiplayer-rooms.md). RoomClient подтверждает карту после async presentation callback и гейтит input до ready; новый wire требует presentation6/build carwars-ws-6. Автопроверки: `node tools/verify.js --full` и соответствующие `tools/multiplayer-spike/tests/*`; не восстанавливать удалённый Telegram verifier.

Прежние пустые отметки критериев означают отсутствие полной приёмки, а не отсутствие всей реализации. Исторические артефакты 18–19 октября перечислены в общей карте; чтение этих отчётов не считается новым запуском тестов или новой QA-приёмкой.

## 1. Цель и запрос пользователя

Дать пользователю создать общую карту, подключить ещё двух игроков по ссылке/коду и ездить с общими NPC. Сейчас стартовый экран запускает только локальную игру.

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

src/network/room-client.js, src/network/actor-presenter.js, src/main.js, src/start-screen.js, src/start-screen.css, src/style.css, index.html, src/vehicle-visuals.js и существующие effects adapters, tests/multiplayer-client.test.js и browser harness. Не менять серверные правила под предпочтения клиента; оптимизацию latency выполнитьTASK-0100.

Сохранить offline single-player, visual defaults и текущие модели/управление; не трогать game-template и соседние оптимизационные задачи. Возможные равноценные имена файлов допускаются с обновлением документации и зависимых заданий, без расширения поведения.

## 4. Требуемое поведение

Добавить понятные действия «Одиночная игра», «Создать комнату», «Присоединиться» и копирование invite link/code, occupancy1/3–3/3. Состояния idle/connecting/map-loading/playing/reconnecting/full/version-error/offline-error/leaving с cancel/retry; сообщения на языке текущего UI. При full не пересаживать в другую комнату молча. URL server задаётся env/config, reconnect secret не включать в публичную invite ссылку.

Online main не запускает CarSimulation solver, traffic.prepare/stepWorld, wanted/arrest/repair или AI и не newRound локально. Рендер города создаётся по серверному seed/config/signature без local world, actor presenter создаёт модель на entityId/generation. Все три игрока имеют раздельные transforms/wheels/damage/deformation/appearance и различимые метки/цвета; камера/скорость/wanted/arrest принадлежат local player. NPC/полицейские, оторванные колёса, dynamic props и pickups отображаются по authoritative DTO, effects не меняют world.

Keyboard/джойстик создают согласованный input, local heading/speed из state для directionalInput. На blur/hidden/cancel отправить neutral; сервер продолжает работать, возвращение восстанавливает state. Настройки online только visual/camera; power/grip/roadWidth/traffic/police server-owned выключены с объяснением. R/restart — серверный personal respawn, создание новой карты только новая комната. Free camera не останавливает мир, ввод neutral.

Применять full state позднего join/reconnect без повторного воспроизведения всех исторических взрывов; durable destroyed props/колёса восстановлены. Cleanup leave/retry освобождает meshes/pools/events/network listeners и не дублирует loop. Offline workflow не требует работающего game server.

## 5. План для исполнителя

1. После done0097/0098 проверить snapshot DTO и actual presenter API, обновить контекст и ready.
2. Добавить connection controller с cancellation/generation guard и start screen flows.
3. Выделить online presentation branch; offline оставить на core adapter, online authority не запускать.
4. Подключить player/NPC models, effects, per-player HUD, input и respawn command.
5. Пройти три браузера/desktop-mobile-viewports, ошибки join и 10 leave/rejoin; записать browser артефакт.

## 6. Критерии готовности

- [x] Три браузера видят одну карту, всех игроков/NPC/светофоры и независимое управление; четвёртый видит full.
- [x] Столкновение игроков/AI, повреждение, repair, props destruction, розыск и арест синхронны по server tick/state.
- [x] Online не выполняет authoritative physics/AI (разрешённый prediction сохранён), R одного игрока не меняет карту/остальных; blur не останавливает сервер.
- [x] UI cancel/error/retry/reconnect работает; offline запускается без сервера, lifecycle не копит машины/listeners.
- [x] Обязательные проверки ниже выполнены и записаны фактически; ограничения и невыполненные пункты перечислены.
- [x] Отчёт заполнен; после разработки статус ready-for-qa и INDEX синхронизированы. done разрешён только независимому QA.

## 7. Проверки

### Автоматические

Рабочая директория — корень CarWars, кроме явно указанного prefix.

npm test и npm run build; node --test tests/multiplayer-client.test.js. Добавить проверку online branch без solver/AI ticks и input lifecycle, DTO-to-actor isolation, duplicates eventId. Browser harness три isolated contexts должен сравнивать server snapshot/tick и map signatures, а не только screenshots; точную команду записать в отчёт/README.

Во время подготовки тесты приложения не запускались: код не менялся. Новые commands/files выше являются требованиями к исполнителю, не утверждением об их существовании сейчас. Для существующих suite failures отделить baseline failures от регрессии, не исправлять соседние проблемы без необходимости. npm/pnpm доступны; не переустанавливать зависимости без причины.

### Ручные

Обязательно 3 браузерных контекста, минимум2 независимых устройств/браузеров для LAN smoke, один390×844 с джойстиком. Создать/поделиться/подключить, совместная езда, удар player-player, гонка repair, разрушенные props до late join, индивидуальные арест/respawn, fourth full, menu/free camera/hidden tab, reconnect и10 leave/join циклов. Low/high визуально сохранить.

QA повторяет обязательные сценарии независимо; артефакт исполнителя помогает воспроизводимости, не заменяет приёмку. Недоступная обязательная проверка явно блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Факты baseline — раздел2. Авторские решения — общий план: 1–3 игрока, max seat3, shared civilian/police world, personal wanted/respawn, shared pickups/props, no online browser solver, server120Hz. Будущий ADR может уточнить измеренные budgets/DTO; значимое изменение authority/физики или game rules согласовать и обновить зависимые задачи.

Предположение: MVP без аккаунтов и persistence, LAN/self-host сначала; публичный deploy и выбор платного сервера не входят. Домены/credentials не нужны для подготовки локального комплекта. При отсутствии done зависимости/ADR оставить draft или blocked с причиной; не начинать реализацию на недоказанном интерфейсе. Конфликт с актуальными чужими правками, несовместимость server physics или невозможный performance/latency budget требует конкретного воспроизведения/вариантов решения, а не молчаливого обхода. Не снижать NPC count и не удалять gameplay для фиктивного pass.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0099-multiplayer-client-and-three-car-render.md в CarWars. Прочитай AGENTS.md, задание целиком и docs/knowledge/multiplayer-server-plan.md; после TASK-0096 также принятый ADR. Проверь актуальный код, локальные изменения и done зависимостей. Для draft сначала сверить результат зависимостей и перевести задачу в ready. Внеси изменения только в указанных границах, проведи автоматические и обязательные ручные проверки и заполни отчёт. Передай ready-for-qa, синхронизируй INDEX.md; done ставит независимый QA. При блокере запиши воспроизведение и необходимое решение. Не включай чужие изменения в commit/push; учитывай исключения AGENTS.md для CLI executor/QA.
```

## 10. Отчёт исполнителя

### Реализация, 2026-10-23

- Персональный online HUD: warning/звёзды, holding/arresting/arrested, серверные progress/time, personal respawn кнопкой или R. Источник — gameplay DTO локальной sessionId; клиент не выполняет wanted/arrest/repair/AI. Разрешённый non-authoritative prediction сохранён.
- Connection phases, cancel до SDK admission и во время map-loading, generation guard на запоздалый room/callback, full/version/offline errors и retry. Invite содержит только публичный roomId.
- Leave/retry освобождают timers, room message/signal listeners, transfer buffers, prediction, frame/gameplay/event history, city/props/pickups/models; cloned police geometry освобождается. Один page-owned render loop, DOM listeners отменяются при pagehide; shared GPU assets освобождаются при завершении страницы.
- Меню/свободная Orbit camera/hidden/blur/pointer cancel дают neutral; сервер продолжает шагать. Online физика/город/traffic/police серверные, это объяснено в меню. Offline branch сохранён.
- Изменения: src/multiplayer/{room-client,transfers,game,hud,style}; tests/multiplayer-client.test.js и multiplayer-client-browser.cjs; задача/INDEX и относящиеся KB/артефакты. Чужие staged/unstaged файлы не включаются.
- `Node22.23.3 --test tests/multiplayer-client.test.js`:5/5. Реальный SDK map-loading cancel/retry и neutral input, ранняя отмена/late room, пересекающиеся попытки, ошибки, local HUD/events.
- `Node22 tests/multiplayer-client-browser.cjs`:12 сценариев, без page errors. Edge + Chrome на одном Windows-компьютере; сервер по LAN IPv4, три контекста/default102 civilian,390×844 touch emulation/low и desktop/high. Общая езда/удар, repair race, destroyed prop late join, fourth full, личный арест/respawn, menu/free camera/hidden, reconnect,10 leave/join, обе отмены/retry, offline. [Фактический JSON/скриншоты/команда](../knowledge/multiplayer/2026-10-24-client/README.md).
- Физический телефон и WAN/performance не заявлены: задание допускает два независимых браузера; network budgets и VPS release относятся к0100/0101. Нужен независимый повтор обязательных сценариев.
- `node tools/verify.js --full` на optimized Node22 дважды не прошёл: неизменённый city-boundary.test.js native exit2147483651/3221225477, отдельно V8 `Check failed: IsHeapObject()`; в первом suite room queue timeout, повторно room5/5 прошёл, во втором traffic-pooling Invalid array length. Изменённый client suite прошёл в обоих. Общий optimized suite не объявлен успешным; исходные журналы сохранены в .git/task0099-*.log; [durable `.txt` копии](../knowledge/multiplayer/2026-10-24-client/windows-history/README.md) добавлены при четвёртой QA. Отдельная диагностика `node --no-opt --test` всего root suite и optimized Vite build ещё выполняется; её результат будет дописан. Это не performance pass и причина нативного отказа не установлена.

### Исправление QA-0099-1, 2026-10-24

- SDK0.18.5 retryReconnection не сохраняет timer handle и не перепроверяет enabled в уже запланированном callback. RetireRoom отключает reconnect/queued messages и заменяет reconnect на public connection уже покинутой комнаты безопасным no-op; этот единственный SDK callback может дойти до исполнения, но открыть транспорт уже не может. CONNECTING socket также закрывается. SDK/node_modules и глобальные таймеры не меняются.
- Новый real SDK regression: drop→reconnecting→leave до retry→ожидание1400мс: старый socket остаётся закрытым; fresh join работает. Отдельно проверен connecting transport и очистка buffered messages. Optimized Node22 client suite6/6.
- Независимая первая приёмка и её major defect сохранены в разделе11. Требуется новая независимая приёмка исправления.
- Готовится отдельный optimized Node22.23.3 ARM64 Linux Docker full suite/build в изолированном контейнере без опубликованных портов/изменения live сервисов. Диагностический Windows no-opt suite не является финальной квитанцией: код клиента изменён после его старта.

### Исправление QA-0099-2 и async welcome, 2026-10-24

- После await leave/retire повторно проверяется connectionEpoch: старый snapshot error и старый connect catch не могут менять phase/status новой комнаты. Аналогичный post-await guard добавлен в presentation error path.
- welcomeEpoch инвалидируется при drop/leave и новом welcome. Старый async map/presentation callback не отправляет устаревший map-ready nonce и не показывает свою ошибку после нового handshake. Presentation callback также инвалидируется при reconnect.
- Optimized Node22 client suite8/8: новый real SDK regression задерживает old leave через paused server TCP, подключает свежую комнату, затем освобождает старый ack и проверяет сохранённые playing/active/status; ещё один дважды разрывает соединение при незавершённом async welcome и проверяет единственный актуальный handshake.
- Простой повтор unit без affinity дал native AV самого Node даже в client suite; на affinity CPU0 optimized8/8 прошли. Это не доказывает аппаратную/optimizer причину. Финальный `node tools/verify.js --full` запущен на CPU0 (availableParallelism1, обычный optimization, все test files последовательно) на окончательном source; результат дополняется после завершения. Linux baseline full продолжает проверять предыдущий source и не будет выдан за квитанцию этого исправления.

### Исправления QA-0099-3/4, 2026-10-24

- Метки чужих игроков получают свободный ordinal1/2 среди живых visuals, с двумя разными фонами. После3→2→3 новая сущность освобождённый номер переиспользует, оставшийся игрок свою метку сохраняет; «Вы» отдельно. Исходные модели/материалы автомобиля сохранены.
- Необходимое для cold connect исправление существующего room adapter: inherited patch/simulation timers выключаются сразу после super.onCreate, синхронно перед await map ready; собственные cadence запускаются после HostedState/metrics. Initial lastTime/accumulator сбрасываются в момент запуска, время инициализации не считается physics debt. Physics/gameplay/wire rules не менялись.
- Добавлены регрессии замены третьего игрока и real SDK cold create с принудительной250мс готовностью карты: до ready нет physics ticks/premature patches, после ready102 civilian и playing/faults0. Optimized Node22 адресно10/10.
- Финальный полный current Windows прогон CPU0 тоже failed: native AV3221225477 в city-boundary,city-layout,traffic-pooling (425pass/3fail), поэтому affinity не является доказанным исправлением runtime. Linux baseline до последних исправлений:433/433 +build7.17с, артефакты [linux](../knowledge/multiplayer/2026-10-24-client/linux/receipt.json). Это baseline, не квитанция окончательного source. После новой независимой проверки потребуется финальный Linux full/build.

### Исправление startup clock после полного прогона, 2026-10-24

- Первый полный Linux-прогон окончательного на тот момент source завершился436/437 за1102с; build пропущен из-за failed test. Единственный отказ — map-ready fixture. [Полные журналы и отрицательная квитанция](../knowledge/multiplayer/2026-10-24-client/linux-final/receipt.json), [raw tests](../knowledge/multiplayer/2026-10-24-client/linux-final/full-tests.txt). Отдельный single-CPU повтор воспроизвёл отказ, поэтому объяснение перегрузкой отвергнуто.
- Время Colyseus clock начиналось до await sim.ready. Первый tick после cold map startup начислял время инициализации уже созданному loading timer. Диагностический disposable probe с одним clock.start() перед cadence прошёл прежний map-ready test; production/test deadlines не увеличивались. Исправление запускает room clock вместе с hosted cadence после готовности карты.
- Cold-create regression усилен:2500мс ожидание карты, loading deadline1600мс и ещё250мс async presentation после welcome. Инициализация не расходует лимит загрузки нового клиента; ранних patch/physics callbacks по-прежнему быть не должно. Старые варианты250мс в отчётах выше — история предыдущих проверок.
- Первый Windows targeted повтор снова завершился nativeAV вclient suite и отдельным timed-command fixture timeout; положительным прогоном не считается. Проверка перенесена на оптимизированный Linux Node22.23.3; результат и новая независимая приёмка дополняются после завершения.

### Итоговые проверки source после clock repair, 2026-10-24

- Linux optimized Node22.23.3:client10+room5=15/15. Финальный обычный `node tools/verify.js --full`:437/437,0fail,1171.702с; production build8.95с. [Квитанция и полный raw export](../knowledge/multiplayer/2026-10-24-client/linux-clock/README.md), [8/8 SHA-256](../knowledge/multiplayer/2026-10-24-client/linux-clock/source-match.json). CPU1/1536MiB/cpuset0/availableParallelism1 — ограничение тестового стенда, не обещание server capacity. Live сервисы не изменялись.
- Финальный source заморожен после clock.start/усиленного regression; прежние отрицательные квитанции сохранены. Windows full положительным не объявлен; Linux receipt относится именно к своему экспорту/платформе, не подменяет root matchingReceipt.
- Новая независимая QA и окончательный статус записываются отдельно в разделе11. Публичный игровой сервер этим этапом не обновляется; release/network gates остаются0100/0101.

### Предыдущая сверка (история)


### Сверка и возобновление, 2026-10-23

- Результат: src/multiplayer/game.js и room-client.js уже дают 3D город, create/join/invite, три машины, управление keyboard/touch, damage/dents/props, personal respawn и reconnect. Задачи 0107–0109 приняты QA 19 октября.
- Оставшиеся требования/блокеры: Зависимости TASK-0097/0098 не завершены: не отображаются отсутствующие серверные police/wanted/arrest. Repair реализован и принят QA в TASK-0110. Нужны cancel во время connect/map-loading, полноценный cleanup и матрица минимум двух независимых устройств/браузеров.
- Проверено сейчас: чтение перечисленных исходников, тестов и сохранённых отчётов; статусы синхронизированы с INDEX. Это не полная игровая приёмка.
- Изменённые файлы: эта задача, INDEX и общая карта выпуска. Реализация следующего подэтапа и его собственные проверки отражаются в TASK-0110.
- Исторические проверки: см. ссылки общей карты; не объявлены повторёнными сегодня.
- Итоговый статус: `blocked`, 2026-10-23. `done` только после выполнения остатка и независимого QA.

## 11. Отчёт QA

### Независимая приёмка 2026-10-24 — changes-requested

Отдельный QA-подагент применил qa-tasks, прочитал актуальный diff поверх HEAD `6fe6491cb21fed3db45e50dbf3a7147e6fa557c3`; [SHA-256 проверенных файлов](../knowledge/multiplayer/2026-10-24-client/qa/checked-files.json). Реализацию не менял, commit/push не выполнял. Решение: **in-progress / Возврат QA: да** из-за воспроизводимого дефекта критерия 4 (cancel/reconnect и cleanup). После исправления требуется повторная независимая приёмка.

**QA-0099-1, major — отменённый reconnect снова открывает старый сокет.** В `src/multiplayer/room-client.js`, leave(), выключение reconnection.enabled и removeAllListeners не отменяют уже запланированный SDK retryReconnection. Реальный SDK/server reproducer: создать RoomClient, дождаться playing; для стабильного окна установить у room reconnection.minUptime=0 и minDelay=maxDelay=1000; завершить соответствующий server WebSocket через ref.terminate(); дождаться phase=reconnecting; вызвать client.leave(); подождать1800мс. Ожидается: старый transport остаётся закрыт. Фактически: сразу idle/room=null/oldOpen=false/enabled=false, затем SDK пишет reconnection successful и old.connection.isOpen=true. Сервер всё ещё держит одного player, connected=false (снятый onReconnect не отправляет hello/map-ready). Причина подтверждена чтением SDK: setTimeout не проверяет enabled повторно. [Результат](../knowledge/multiplayer/2026-10-24-client/qa/reconnect-cancel.json), [самостоятельный reproducer](../knowledge/multiplayer/2026-10-24-client/qa/reconnect-cancel.mjs). Требуются обезвреживание отложенного reconnect/закрытие transport и регрессионный тест cancel в reconnecting.

**Проверки и критерии:**

- Optimized Node22.23.3 `--test tests/multiplayer-client.test.js`:5/5, два адресных запуска QA; [лог](../knowledge/multiplayer/2026-10-24-client/qa/client-test.txt).
- Независимая адаптация browser runner: Edge+Chrome, три изолированных контекста, LAN IPv4,102 civilian по умолчанию. Все12 базовых сценариев прошли, pageerror=[]: server-applied keyboard/touch, player-player collision/damage, repair race (один победитель), destroyed prop до late join без исторических effects, fourth full, личные wanted/holding/arresting/arrested/respawn, menu/free camera/hidden neutral при продолжающемся tick, обычный reconnect/full state,10 leave/join, cancel admission/map-loading/retry, offline start. Сверялись server states/revisions и map signatures. Основной passed runner не включает обнаруженный отдельным reproducer дефект.
- После каждого из10 leave: models=0, city/prediction/timers отсутствуют, transfer/listener removers=null, scene children=3; renderer.info.memory стабильно11 geometry/12 texture (shared page assets), роста нет.
- Дополнительно визуально проверен [арест390×844](../knowledge/multiplayer/2026-10-24-client/qa/portrait-arrested.png): banner x8..218 и toolbar x257..382 не перекрываются; restart button полностью внутри viewport. Это изменение viewport подключённой страницы; touch joystick отдельно проверен в mobile Chrome context. Физического телефона не было.
- Отдельный синтетический pagehide smoke: все canvas/document listeners сняты; window resize/keydown/keyup/blur сняты, page-owned loop остановлен; models/city/prediction/timers очищены, pageerror=[]. Renderer counters58/13 →1/1; нулевое освобождение GPU/OS по ним не заявляется. [CDP inventory](../knowledge/multiplayer/2026-10-24-client/qa/pagehide.json).
- Чтение online branch подтверждает разрешённый non-authoritative prediction; authority/AI/gameplay остаются серверными. Личный respawn сохранил signature и generation другого игрока. Offline загружается своей веткой.
- Общий optimized verifier дважды failed: city-boundary native exit2147483651/3221225477, V8 IsHeapObject; также traffic-pooling RangeError, один room timeout затем прошёл отдельно5/5. Это отдельные от QA-0099-1 отказы: city-boundary test не импортирует изменённые client-модули,0099 соответствующий код не меняла. Причина native/V8 не доказана; общий suite не passed. Диагностический no-opt suite и следующий build ведущего ещё pending; не выданы за успешную optimized-квитанцию. QA второй полный suite параллельно не запускал.

**Ограничения:** полная приёмка не состоялась. Физический телефон/WAN/performance не проверены; два независимых браузера на одном Windows ПК покрывают разрешённую браузерную LAN-матрицу. Отдельный целевой player-AI collision, detached-wheel late join и точное межклиентское сравнение traffic-signal phase в этом прогоне не выделялись отдельными assert и дополнительно доказанными не объявлены. Production build pending ведущего. [Команды и полный перечень QA-артефактов](../knowledge/multiplayer/2026-10-24-client/qa/README.md).

### Независимая повторная приёмка исправления 2026-10-24 — changes-requested

Новый отдельный QA-подагент повторно прочитал задание/правила и актуальный diff поверх `6fe6491cb21fed3db45e50dbf3a7147e6fa557c3`, не менял реализацию. [SHA-256](../knowledge/multiplayer/2026-10-24-client/qa-rework/checked-files.json), [команды, артефакты и ограничения](../knowledge/multiplayer/2026-10-24-client/qa-rework/README.md). Предыдущий отчёт и major сохранены выше.

**QA-0099-1 исправлен:** прежний real-SDK reproducer через1800мс даёт defect=false, oldOpen=false/serverConnected=false. Новый client suite6/6 optimized Node22.23.3. В Edge дополнительно проверен реальный CONNECTING socket: немедленная UI cancel закрыла transport0→3, очистила buffered messages; через1800мс reconnecting=false, новая create имеет свежий roomId. Решение ограничено покинутым экземпляром connection; SDK/global timers не меняются. Исходный scheduled callback может один раз выполнить no-op, заново открыть транспорт не может.

**Проверенные сценарии критериев1–4:** независимый расширенный Edge+Chrome LAN runner прошёл16 сценариев,3 isolated contexts/default102 civilian,390×844 touch/low и1440×900/high, pageerror=[]. Повторены create/invite/join/общая signature, independent keyboard/joystick и applied server input, player-player damage, отдельное столкновение player-AI с damage-enabled police NPC и репликацией его damage, один победитель repair race, durable prop и detached wheel до late join без исторических effects. Все3 клиента сравнили12 signal approaches при одном authoritative tick и текущие rendered phases. Четвёртый видит full. Подтверждены personal wanted/holding/arresting/arrested/respawn без изменения map/чужой generation, menu/free camera/hidden neutral при продолжающемся server tick, обычный reconnect, обе ранние отмены и retry. UI cancel reconnect после drop с ожиданием1700мс не восстановил старый transport; следующая create дала другой roomId/sessionId.

После всех10 leave:0models, transfer/listener removers=null,3scene children, renderer counters стабильно11geometry/12texture. Повторный synthetic pagehide удалил canvas/document listeners и игровые window resize/keydown/keyup/blur; city/models/prediction/timers очищены, page-owned loop останавливается; counters57/13→1/1. Освобождение памяти ОС не заявляется. Отдельный offline без game server/с endpoint127.0.0.1:1 прошёл обычный PLAY, local tick4→184,0game-server requests/pageerrors; сохранён кадр игрового мира. Визуально просмотрены high/low и portrait arrest: banner/toolbar не перекрываются, restart внутри viewport.

**Автоматические и архитектурные:** client6/6 и snapshot/prediction13/13 optimized22 прошли в новом QA. DTO copy/isolation, generation/deletion и input authority whitelist подтверждены. По чтению ветки online authoritative GameWorld/AI/wanted/arrest/repair FSM не создаются; разрешённый актуальной постановкой non-authoritative prediction solver сохранён. Duplicate eventId/исторические events проверены client unit и late join. Source во время приёмки заморожен; production Windows optimized build ведущего passed. Полная optimized-квитанция отдельного Linux ARM64 verifier пока ожидается; Windows optimized и диагностический no-opt failed не объявлены passed.

**Ограничения среды:** физический телефон/WAN/performance не проверялись; разрешённую браузерную матрицу обеспечивают Edge+Chrome на одном Windows ПК. Node22 native WebSocket при дополнительном synchronous CONNECTING close остался readyState2/CLOSING через1800мс, isOpen=false/buffered0/fresh join passed; за CLOSED не выдан, реальный Chromium case выше достиг CLOSED3. Ошибки первого QA fixture (civilian baseline damage=false и debug-bypassed PLAY) явно описаны и сохранены в артефактах; финальные исправленные fixture passed. Общая квитанция ещё ожидается; новый воспроизводимый major ниже требует возврата независимо от неё.

**QA-0099-2, major — запоздалая ошибка старой комнаты ломает успешный retry.** Критерий4, `src/multiplayer/room-client.js`, error callback `listenSnapshots`: после `await leave()` отсутствует проверка актуальной connectionEpoch/комнаты. Шаги на реальном SDK/server: войти; при snapshot error задержать server-side приём leave через `peer.ref._socket.pause()` и отправить ошибочный transfer-start (bytes0); после немедленного idle нажать «Создать комнату»; дождаться playing/ready=true в новой комнате; возобновить старый socket. Ожидается: запоздалое завершение старой операции не меняет статус новой. Фактически новая roomId остаётся прежней, active=true, но phase становится offline-error, presentation ready=false, message='Invalid snapshot transfer', акторы перестают рендериться. Причина не ограничена malformed transfer: тот же callback обрабатывает rejection verifyMap/onWelcome; malformed header служит детерминированным trigger ошибки без правки реализации.

Отдельные воспроизведения: [Node JSON](../knowledge/multiplayer/2026-10-24-client/qa-rework/stale-error-retry.json), [Node код](../knowledge/multiplayer/2026-10-24-client/qa-rework/stale-error-retry.mjs), [Edge JSON](../knowledge/multiplayer/2026-10-24-client/qa-rework/stale-error-retry-browser.json), [Edge код](../knowledge/multiplayer/2026-10-24-client/qa-rework/stale-error-retry.cjs), [кадр](../knowledge/multiplayer/2026-10-24-client/qa-rework/stale-error-retry.png). Требуются защита async continuation старого error/leave от новых connect/cancel и regression для slow leave acknowledgement + успешного retry. QA исходники не исправлял. **Решение: changes-requested, возврат in-progress/Возврат QA: да; после исправления нужна следующая независимая приёмка. QA-0099-1 при этом закрыт.** Успех16 базовых/расширенных browser cases не заменяет этот failed case. Общая Linux optimized-квитанция ещё pending; даже её успех не устраняет QA-0099-2.

### Третья независимая приёмка 2026-10-24 — changes-requested

Новый отдельный QA-подагент применил qa-tasks, повторно прочитал задание/правила и актуальный client diff, реализацию не менял. Проверено семь client/test файлов по [SHA-256](../knowledge/multiplayer/2026-10-24-client/qa-final/checked-files.json); [финальная сверка](../knowledge/multiplayer/2026-10-24-client/qa-final/frozen-source.json)7/7 совпала. HEAD рабочего дерева во время QA изменился сторонним коммитом с6fe6491 на3a2d2536c5a89bc60f80fb6bd84030122d58a4d2, проверенные исходники остались замороженными. [Команды, подробные результаты и ограничения](../knowledge/multiplayer/2026-10-24-client/qa-final/README.md). Предыдущие QA-отчёты сохранены выше. Решение: **in-progress / Возврат QA: да**; нужна новая независимая приёмка после исправлений.

**QA-0099-1 и QA-0099-2 закрыты в этой проверке.** Optimized Node22.23.3 client/snapshot/prediction suite21/21 (client8+snapshot/prediction13). Реальный SDK scheduled reconnect после cancel через1800мс не открыл старый transport, serverConnected=false. Отдельный старый paused-TCP error/leave reproducer в Node и Edge теперь даёт defect=false: новая roomId/playing/active сохраняются; Edge ready=true/pageerror=[], old error message не заменяет новый status. Два drop при незавершённом async welcome прошли8-м SDK тестом; source read подтверждает connectionEpoch post-await guards и welcomeEpoch на drop/leave/new welcome. DTO/generation/event/input authority проверки прошли; разрешённый prediction не является локальным authoritative AI/gameplay.

**QA-0099-3, medium — повторная подпись игроков после3→2→3.** Раздел4 (различимые метки/цвета), критерий1; `src/multiplayer/game.js`, makeVisual использует текущее число player models для текста. Шаги: A создаёт комнату, B и C входят; у A видны Вы/Друг2/Друг3. B выходит; дождаться удаления его модели; B снова входит свежей sessionId. Ожидается: оба чужих игрока различимы. Фактически у A обе разные машины подписаны «Друг3», обе метки голубые#9ddfff, сами машины одинаковые жёлтые. Подтверждено реальным Edge/тремя isolated contexts, фактическим CanvasTexture текстом и визуально просмотренным [кадром](../knowledge/multiplayer/2026-10-24-client/qa-final/label-rejoin.png), [JSON](../knowledge/multiplayer/2026-10-24-client/qa-final/label-rejoin.json), [runner](../knowledge/multiplayer/2026-10-24-client/qa-final/label-rejoin.cjs); pageerror=[]. Требуются устойчивая уникальная метка/цвет для присутствующих actorId и regression на churn; исходное место кода предшествовало текущей правке, но требование задачи осталось невыполненным.

**QA-0099-4, major — cold/slow room startup может уронить server process.** Критерий4/create/retry и обязательный smoke. Два отдельных реальных pagehide/CONNECTING browser fixture завершились до клиента исключением HostedDrivingRoom.onBeforePatch→fault→disconnect `cannot disconnect during onCreate()`; второй повтор с fixed seed42. [Первый лог](../knowledge/multiplayer/2026-10-24-client/qa-final/pagehide-first-failure.txt), [повтор](../knowledge/multiplayer/2026-10-24-client/qa-final/pagehide.txt). Ожидается: создание комнаты завершается либо возвращает обрабатываемую клиентом ошибку, сервер остаётся жив. Фактически процесс Node завершился exit1 при старте комнаты. По чтению текущих `tools/multiplayer-spike/{server,hosted-room}.js`: super.onCreate запускает inherited patch50мс/simulation timer перед `await this.sim.ready`; Hosted state/metrics.patchIntervals создаются после await, patch успевает обратиться к ещё не готовым Hosted полям и fault вызывает запрещённый Colyseus disconnect. Это отдельный server baseline race, не доказанная регрессия семи client-файлов; требуется убрать таймеры из async startup окна и cold/delayed-ready regression. QA реализацию не исправлял.

**Фактические ограничения и оставшиеся gates:** offline отдельным Vite без game server/endpoint127.0.0.1:1 прошёл обычный PLAY, tick3→185,0 game endpoint requests/pageerrors; [кадр](../knowledge/multiplayer/2026-10-24-client/qa-final/offline-playing-high.png) просмотрен. Основной16-case Edge+Chrome LAN runner прерван после более6мин без первых PNG/итогового JSON и без подключения к game server; причина не установлена, начальное ограничение browser CPU могло повлиять. Его16 сценариев не объявлены пройденными новым QA; сохранён stdout, добавлены stage timestamps для следующего запуска. Pagehide/listener smoke not-run из-за startup failures; QA2 success не подменяет новый прогон. Собственные зависшие runner/process trees остановлены. Physical phone/WAN/performance/high-low acceptance не выполнены в этом прогоне.

Текущий стандартный optimized Windows Node22.23.3 `tools/verify.js --full` ведущего наCPU0 завершился425passed/3failed: native exit3221225477 city-boundary/city-layout/traffic-pooling; tests1/build=null/ok=false, положительной matchingReceipt нет. [Квитанция](../knowledge/multiplayer/2026-10-24-client/qa-final/full-receipt-failed.json), [результат](../knowledge/multiplayer/2026-10-24-client/qa-final/full-verifier-failed.txt). Affinity не решила native failures, причина не установлена. Linux baseline433/433+build относится к source доQA-0099-2, финальным gate не считается. Общий suite и обязательный браузерный повтор остаются незакрытыми независимо от новых воспроизводимых дефектов; после исправлений необходима следующая независимая приёмка на окончательном source. Commit/push QA-подагент не выполнял.

### Четвёртая независимая приёмка 2026-10-24 — changes-requested

Новый отдельный QA-подагент применил qa-tasks и проверил diff поверх HEAD `3a2d2536c5a89bc60f80fb6bd84030122d58a4d2`. Реализацию не изменял, commit/push не выполнял. [Проверенные файлы](../knowledge/multiplayer/2026-10-24-client/qa-accept/checked-files.json), [сверка8/8 до возврата в разработку](../knowledge/multiplayer/2026-10-24-client/qa-accept/frozen-source.json), [команды/артефакты/ограничения](../knowledge/multiplayer/2026-10-24-client/qa-accept/README.md). Предыдущая история QA сохранена. **Итог: changes-requested, in-progress / Возврат QA: да.** Финальный Linux full failed436/437 выявил новый startup clock дефект, независимо воспроизведённый QA ниже. После исправления необходима следующая независимая приёмка и новый успешный full/build.

**Предыдущие QA-0099-1–4 закрыты в адресных проверках.** Client/snapshot/prediction 23/23, optimized Node22.23.3: client10, включая real SDK forced250ms map-ready (tick0/0early patch до ready,102civilian/playing/faults0 после), stale async error/paused old leave и два drop при pending welcome. Reconnect cancel через1800ms не открывает transport; новый Node и Edge stale-error reproducer сохраняет свежую комнату playing/ready/active с defect=false. Label3→2→3 в реальном Edge сохраняет «Друг2», выдаёт replacement «Друг1» и разные CanvasTexture RGB157/223/255 и201/244/156; local «Вы»255/226/156, defect=false/pageerror=[]. [JSON](../knowledge/multiplayer/2026-10-24-client/qa-accept/label-rejoin.json), [PNG](../knowledge/multiplayer/2026-10-24-client/qa-accept/label-rejoin.png) просмотрен.

**Критерии1–4:** независимый расширенный Edge+Chrome LAN runner16/16, exit0/pageerror=[], три isolated contexts/default102civilian,390×844touch/low и1440×900high. Сравнены signature/server state/tick: keyboard/joystick, player-player и player-AI collision/damage, repair race с одним winner, durable destroyed prop и detached wheel latejoin без historical effects,12signal approaches на трёх clients при общем authoritative time, четвёртый full, личные wanted/holding/arresting/arrested/respawn без изменения карты/чужой generation, menu/freecam/hidden neutral и живой tick, reconnect/fullstate,10leave/join, отмена reconnect/admission/map-loading, retry. [Browser JSON](../knowledge/multiplayer/2026-10-24-client/qa-accept/browser-report.json).

После всех10leave: models0, transfer/listener removers=null, scene children3, renderer11geometry/12texture стабильно. Отдельный real CONNECTING cancel0→CLOSED3, buffer0, reconnecting=false через1800ms; свежий create работает. Synthetic pagehide снимает canvas/document и игровые window resize/keydown/keyup/blur listeners; models/city/prediction/timers очищены, renderer58/13→1/1, pageerror=[]. Это счётчики Three.js, не утверждение об освобождении памяти ОС. Offline отдельно без game server/с endpoint127.0.0.1:1: обычный PLAY, tick3→188,0game requests/pageerrors; [кадр](../knowledge/multiplayer/2026-10-24-client/qa-accept/offline-playing-high.png) просмотрен. High/low и portrait arrest просмотрены: баннер x8..218 и toolbar x257..382 не перекрываются, restart внутри viewport. Физический телефон/WAN/performance не проверялись; два браузера соответствуют разрешённой LAN-матрице.

Source review подтверждает server authority/AI/gameplay и разрешённый prediction; HUD local sessionId/серверный respawn, post-await connectionEpoch/welcomeEpoch guards и cleanup. Номера labels освобождаются при удалении старых visuals до создания новых. Hosted inherited timers остановлены синхронно до await ready, own cadence после state/metrics, lastTime/accumulator reset. Это устранило старый early patch crash, но Colyseus clock остался устаревшим: новый воспроизводимый дефект ниже.

**Сохранённые ограничения прогонов:** первый browser process оборвался после cancel-reconnect без JS stack/итогового JSON, точный native exit не записан; повтор16/16exit0. Первый standalone reconnect-cancel Node завершился nativeAV-1073741819, повтор отдельного CLI наCPU0exit0; affinity не объявлена cure. Браузеры работали с полной CPU-маской. Первый offline PLAY получил30s timeout без детальной диагностики, повтор без изменения source exit0/tick растёт; причина первого отказа не установлена. Все отказы сохранены в qa-accept. Общая Windows full failed/старый Linux baseline433passed не выданы за успешную финальную квитанцию.

**Финальный автоматический gate failed:** optimized Linux ARM64 Node22.23.3, исходники8/8 совпали с экспортом,437tests/436pass/1fail за1102,24s; build не запущен после failed tests. Единственный отказ — `tests/multiplayer-room.test.js:9`, timeout attach до welcome. [Квитанция](../knowledge/multiplayer/2026-10-24-client/linux-final/receipt.json), [полный suite](../knowledge/multiplayer/2026-10-24-client/linux-final/full-tests.txt), [отдельный повтор](../knowledge/multiplayer/2026-10-24-client/linux-final/isolated-map-ready-failed.txt). Native/V8 отказов в этом Linux прогоне нет. Изолированная инструментированная копия ведущего показала timer expiry раньше1800ms; проба `clock.start()` только в disposable Linux copy прошла map-ready test. Эта проба не является исправлением проверяемого source или успешной полной квитанцией.

**QA-0099-5, major — cold startup расходует время нового map-ready таймера до подключения клиента.** Критерий4/create/retry и обязательный полный suite. Независимый QA создал отдельный [real-SDK reproducer](../knowledge/multiplayer/2026-10-24-client/qa-accept/startup-clock.mjs) поверх неизменённого `hosted-room.js`: delayed `sim.ready`3000ms, room `mapReadyMs:1800`, обычный RoomClient с presentation callback500ms. Ожидается: после `beginLoad` у клиента полные1800ms; время подготовки комнаты не сокращает новый deadline. Фактически create3331,809ms, clock age при `beginLoad`3345ms, сервер eject4004 через5,879ms после `beginLoad`, до `onWelcome`; client не вошёл, loadingTimeouts1, defect=true. [JSON](../knowledge/multiplayer/2026-10-24-client/qa-accept/startup-clock.json), [stdout](../knowledge/multiplayer/2026-10-24-client/qa-accept/startup-clock.txt). Reproducer запускался optimized Node22 наCPU0 для отдельного CLI, без браузера; exit0 означает завершение диагностики, в JSON defect=true, это не pass.

Причина подтверждена независимым чтением pinned SDK: `ClockTimer.tick()` передаёт всем уже созданным `Delayed` общий `clock.deltaTime`; `Delayed` прибавляет его к elapsed. Hosted room после `await sim.ready` сбрасывает physics lastTime/accumulator, но `clock.currentTime` остаётся до async initialization. Первый cadence `clock.tick()` начисляет всё это время новому `beginLoad` timer. Требуются синхронизация Colyseus clock перед запуском cadence и regression, где cold initialization превышает loading deadline, а callback клиента укладывается в свой полный deadline. QA реализацию не исправлял. Ведущий отозвал эту версию и начал исправление только после сохранения независимого воспроизведения; отчёт и frozen hashes относятся к версии до этого нового rework.

### Пятая независимая приёмка 2026-10-24 — passed

Новый отдельный QA-подагент применил `.agents/skills/qa-tasks/SKILL.md`, прочитал задание/правила и проверил текущий diff поверх HEAD `3a2d2536c5a89bc60f80fb6bd84030122d58a4d2`. Реализацию не изменял, commit/push не выполнял. [Команды, результаты, критерии и ограничения](../knowledge/multiplayer/2026-10-24-client/qa-clock/README.md), [исходные SHA-256](../knowledge/multiplayer/2026-10-24-client/qa-clock/checked-files.json), [финальная сверка8/8](../knowledge/multiplayer/2026-10-24-client/qa-clock/frozen-source.json). Предыдущие QA-отчёты и отрицательные журналы сохранены. **Решение: passed, done. Все шесть критериев подтверждены; QA-0099-1–5 закрыты, новых дефектов не выявлено.**

**QA-0099-5 закрыт независимым прежним real-SDK reproducer:** delayed map3000ms/deadline1800ms/presentation500ms на неизменённом source: create3174.305ms, clock age после create0ms/при beginLoad9ms, connected=true/playing, loadingTimeouts0/defect=false. [JSON](../knowledge/multiplayer/2026-10-24-client/qa-clock/startup-clock.json), [код](../knowledge/multiplayer/2026-10-24-client/qa-clock/startup-clock.mjs). Контроль с presentation2200ms подтвердил сохранённый deadline: eject4004 через1792.113ms после beginLoad, loadingTimeouts1; отклонение менее одного cadence tick. [Expiry control](../knowledge/multiplayer/2026-10-24-client/qa-clock/startup-clock-expiry.json). Время cold initialization больше не начисляется новому loader timer.

**Адресные и браузерные проверки:** optimized Windows Node22.23.3, без no-opt/affinity/fallback: client/snapshot/prediction23/23; root room5 + tools hosted1 =6/6; самостоятельный Vite build exit0/1.97s. Новый expanded Edge155 + Chrome155 LAN runner16/16, exit0/errors=[], три isolated contexts/default102civilian,1440×900high и390×844touch/low. Подтверждены общая signature/invite, server-applied keyboard/joystick, player-player и player-AI damage, repair race с одним winner, durable prop и detached wheel late join без historical effects,12signal approaches на3clients при общем authoritative time, fourth full, personal wanted/holding/arresting/arrested/respawn, menu/freecam/hidden neutral и живой server tick, reconnect/fullstate,10leave/join, отмена reconnect/admission/map-loading и retry. [Browser JSON](../knowledge/multiplayer/2026-10-24-client/qa-clock/browser-report.json).

Все10leave: models0/transfers=null/listeners=null/scene children3, renderer стабильно11geometry/12texture. Labels3→2→3 сохраняют survivor «Друг2»/replacement «Друг1» и разные реальные RGB фона; defect=false. Отдельные SDK/Edge stale error+paused old leave и scheduled reconnect дают defect=false/новая playing/ready/active сохранена. Real CONNECTING UI cancel0→CLOSED3/buffer0/reconnecting=false через1800ms, свежая create успешна. Synthetic pagehide снимает canvas/document listeners и игровые window resize/keydown/keyup/blur, очищает models/city/prediction/timers; renderer56/13→1/1, errors=[]. Offline с endpoint127.0.0.1:1: обычный PLAY/tick5→188,0game requests/pageerrors. Визуально просмотрены high/low, portrait arrest, labels и offline PNG; баннерx8..218 и toolbarx257..382 не перекрываются, restart внутри viewport.

Source review подтверждает server authority/AI/gameplay, разрешённый prediction, HUD local sessionId и server respawn, post-await connectionEpoch/welcomeEpoch guards, cleanup и выделение label ordinal после удаления старых visuals. Inherited timers останавливаются синхронно до await ready; Hosted state/metrics, clock.start, physics accumulator и собственная cadence создаются в верном порядке. Unit cold regression2500ms/deadline1600ms/presentation250ms прошёл; clock reset подтверждён дополнительно прежним независимым воспроизведением выше.

**Финальный обязательный full/build прошёл:** QA самостоятельно прочитал квитанцию/raw logs/container state/source manifest прогона ведущего `node tools/verify.js --full`, optimized Linux ARM64 Node22.23.3, cpuset0/availableParallelism1, CPU1/1536MiB, без опубликованных портов/health probe.437/437passed,0failed/skipped/cancelled за1171.702s; Vite build8.95s; exit0/OOMKilled=false. [Квитанция ok=true/tests0/build0](../knowledge/multiplayer/2026-10-24-client/linux-clock/receipt.json), [suite](../knowledge/multiplayer/2026-10-24-client/linux-clock/full-tests.txt), [build](../knowledge/multiplayer/2026-10-24-client/linux-clock/build.txt), [8/8 export/current SHA](../knowledge/multiplayer/2026-10-24-client/linux-clock/source-match.json). Fingerprint `0a82af2478bedee603455499d8aa11ee8374da9b3287e911cde06e48d95479c2`, at2026-10-24T09:19:38.417Z. Остальной export base взят из immutable cached image и не менялся; проверяемые8SHA повторно совпали после завершения QA. Второй параллельный full не запускался.

**Ограничения:** физический телефон/WAN/performance budgets не проверялись; два независимых браузера покрывают разрешённую LAN-матрицу0099, приёмка0100/0101 не заявляется. GPU counters не доказывают освобождение памяти ОС. Исторические Windows native failures и Linux436/437 остаются отрицательными результатами; Linux pass не доказывает причину/исправление Windows runtime. В этом новом Windows QA все адресные/browser/build команды прошли без native/timeout failures. Статус и INDEX синхронизированы адресным queue CLI; commit/push выполняет ведущий.

Linux-квитанция относится к изолированному tested export с совпавшими8SHA TASK-0099, committed pinned dependencies и без постороннего незавершённого H3 experiment; это не `matchingReceipt` всего текущего Windows дерева. [Описание export/base](../knowledge/multiplayer/2026-10-24-client/linux-clock/README.md). Все437 обнаруженных штатным verifier root tests выполнены; отдельный hosted test дополнительно прошёл в независимом QA.

## Рекомендация модели исполнителя

Предпочтительно **gpt-6.1-sol, high**. Интеграция крупного main.js, модели и lifecycle: gpt-6.1-sol, high. Это качественная оценка соотношения затрат и качества по доступному списку моделей и риску задачи, без утверждений о точных тарифах. Для этой серверной серии экономичная модель без запаса на архитектуру и проверки не рекомендуется.
