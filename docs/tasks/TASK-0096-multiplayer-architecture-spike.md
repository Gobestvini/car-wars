# TASK-0096: Проверить серверную архитектуру мультиплеера на трёх игроков

- Статус: blocked
- Приоритет: high
- Создана: 2026-10-14
- Обновлена: 2026-10-14
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Архитектурный риск, реальная серверная физика, сравнение стеков и интерпретация измерений требуют gpt-6.1-sol с high.
- Зависимости: нет

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
- [ ] Обязательные проверки ниже выполнены и записаны фактически; ограничения и невыполненные пункты перечислены.
- [ ] Отчёт заполнен; после разработки статус ready-for-qa и INDEX синхронизированы. done разрешён только независимому QA.

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

## Рекомендация модели исполнителя

Предпочтительно **gpt-6.1-sol, high**. Архитектурный риск, реальная серверная физика, сравнение стеков и интерпретация измерений требуют gpt-6.1-sol с high. Это качественная оценка соотношения затрат и качества по доступному списку моделей и риску задачи, без утверждений о точных тарифах. Для этой серверной серии экономичная модель без запаса на архитектуру и проверки не рекомендуется.
