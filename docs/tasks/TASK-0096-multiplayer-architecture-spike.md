# TASK-0096: Проверить серверную архитектуру мультиплеера на трёх игроков

- Статус: done
- Приоритет: high
- Создана: 2026-10-14
- Обновлена: 2026-10-23
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Архитектурный риск, реальная серверная физика, сравнение стеков и интерпретация измерений требуют gpt-6.1-sol с high.
- Зависимости: нет

## Актуальная сверка 2026-10-23

Статус восстановлен в `done` по существующим независимым QA-решениям 2026-10-16 (основная приёмка и cadence дополнение, раздел 11); новая приёмка и новый pass не заявляются. Прежний `in-progress` в шапке/INDEX расходился с этими отчётами. Исследование принято с отрицательным production go/no-go для исследованного server-only клиента.

С 2026-10-18 существуют hosted Three.js preview и согласованный client prediction/reconciliation. Это более поздний этап, не результат старого spike и не основание принять весь релиз. Остатки полного gameplay и выпуска: [актуальная карта](../knowledge/multiplayer-release-readiness.md). Задачи 0097–0101 сверены с реальными путями и частичной реализацией; старый gate о полном отсутствии реализации ниже исторический. История исследования, неудачных измерений и QA сохранена.

## 1. Цель и запрос пользователя

Выбрать и доказать выполнимость архитектуры до переноса production-кода. Пользователь просит мультиплеер до трёх игроков, серверную физику и AI и изучение готового игрового сервера. Результат: ADR, запускаемый изолированный spike и измерения; игровая реализация остаётся прежней.

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

## 3. Область изменений

Разрешены docs/knowledge/multiplayer-server-adr.md, tools/multiplayer-spike/**, tests/multiplayer-spike*.test.js и артефакты docs/knowledge/multiplayer/**. Зависимости прототипа изолировать в его package.json/lockfile, не менять production src/** и корневые dependencies. Допустимо импортировать текущую чистую физику и data-only map. Не строить альтернативные полные игры на нескольких движках.

Сохранить offline single-player, visual defaults и текущие модели/управление; не трогать game-template и соседние оптимизационные задачи. Возможные равноценные имена файлов допускаются с обновлением документации и зависимых заданий, без расширения поведения.

## 4. Требуемое поведение

Предварительный выбор Node.js + Colyseus + cannon-es проверить, а не объявить доказанным. Сравнить Colyseus, Nakama, geckos.io и raw WebSocket по переносу существующего ESM-кода, lifecycle, протоколу, транспорту, лицензии, поддержке self-host и цене интеграции. Проверить официальную документацию и реальные совместимые package версии; выводы автора отделить от результатов эксперимента.

Прототип запускает в Node без DOM/WebGL общий cannon world с тремя CarSimulation, реальными коллизиями городской карты и репрезентативным AI. Не использовать пустую плоскость/три куба как доказательство переноса города или нагрузки 102 NPC. Если текущий traffic runtime мешает, выделить временный data-only harness внутри spike с реальными planner/controller и задокументировать, какие production пути ещё не доказаны. Это основание ограничить вывод, а не выдавать toy benchmark за performance игры.

Два-три SDK-клиента получают snapshots, отправляют ввод; 4-й join отвергается. Проверить запуск выбранного server/SDK/Schema без несовместимых major versions. Зафиксировать wire DTO/частоты/ack/limits, полный поздний join, reconnect grace и сериализацию map signature. Измерить варианты 120 Hz physics +20 Hz snapshots, scheduler60/AI10, 3+102 NPC и стресс300; сравнить baseline offline cost. Измерить RTT0/50/100/150 мс, jitter20 мс, потерю1% через реальный прокси, а не выкидывание сообщений из TCP как аналог сетевых потерь. Указать, где были headless measurements, где живой браузер.

ADR фиксирует решение go/no-go, server capacity, число полиции/global cap согласно existing intensity, необходимость interest management/worker, версия транспорта и схемы, единый snapshot contract и latency strategy без online browser solver. Если budgets плана не достигнуты, требуется воспроизводимый blocker/варианты и draft зависимых задач. Не переписывать physics engine для обхода проваленного измерения без отдельного решения.

## 5. План для исполнителя

1. Сверить исходники из раздела 2 и снять baseline одного мира: world.step только один на substep.
2. Составить короткую сравнительную таблицу со ссылками на первичные источники; выбрать минимальный spike основного кандидата.
3. Создать изолированный harness с repeatable seed, scripted controls, map colliders и метриками simulation/network/GC/debt.
4. Проверить capacity/reconnect/invalid input и измерить latency и server costs. Сохранить сырые JSON и инструкции запуска.
5. Оформить ADR со всеми обязательными решениями плана. Сверить downstream задачи и обновить их контекст; оставить draft до независимого QA этого этапа.

## 6. Критерии готовности

- [x] ADR содержит сравнение минимум четырёх вариантов, реальные версии/лицензии и обоснованный go/no-go.
- [x] Node-прототип запускается без browser globals; три машины и map collisions работают, четвёртая сессия отказана.
- [x] Измерены реальные simulation/serialization/wire costs и input-to-response; непокрытые production пути названы.
- [x] Определены DTO, global police cap, timing, recovery, latency strategy и воспроизводимый способ следующих проверок.
- [x] Обязательные проверки ниже выполнены и записаны фактически; ограничения и невыполненные пункты перечислены.
- [x] Отчёт заполнен; после разработки статус ready-for-qa и INDEX синхронизированы. done разрешён только независимому QA.

## 7. Проверки

### Автоматические

Рабочая директория — корень CarWars, кроме явно указанного prefix.

Из корня: npm test и npm run build для регрессий, результаты не приписывать прототипу. Добавить в изолированный package.json spike scripts test и benchmark, выполнить npm --prefix tools/multiplayer-spike test и npm --prefix tools/multiplayer-spike run benchmark; записать seed/hardware/config/длительность. Эти новые команды требуется реализовать в данной задаче.

Во время подготовки тесты приложения не запускались: код не менялся. Новые commands/files выше являются требованиями к исполнителю, не утверждением об их существовании сейчас. Для существующих suite failures отделить baseline failures от регрессии, не исправлять соседние проблемы без необходимости. npm/pnpm доступны; не переустанавливать зависимости без причины.

### Ручные

Обязательно: три реальных SDK-клиента, из них минимум один браузер, одновременно управляют разными машинами; full-room error четвёртому. Наблюдать столкновение и стабильный map signature; latency capture в браузере на RTT100 мс. Если harness не интегрирован с визуальной игрой, это явно записать; полноценная поездка будет проверяться в0099/0100.

QA повторяет обязательные сценарии независимо; артефакт исполнителя помогает воспроизводимости, не заменяет приёмку. Недоступная обязательная проверка явно блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Факты baseline — раздел2. Авторские решения — общий план: 1–3 игрока, max seat3, shared civilian/police world, personal wanted/respawn, shared pickups/props, no online browser solver, server120Hz. Будущий ADR может уточнить измеренные budgets/DTO; значимое изменение authority/физики или game rules согласовать и обновить зависимые задачи.

Предположение: MVP без аккаунтов и persistence, LAN/self-host сначала; публичный deploy и выбор платного сервера не входят. Домены/credentials не нужны для подготовки локального комплекта. При отсутствии done зависимости/ADR оставить draft или blocked с причиной; не начинать реализацию на недоказанном интерфейсе. Конфликт с актуальными чужими правками, несовместимость server physics или невозможный performance/latency budget требует конкретного воспроизведения/вариантов решения, а не молчаливого обхода. Не снижать NPC count и не удалять gameplay для фиктивного pass.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0096-multiplayer-architecture-spike.md в CarWars. Прочитай AGENTS.md, задание целиком и docs/knowledge/multiplayer-server-plan.md; после TASK-0096 также принятый ADR. Проверь актуальный код, локальные изменения и done зависимостей. Для draft сначала сверить результат зависимостей и перевести задачу в ready. Внеси изменения только в указанных границах, проведи автоматические и обязательные ручные проверки и заполни отчёт. Передай ready-for-qa, синхронизируй INDEX.md; done ставит независимый QA. При блокере запиши воспроизведение и необходимое решение. Не включай чужие изменения в commit/push; учитывай исключения AGENTS.md для CLI executor/QA.
```

## 10. Отчёт исполнителя

Дата: 2026-10-14. Ревизия baseline dc9eb0603b82bd3db4d1accbc7dda214efa9bb0c, плюс исходные чужие working changes; hashes импортированных production modules записаны в artifacts.

- Результат: создан изолированный запускаемый Node/Colyseus прототип с общим cannon миром,3 игроками, реальными городскими коллайдерами и сокращённым AI harness. Выбор Colyseus+cannon подтверждён для дальнейшего исследования; production go ограничен результатами ADR.
- Изменённые файлы: tools/multiplayer-spike/** (package/lockfile, world/server/schema/protocol, integration tests, browser UI, TCP proxy и benchmark runners); docs/knowledge/multiplayer-server-adr.md; docs/knowledge/multiplayer/** (сырые samples/metadata/регрессии/PNG); данная задача/INDEX и контекст TASK-0097–0101. Production src и корневые dependencies не изменялись.
- Команды и фактические результаты: npm --prefix tools/multiplayer-spike install --ignore-scripts —95 packages,0 vulnerabilities; npm --prefix tools/multiplayer-spike ls --depth=0 — реальные pinned versions совпали; npm --prefix tools/multiplayer-spike test —5/5; npm test —355/355,154.36с; npm run build —pass, существующее предупреждение о большом Three.js чанке. В тесте expired token ожидаемый диагностический вывод Colyseus, assertion прошёл.
- npm --prefix tools/multiplayer-spike run benchmark — завершён300.043с после15с warmup,36004 substeps; p95/p99=3.313/3.749мс, wire14.853KiB/s/client, heap tail120с+0.97%, dropped debt0. Номинальные scheduler60Hz/patch20Hz дали фактически40.83/16.77Hz;120Hz physics сохранены accumulator. Raw timings сохранены, включая accelerated1+102/3+102/3+300 и all-physical102. Последний профиль p95≈8.03мс нарушает предложенный6мс budget: union LOD нужен. Многокомнатная capacity не заявляется.
- npm --prefix tools/multiplayer-spike run network —40 проб/профиль RTT0/50/100/150+jitter20 через настоящий TCP byte-stream proxy. P95 applied-ack всех3 SDK110.8/196.6/215.1/252.9мс. Это decoding metric, не visible response.
- Ручные проверки: живой Codex in-app browser,3 настоящие SDK/WebSocket-сессии одной вкладки, server poses Canvas без client solver/AI;102 NPC, одинаковые map signatures, fourth join room locked. Loopback30 видимых проб p95≈86.9мс; RTT100 первый прогон p95≈199.3мс, повторный сохранённый raw30 проб p95=203.8мс (29 с изменением position), p99=215.8мс. Не выдавать лучший прогон за pass. Физические player-player/building collisions подтверждены fixtures; отдельный browser collision fixture и reconnect доступны для повторения QA. Three.js gameplay в spike не интегрирован, полноценная езда остаётся0099/0100.
- Выполненные критерии: ADR со сравнением4 стеков, реальные pinned core0.18.18/transport0.18.4/SDK0.18.5/Schema5.0.39 и licences; headless физика/город/3-client capacity; input whitelist/seq/ack/silence/rate limit, reserved reconnect/expiry/cleanup в5 интеграционных тестах; сырые simulation/network/browser artifacts; DTO/частоты/police cap6 и personal/shared rules задокументированы. При seq>2^31-1 spike отвергает команду по int32 ack; future protocol must define rollover/epoch.
- Непроверенное и блокеры:1% packet-level loss/retransmission (WSL/netem/Windows packet driver отсутствуют); полный production junction reservations/evasion/police/wanted/arrest/repair/props нагрузочный путь; обычный optimized-runtime long soak (2 ранних процесса Node24.19 завершились exit1 без stack trace). Успешный long run использует явно записанные --no-opt --no-concurrent-recompilation, не доказывает stable optimized runtime. Browser p95 RTT100 превышает200мс; network cadence ниже nominal. По ADR no-go для релиза/автоматического запуска downstream, нужны реальные impairment/runtime проверки и latency решение; нельзя молча вернуть solver в browser.
- Отклонения: разрешённый reduced headless AI glue вместо renderer-bound createVehicleRuntime; все отсутствующие production пути перечислены в README/ADR. Offline baseline — headless1-player harness, не полный browser offline performance. Default102 workload без3 police, productionCoverage=false. Временная копия collider descriptor builder подлежит замене единым core в0097.
- Итоговый статус: ready-for-qa,2026-10-14; независимый QA должен проверить критерии и записать собственное решение. Незавершённые обязательные проверки выше не объявлены pass. Downstream0097–0101 оставлены draft с новым контекстом.

### Повторная разработка и проверки 2026-10-16

Baseline HEAD4efe5698982662858eb48ec7e1a3c911009307af плюс исходные чужие working changes. Production src и root dependencies не менялись. Предыдущие отчёты сохранены как история.

- Устранён внешний blocker предыдущего QA: добавлены netem-bootstrap.py/netem-vm.py/netem-network.js. Официальные QEMU11.1.0/Alpine3.22.6 и Node22.23.3 извлечены в user-local cache; QEMU/ISO/Node checksums проверены, Windows adapters/drivers не менялись. RAM-only Linux guest запускает настоящий kernel netem и TCP/socat. Все host listeners127.0.0.1. Пошаговый запуск и ограничения двух TCP-плеч SLIRP записаны в tools/multiplayer-spike/README.md.
- Actual loss1%/RTT0/50/100/150/jitter20,40 samples/профиль: p95 applied-ack всех3SDK271.9/331.7/380.4/539.2мс. Настройки проверены по actual tc JSON, наблюдались drops и прирост TCP RetransSegs29/27/27/64; не подмена потерь выкидыванием JS messages. Сырьё docs/knowledge/multiplayer/2026-10-16/netem-network.json.
- Новый полный optimized Node22.23.3 soak: --expose-gc без --no-opt,15с warmup+300.082с measured,36009 ticks. p95/p99 step2.919/4.173мс,14.255KiB/s/client, heap tail+0.938%, droppedSeconds0. Scheduler41.86Hz/patch16.83Hz не достигают nominal60/20. Full production workload всё ещё не проверен: reduced AI без3/6 police и gameplay. Node24 failures не диагностированы.
- Прямой Node22 --test tools/multiplayer-spike/tests/spike.test.js:5/5, exit0,6.579с. Старые артефакты сохранены. Новый benchmark runner принимает BENCH_OUTPUT_DIR, записывает актуальный git baseline и SHA256 spike/production modules.
- Browser на http://127.0.0.1:2577/?endpoint=http://127.0.0.1:2581: три SDK102NPC, одинаковые signatures, fourth room locked;30 input→Canvas responses после applied seq,29 movement responses, p50/p95/p99=195.4/253.6/287.2мс. RTT100/loss1 actual qdisc и counters, raw30 и PNG сохранены. Снято после завершения benchmark/network runner. Токены не записывались, browser closed перед QA.
- Отрицательный результат latency200мс сохранён как no-go в ADR. Исполнитель не заявляет, что выбранный транспорт пригоден к выпуску. Физика/AI остаются серверными, client solver не добавлен. Обязательное внешнее измерение теперь выполнено; исследовательская задача передаётся на повторную независимую приёмку с отрицательным архитектурным выводом, как допускает раздел4. TASK-0097–0105 остаются draft: существующий gate на непрошедшие budgets не снимается. Следующий конкретный вариант — cadence/30Hz patch A/B, затем при необходимости server-authoritative H3/WebTransport spike с browser/certificate проверкой; это ещё не доказанное улучшение.

### Дополнительное исследование частот после baseline QA

2026-10-16: process-local cadence-probe.js, без изменения default server/world/state. Временный launcher с тем же кодом запускался на Node22, nominal scheduler120Hz/patch30 либо60, тот же netem RTT100/loss1. Две последовательные browser серии по30 проб/29movement: p50/p95/p99=195.3/245.4/278.8 и174.5/341.1/409.2мс. Нет контролируемого seed потерь между сериями, пятиминутный soak этих вариантов не заявлен. No-go сохраняется; простая смена частот не подтвердила200мс. Source hashes default server/world/state совпадают с baseline. Все raw browser samples и server summaries сохранены отдельно в dated artifacts; у30 только stdout tail из-за отмены Windows launcher без SIGINT, у60 штатный120с report. Этот helper и дополнения отчёта передаются на дополнительную QA-проверку; предыдущая baseline QA остаётся сохранённой.

## 11. Отчёт QA

Дата: 2026-10-14. Независимый QA-подагент, отдельный контекст; проверен HEAD dc9eb0603b82bd3db4d1accbc7dda214efa9bb0c и текущий незакоммиченный spike/ADR/artifacts. Исходные чужие staged/unstaged изменения сохранены. Реализация и критерии не изменялись.

**Решение: blocked.** Обязательная матрица с реальной потерей пакетов 1% и TCP retransmission не может быть проверена в текущей среде. Delay-only proxy явно не реализует packet loss. Это не принятое завершение задачи и не разрешение запускать downstream draft-задачи. Для повторной приёмки нужен настроенный packet impairment на сетевом пути и повтор browser capture; отсутствие инструмента нельзя заменить отбрасыванием application messages.

| Критерий раздела 6 | Независимый результат |
| --- | --- |
| Сравнение четырёх стеков и go/no-go | ADR сравнивает Colyseus/Nakama/geckos.io/raw WS; installed core0.18.18, transport0.18.4, SDK0.18.5, Schema5.0.39 подтверждены npm ls и локальной MIT metadata. npm metadata geckos3.1.0 BSD-3-Clause и ws8.22.0 MIT подтверждены повторно. Альтернативам не приписан запуск; Nakama binary version остаётся явно непроверенной. Решение ограниченного go/no-go обосновано. |
| Node, три машины, map collision, отказ четвёртой | 5/5 spike tests; no DOM, реальный CarSimulation/общий world/городские collider descriptors. Дополнительная QA fixture за120 ticks дала10 контактов именно между кузовами P1/P2, world.step120. Три browser SDK-сессии подключены, room locked четвёртому подтверждён на loopback и RTT100. |
| Реальные costs/response и coverage | Исходные hashes всех8 production imports совпали; raw benchmark36004 substeps/12250 schedulers/5033 patches соответствуют300.043с. Повторные измерения описаны ниже. Сокращённый AI, отсутствие police/wanted/props/gameplay и offline headless вместо полного browser baseline явно названы; full production budget не доказан. |
| DTO/cap/timing/recovery/latency | Изучены world/server/state/protocol/browser/proxy/benchmark/tests. Один world.step1/120, ack после tick, bounded pending, whitelist, rate cap, silence30ticks,15с reserved reconnect и schema snapshot подтверждены. Cap6 и будущий полноценный DTO — решения ADR, а не реализованные gameplay features. |
| Обязательные проверки | Частично выполнены: root regression/build, spike tests, benchmark и browser RTT100. Loss1% not-run, поэтому критерий не принят. |
| Отчёты/статусы | Отчёт исполнителя сохранён; qa-in-progress выставлен через queue CLI, итог blocked синхронизируется с INDEX. |

Команды QA:

- `Test-Path tools/telegram/verify.js` → false. Исторический entry point навыка отсутствует в текущем рабочем дереве; не восстанавливался. Использован актуальный `node tools/verify.js --full` → exit0,355/355,171.328с; Vite build pass1.77с с обычным предупреждением large chunk. Это запуск root node:test/build самим verifier, отдельные npm aliases повторно не запускались. Журналы `.check-logs/tests.log`, `.check-logs/build.log`; receipt `.checks.json` ok=true.
- `npm --prefix tools/multiplayer-spike test` → exit0,5/5,3.481с. Вывод invalid/expired reconnect token ожидаем в тесте assert.rejects. Проверены actual SDK capacity/late join/reconnect expiry/cleanup, invalid input и rate limit.
- `npm --prefix tools/multiplayer-spike ls --depth=0` → pinned installed dependencies совпали. `npm view '@geckos.io/server@3.1.0' version license --json`, `npm view 'ws@8.22.0' version license --json` → версии/лицензии совпали. Официальные источники ADR Colyseus reconnect, Heroic Labs TypeScript runtime и репозитории geckos/ws просмотрены QA.
- `npm --prefix tools/multiplayer-spike run network` → exit0,40 реальных SDK applied-ack samples/профиль через TCP proxy; p95 RTT0/50/100/150=111.691/167.060/202.260/264.039мс, jitter20, packetLossPercent0. Это decoding metric всех3 SDK, не visible response. Исходный network JSON исполнителя восстановлен после повторного измерения.
- `npm --prefix tools/multiplayer-spike run benchmark` → exit0; seed20261005, i9-13900KF/32logical/~64GiB, Windows22631, Node24.19.0, `--expose-gc --no-opt --no-concurrent-recompilation`. Accelerated30с simulation profiles1+102/3+102/3+300 дали p95=2.098/2.246/4.391мс; all-physical3+102 за5с simulation p95/p99=8.767/11.584мс. Real-time3SDK+102NPC, warmup15с, measured300.161с/36019ticks: substep p95/p99=4.153/5.360мс, scheduler p95=13.786мс, encode p95=1.429мс;12.550KiB/s/client, heap tail120с+1.026%, droppedSeconds0, maxDebt49.331мс, physical NPC p50=35. Raw count12220 scheduler/4940patches → measured40.712/16.458Hz, nominal60/20 снова не достигнуты. Сокращённый workload budgets зелёные, productionCoverage=false. Во время начала прогона выполнялись root verifier, browser UI и затем network runner; изолированное server capacity не заявляется. Исходные benchmark/simulation-preliminary JSON восстановлены byte-for-byte; повторное сырьё сохранено временно вне репозитория для ведущего, отдельные новые tracked artifacts QA не создавались.
- `wsl --list --quiet` → exit1, вывод справки установки WSL; рабочая Linux/netem distribution не подтверждена. Query Win32_SystemDriver по WinDivert/netem/clumsy → пусто. TCP proxy сохраняет FIFO, delay/jitter, bounded4MiB и не удаляет пакеты: обязательный loss profile недоступен.

Браузерная QA: Codex in-app browser, страницы2577 и2578 с endpoint2580. Три реальные SDK-сессии одной вкладки,102 NPC, server Canvas poses без solver/AI в browser bundle; обычная Three.js игра сюда не интегрирована. Проверены full-room, одинаковые welcome signatures всех3 сессий `7ee310664502559afb995feee1d07155086e49d596ac70044db038c269d38e3a`, стабильная state signature, disconnect/reconnect до15с с UI connected false→true; expiry отдельно подтверждён SDK тестом. Fixture повторена в браузере, наблюдались соседние P1/P2 после контакта и растущий contactCount; общий contactCount сам по себе не доказательство пары, поэтому отдельно измерены pair contacts в headless QA. Console error/warn для RTT100-вкладки пусты. Вкладки QA закрыты; серверы ведущего не останавливались.

RTT100/jitter20 browser capture завершён2026-10-14T12:50:40.214Z:30 проб,29 movement responses,p50=191.8,p95=212.4,p99=218.4мс. Metric input→Canvas frame с изменением позиции OR steering после applied seq ack; полное ощущение езды не заявляется. Сырые30 значения мс в порядке проб:218.4,191.6,178.4,203.6,187.0,195.3,174.0,199.3,149.4,211.9,212.1,180.3,161.7,158.1,202.9,194.7,191.8,182.5,207.7,212.0,203.6,149.7,212.4,187.0,199.2,191.1,128.9,207.9,170.5,207.6. Первая проба только steering, остальные movement. Одновременно выполнялись root verifier и benchmark, поэтому это desktop concurrent-load результат. Воспроизведение: открыть2578/?endpoint=http://127.0.0.1:2580, подключить3 сессии, нажать «Измерить видимый отклик». Цель плана p95≤200мс снова не достигнута; ADR уже фиксирует no-go/варианты, поэтому это подтверждённый архитектурный blocker, а не скрытый pass.

Дополнительные ограничения: scripts benchmark/start/network используют `--no-opt --no-concurrent-recompilation`; этот QA не подтверждает stable optimized runtime и не диагностирует два ранее заявленных exit1. Не доказаны полный production workload с3 активными police, gameplay и качество traffic liveness. Для снятия blocked требуется обязательная packet-loss матрица и новая независимая приёмка; budget/authority решения не ослаблять без явного согласования.

Примечание ведущего после завершения QA: повторное сырьё сохранено в репозитории без изменения байтов: [qa-repeat-benchmark.json](../knowledge/multiplayer/qa-repeat-benchmark.json), [qa-repeat-network.json](../knowledge/multiplayer/qa-repeat-network.json). Исходные артефакты исполнителя сохранены отдельно.

### Повторная независимая приёмка 2026-10-16

Проверен HEAD `4efe5698982662858eb48ec7e1a3c911009307af` и текущий working diff: benchmark metadata/output-dir, netem bootstrap/VM/network runner, README, дополнение ADR и dated artifacts. Прочитаны AGENTS.md, qa-tasks, соглашения/роль QA, план, задание целиком и релевантные исходники world/server/state/protocol/browser/tests. Все 11 SHA256 из `2026-10-16/benchmark.json` совпали с текущими файлами. Чужие изменения сохранены; QA меняет только эту задачу и её статус в INDEX, без commit/push.

**Решение: done — принят исследовательский результат с отрицательным production go/no-go.** Раздел 4 прямо допускает недостигнутые budgets при воспроизводимом blocker/вариантах и draft зависимых задач. Недоступная ранее обязательная packet-loss проверка теперь выполнена независимо. Это не подтверждение готовности production multiplayer и не снятие gate TASK-0097–0105: они остаются draft. Latency200мс, nominal cadence и полный gameplay workload не объявлены пройденными.

| Критерий раздела 6 | Доказательство повторной QA |
| --- | --- |
| Четыре варианта, версии/лицензии, go/no-go | Сравнение Colyseus/Nakama/geckos.io/raw WS и первичные ссылки в ADR проверены. `npm --prefix tools/multiplayer-spike ls --depth=0` подтвердил core0.18.18/transport0.18.4/SDK0.18.5/Schema5.0.39. Nakama release и benchmarks альтернатив явно не заявлены проверенными. Официальные Colyseus reconnect и Heroic Labs runtime просмотрены повторно. Дополнение ADR2026-10-16 задаёт актуальный no-go и конкретные cadence/transport эксперименты; прежние формулировки выше сохранены как история. |
| Headless Node, машины/город/capacity | Spike tests5/5; реальные CarSimulation, городской collider builder и один world.step на substep изучены. Дополнительная независимая fixture:120 steps,10 контактов именно между кузовами P1/P2, одинаковый signature. Browser через netem создал3 SDK/102NPC, четвёртому room locked; collision fixture-комната повторена, contactCount растёт. |
| Costs/response и границы coverage | Полный повтор optimized Node22 soak и actual packet-loss matrix ниже; браузерный capture повторён. Reduced AI, отсутствие police/props/wanted/полного production gameplay, временный collider builder и headless offline baseline явно ограничивают выводы. |
| DTO/cap/timing/recovery/latency | Изучены wire Schema, welcome/full, applied ack, whitelist/seq/rate/silence и15с reconnect. SDK тесты подтвердили late join, reconnect identity/expiry, cleanup; browser disconnect false→reconnect true повторён. ADR содержит cap6/default до3, полный будущий DTO, capacity MAX_ROOMS1, latency/recovery и запрет online solver. |
| Обязательные проверки | Root regression/build, spike test, полноценный benchmark, real SDK matrix, browser RTT100 и collision/signature/capacity сценарии выполнены независимо. Packet loss подтверждён actual tc drops/TCP retransmissions, не удалением application messages. Оговорка RTT0 ниже. |
| Отчёт и статусы | История QA2026-10-14 и отчёт исполнителя сохранены. Переходы qa-in-progress→done выполнены queue CLI с синхронизацией INDEX. |

Команды и факты QA:

- `node tools/verify.js --full` → exit0:355/355 тестов,165.988с; Vite build1.80с, обычное предупреждение large chunk. Исторический `tools/telegram/verify.js` отсутствует, использован актуальный root verifier. Он запускает тот же node:test/Vite, что npm aliases. `.checks.json`:ok=true, tests/build0,2026-10-16T15:35:27.576Z; `.check-logs/tests.log` и build.log. `npm --prefix tools/multiplayer-spike test` → exit0,5/5,3.355с; expired token diagnostic ожидаем assertion.
- `%LOCALAPPDATA%/carwars-netem/node22/node.exe --expose-gc tools/multiplayer-spike/benchmark.js`, `BENCH_OUTPUT_DIR=%TEMP%/carwars-qa0096-20261016` → exit0, оптимизированный Node22.23.3, только --expose-gc. i9-13900KF/32logical/Windows22631, seed20261005. Accelerated1+102/3+102/3+300 p95=2.228/2.448/3.683мс; all-physical3+102 p95/p99=7.356/10.752мс превышает6/8.33мс. Real-time3SDK+102NPC после15с warmup:300.932с,36112 ticks,p95/p99=2.567/3.332мс; snapshot1.085мс, encode/send1.259мс p95;12.300KiB/s/client, heap tail120с+0.991%, droppedSeconds0,maxDebt56.513мс. Scheduler42.159Hz/patch16.891Hz ниже60/20. Все reduced-harness budgets true, productionCoverage=false. В начале были concurrent root/network QA runners; отдельный VPS sizing не заявляется. Raw JSON сохранён вне репозитория в указанной TEMP-папке; исходные benchmark artifacts не перезаписывались.
- `%LOCALAPPDATA%/carwars-netem/node22/node.exe tools/multiplayer-spike/netem-network.js` → exit0;40 applied-ack проб каждого RTT0/50/100/150; p95=224.732/219.853/398.938/505.063мс. Actual loss0.01 во всех qdisc; drops delta17/15/21/27, TCP RetransSegs delta29/29/33/40. Для50/100/150 actual delay25/50/75мс и jitter10мс на guest egress. **RTT0 фактически loss-only baseline:** Linux не сохраняет options.delay/jitter при команде delay0ms10ms; ему нельзя приписывать actual jitter20. Это нулевая точка матрицы, а jitter подтверждён в ненулевых профилях. Два TCP-плеча QEMU SLIRP/socat и emulator overhead не являются прямым WAN. Исходный dated network JSON восстановлен byte-for-byte в finally; повторный raw сохранён `%TEMP%/carwars-qa0096-netem-20261016.json`.

Браузер: Codex in-app browser на `http://127.0.0.1:2577/?endpoint=http://127.0.0.1:2581`, actual profile RTT100/jitter20/loss1; kernel stats delay50ms/jitter10ms/loss0.01, drops476/RetransSegs478 наблюдались во время сценария. Три реальные SDK одной вкладки,102NPC, одинаковые три welcome signatures и стабильный state signature `7ee310664502559afb995feee1d07155086e49d596ac70044db038c269d38e3a`; full-room/reconnect/collision fixture повторены. Canvas показывает серверные poses, solver/AI в browser отсутствуют, Three.js gameplay не интегрирован. Скриншот диагностической карты просмотрен; ошибок/warnings консоли нет. QA-вкладка закрыта; серверы/VM ведущего не останавливались.

Capture2026-10-16T15:33:27.809Z:30 input→Canvas responses после applied ack,29 movement; p50/p95/p99=178.7/228.6/493.1мс. Raw мс:493.1,149.9,149.5,149.3,182.8,183.0,228.6,220.0,161.9,199.5,165.9,187.0,158.0,137.1,142.0,178.7,187.0,174.0,228.2,162.1,166.1,182.8,211.9,157.7,187.3,203.3,124.7,199.4,199.6,132.9. Первая проба steering-only; root verifier работал параллельно, benchmark/network matrix начались позже. Целевой200мс не достигнут, что независимо подтверждает blocker ADR. Полная управляемость на RTT150 и настоящий production renderer/gameplay остаются downstream проверками, не результатом этого Canvas spike. Optimized Node22 завершился; причины прежних Node24 exit1 не установлены.

### Дополнительная независимая QA cadence-probe, 2026-10-16

**Решение: done, исследовательское дополнение принято; production no-go и draft gate TASK-0097–0105 сохраняются.** Проверен новый `tools/multiplayer-spike/cadence-probe.js` (SHA256 `b38eced37c2a5a5d082c257369e73016672c206eab1c972ed4edfe4229b5ae0f`), README/ADR/отчёт и четыре cadence JSON. Default server/world/state не изменены: их hashes совпадают с принятым baseline, git status этих трёх файлов пуст. Повтор пятиминутного soak неизменного кода не нужен; предыдущая независимая baseline-приёмка и её ограничения действуют.

- Helper изучен: process-local onCreate вызывает исходный onCreate, затем заменяет единственный simulation interval и patchRate; physics STEP/authority/input/state не меняются. Доступны только patch30/60, порт2577 loopback, срок120с, сохранение samples и graceful shutdown/quit. `node --check tools/multiplayer-spike/cadence-probe.js` → exit0.
- QA самостоятельно запустил optimized Node22 helper30 и helper60, по три настоящих SDK через `http://127.0.0.1:2581`; по30 последовательных applied seq всем трём сессиям, одинаковые signatures, exit0 клиентов. Actual qdisc: delay50ms/jitter10ms/loss0.01, то есть используемый RTT100/jitter20/loss1 path. Helper30 завершился штатным120с таймером exit0; helper60 завершился stdin `quit` exit0 после smoke. Исходные dated server reports сохранены байтами и восстановлены в finally; новые QA reports находятся `%TEMP%/carwars-qa0096-cadence30.json` и `carwars-qa0096-cadence60.json`.
- По разности первой/последней из4 активных строк каждого QA report:30Hz вариант дал scheduler64.347Hz/patch25.112Hz/physics120.034Hz,60Hz вариант64.819/47.915/119.988Hz. Это короткие интервальные оценки при concurrent root verifier, не target runtime capacity, не обещанные120/30/60Hz. Отсутствие клиентов прекращает сбор строк;120с жизнь процесса не означает120с активного workload.
- Raw browser JSON независимо проверены assertions:30 samples/29movement, три одинаковых signatures, sessions3, error=null, appliedTick≤tick; заново отсортированы ms и сверены p50/p95/p99:195.3/245.4/278.8 и174.5/341.1/409.2мс. Server30 явно partial stdout5rows, server60 содержит7 active rows и штатное завершение; эти различия честно записаны. Random loss не контролировался одинаковым seed, causal A/B и улучшение latency не заявлены. Из двух превышений p95 нельзя выводить, что увеличение частоты само вызывает ухудшение.
- Браузерный повтор новых exploratory серий в этом followup not-run: поддержанные `cua.createBrowserTab('iab',...)` и прежний browser id вернули Browser is not available, inventory apps[]/browsers[]. Это не новый обязательный gameplay сценарий: browser-client и baseline server/world/state неизменны, обязательная независимая browser RTT100 проверка выполнена выше; дополнительные числа оценены как executor exploratory evidence, не приписаны независимому browser capture QA. SDK smoke и raw consistency достаточны для принятия именно этого ограниченного дополнения.
- Прежняя root квитанция перестала соответствовать fingerprint после добавления helper, поэтому QA повторил `node tools/verify.js --full` → exit0:355/355,162.215с; build1.49с, только прежнее предупреждение large chunk. `.checks.json` ok=true/tests0/build0, at2026-10-16T15:48:39.151Z, fingerprint `89b2005c6d60147054bece1f653571bc241086cbacb12defd254d6dc40251d17`. Изменён только изолированный helper и документация, поэтому повтор неизменного spike suite/пятиминутной baseline без новой причины не выполнялся.

Новых дефектов, требующих возврата задачи, не выявлено. Уточнение RTT0 loss-only внесено в актуальные документы. История предыдущих QA сохранена; статус и INDEX возвращены в done через queue CLI. QA не менял реализацию, не создавал подагентов и не делал commit/push. Его процессы helper завершены, SDK-сессии освобождены; QEMU/netem больше для QA не нужен.

## Рекомендация модели исполнителя

Предпочтительно **gpt-6.1-sol, high**. Архитектурный риск, реальная серверная физика, сравнение стеков и интерпретация измерений требуют gpt-6.1-sol с high. Это качественная оценка соотношения затрат и качества по доступному списку моделей и риску задачи, без утверждений о точных тарифах. Для этой серверной серии экономичная модель без запаса на архитектуру и проверки не рекомендуется.
