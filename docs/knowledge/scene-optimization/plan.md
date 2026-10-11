# Протокол и план оптимизации сцены — TASK-0079

2026-10-11. Основная измерительная матрица завершена, бюджеты зафиксированы до изменений алгоритмов. Дополнительная проверка эффектов и независимый QA завершают измерительный этап. TASK-0078 принята независимым QA и опубликована b440275. QA TASK-0077 подтвердила локальный jitter fix и непрерывное движение, но полная приёмка blocked: отсутствуют физическая проверка60Гц/настоящий OS hidden и завершённое continuous legacy сравнение. Cadence и диагностика77 зафиксированы для baseline79; координация общих файлов не требует done77. Raw0077 не выдаются за baseline0079.

## Протокол измерений до оптимизации

Один последовательный headless Edge, нативный ANGLE/D3D11 RTX4080, без CPU throttle;1440×900 и390×844, DPR1. Мобильный viewport не является телефоном. Seed20261005, roadWidth15, spawn(-75,.96,-50),yaw0;10сек warm-up. По три свежих контекста/повтора; никакой сборки/тестов/других измерительных браузеров во время timing runs. После каждого прогона одинаковый HeapProfiler.collectGarbage; heap и renderer resources сравниваются отдельно от времени кадра. Записываются Git revision и hash фактических исходников с незакоммиченными диагностическими изменениями.

Дополнение после отказов среды: default-affinity матрица дважды прервана renderer crash. Для отдельной воспроизводимой серии назначена временная process affinity mask1 (один логический процессор), actual masks всех benchmark-процессов проверяются до каждого замера. Это ограниченный профиль, не оценка обычного запуска на всех ядрах. Целевые smoke low/high300/lifecycle прошли, полный suite в этой среде280/281 без native, но с отдельным исходным assertion автоматизации. Полный baseline ещё выполняется; описание отказов — [environment-2026-10-11.md](environment-2026-10-11.md). Ни один результат с другой affinity не объединяется с этой серией. Effects RNG seed0x5c3e2026 устанавливается test-only initScript; production random/AI не изменены.

Команда из PowerShell (Playwright доступен через PLAYWRIGHT_MODULE, dev server запущен отдельно с HMRfalse):

```powershell
./tools/run-scene-profile.ps1 -CpuAffinity 1 -BaseUrl http://127.0.0.1:5180/ -Output docs/knowledge/scene-optimization/baseline-stable
```

Launcher не меняет системную affinity/настройки игры и восстанавливает свои process env vars. `-Resume` допускается только при полном совпадении sourceHash, limiter, case, duration, quick/allocation flags и affinity protocol; smoke не может быть принят за завершённый full run. Allocation sampling запускается отдельно: `-Allocation -Cases desktop-high-300 -DurationMs 60000` с отдельным Output.

| Сценарий | Viewport | Quality | Civilian / police | Blur | Основной прогон |
| --- | --- | --- | --- | --- | --- |
| desktop-low-empty |1440×900|low|0 /1|0|60сек×3|
| mobile-low-60 |390×844|low|60 /1|1|60сек×3|
| desktop-high-60 |1440×900|high|60 /1|0|60сек×3|
| mobile-high-300 |390×844|high|300 /2|1|300сек×3|
| desktop-high-300 |1440×900|high|300 /2|1|300сек×3|
| lifecycle |1440×900|чередование low/high|0→60→300→0→60 дважды /0↔2|1|300сек×3|

Это покрывающая матрица, а не полный декартов продукт: обе площади, оба quality,0/60/300, default1police/max2, оба blur; наиболее тяжёлые сцены проверяются в обоих viewport. Цель — измерить steady driving/pursuit/damage/smoke и fade; подстановка test-only input/trigger только в HTTP-ответ, production API не получает игровых mutators. Freeze/ручной рендер для time benchmark не используется. Фактические positions/droppedSeconds/roleCounts и эффекты сохраняются в JSON, настройки не подменяются для достижения FPS.

Маршрут: прямоугольник с waypoint(-75,-25)→(25,-25)→(25,75)→(-75,75), strength.14; test-only controller задаёт pointer coordinates каждый реальный physics step. Настоящие getInput/joystickVector/directionalInput и guard ареста продолжают выполняться; фикстура не заменяет их готовым control object. Маршрут хранится один раз, полная telemetry читается только в slow samples, а обычные allocations настоящего getInput остаются частью профиля. В low-empty обычная езда; остальные основные случаи получают pursuit/damage trigger после10сек. В300сек стресс-прогонах каждые60сек reset начинает следующий реальный эпизод, чтобы арест не превращал весь замер в неподвижную сцену; события/арест/позиции сохраняются. Lifecycle —10циклов через30сек: queued traffic/полицейские, reset или city rebuild12/15, quality low/high; test-only placement на аптечке вызывает обычную production collectSegment/repair на следующем шаге, reset подтверждает восстановление. Это отдельный сценарий churn, его pauses/GC не выдаются за steady-state время.

CPU columns: physics включает весь fixed-step gameplay; AI является частью trafficPrepareMs, npcPrepareMs также её часть, поэтому эти вложенные времена нельзя складывать повторно. stepGameplayMs — остаток physics после playerPrepare/trafficPrepare/worldStep/post. Сигналы, traffic visual, occlusion, damage, smoke, pickups измеряются отдельно. Полное cpuMs включает HUD, исключая запись диагностической строки. GPU samples имеют frame ID и статус/disjoint/skipped. Внешний rAF buffer32768 ограничен, total/truncated объясняют обрезку; actual frame ring32768 сохраняет полный300сек при cap60. Отдельный allocation sampling32KB проводится вне timing baseline и не используется для прямого сравнения CPU времени.

Отдельно300сек×3 lifecycle:0→60→300→0→60,10reset/rebuild/quality циклов, pickups collect/reset restore. Follow/free, menu/hidden/loading проверяются отдельно; пауза не включается в active frame интервал. raw rows имеют монотонный frame ID, accepted/rendered counters раздельны; внешние rAF timestamps не определяют FPS игры. CPU physics/visual/submission и валидные GPU query samples разделены. Полные calls/triangles включают shadow и postprocess, включая bypass путь.

## Измеренные приоритеты и бюджеты до изменения алгоритмов

Основная матрица завершена:18/18 full runs, три повтора каждого случая. Проверенная сводка — [baseline-2026-10-11.md](baseline-2026-10-11.md), машиночитаемые данные — baseline-summary.json. Условия affinity1 обязательны и для последующих сравнений. Дополнительные skid/fade и отдельный allocation sampling не объединяются с CPU временем основной матрицы. Исходный hash основной серии7bf00615; новые tools сводки/эффектов не изменяют production code.

Доминирует physics/gameplay: desktop300 p95 median22.9ms, mobile30023.4ms. Поэтому общий обязательный ориентир серии80–82: ≤18.32ms desktop и≤18.72ms mobile (−20%) для медианы трёх p95; CPU frame median27.9/29.9 также должен улучшиться. Для остальных случаев верхняя граница сравнения равна `baseline maximum p95 × 1.05`: CPU low0≤3.15ms, mobile60≤7.035ms, desktop60≤6.825ms, lifecycle≤6.72ms. Это явно допускает исходный разброс, а не прибавляет произвольную дополнительную погрешность после результата. При превышении — дополнительное исследование и исправление, не округление до pass. Равные protocol/durations/poses обязательны.

GPU отдельный критерий: baseline high desktop300 p95 median6.284288ms, mobile3004.636672ms. Для принятых GPU методов нужно воспроизводимое улучшение за пределами baseline разброса6.185984–6.358016 и4.619264–4.690944 соответственно; без ухудшения max p95 других случаев×1.05. Польза снятия CPU allocations не объявляется GPU ускорением. Художественные36пар и GPU color/frequency fixture обязательны.

Allocation budget для №82: не менее50% уменьшения **sampled total sizes двух подтверждённых источников** footprintsOverlap и segmentHitsRect при таком же отдельном60s/32KB profile; raw weighted bytes — статистическая оценка churn, не retained heap. Перед этим кандидатом нужно сохранить scalar-equivalence edge cases/случайные fixtures и порядок столкновений. Удаление этих allocation требует сохранения физической/AI частоты и narrow-phase результата. Cannon raycast index остаётся вторым кандидатом: оценка аллокаций сама по себе не доказывает его CPU доминирование.

Ёмкости №80:300civilian storage суммарно по вариантам;2police storage и2effect containers, lazy создание; неизвестные роли имеют bounded capacity своего maxCount, переполнение остаётся pending. На release новый logical ID и lease, старые listeners/cooldowns очищаются. Building cache — lazy по стабильному entry текущего city generation, **8inactive**, до числа192entries active (активные не вытесняются); измеренный lifecycle active high-water2. Idle8 — явный ограниченный экспериментальный бюджет для нескольких посещённых улиц, не утверждение об измеренном оптимуме; проверить raw retained bytes и hit/miss в №80. При большем high-water не ломать fade, удалять LRU только inactive.

Memory/lifecycle бюджет: после первого полного прогрева каждое повторение одинакового0→60→300→0→60 цикла не создаёт новых expensive storage сверх указанных capacities; одинаковые состояния имеют одинаковые body/listener counts и bounded geometry/texture counts. Retained cache может увеличить heap; увеличение объясняется байтами storage/cache и остаётся bounded, не маскируется GC timing. Для20traffic/10city циклов сравнить последние5равных состояний: отсутствие устойчивого роста count, диапазон after-GC heap≤max(5% их медианы,1MB) после исключения отдельно измеренных profiler rows. Если engine/JIT разброс превышает бюджет, повторить равный frozen snapshot, не заявлять отсутствие утечки по одной паре.

Предварительная цель из задания: не менее20% снижения p95 подтверждённого доминирующего времени в стресс-сцене; проверяется после baseline и может быть уточнена по измеренному разбросу **до** оптимизаций. Для остальных сценариев — отсутствие ухудшения свыше5% сверх измеренного baseline разброса. CPU/GPU оцениваются отдельно; render submission не заменяет GPU timing. Реальный аппаратный телефон не является доступной средой и обещания60FPS на нём нет.

Ресурсы и lifecycle: bounded lazy caches допускают прогрев и рост до явно заданной ёмкости; после одинакового прогрева повторные циклы не должны создавать постоянный рост geometry/texture/program/body/listener или сохранять stale generation. Только снижение heap либо allocations не заменяет измерение кадра. Снижение traffic/defaults/DPR/quality, изменение STEP/AI cadence, скрытие эффектов ради бюджета запрещены.

## Решения следующих этапов

Приоритеты и capacities выше уже определены по основной матрице; конкретные алгоритмы остаются кандидатами до измерения каждого изменения:

- №80: общий civilian лимит300 с вариантами внутри ёмкости, police2, police effect containers2; lazy acquire/release, новые logical IDs при reuse, полный сброс физики/AI/деформации/колёс/событий и world/listener ownership. Building proxy budget выбирается по измеренным overlap/high-water/memory, LRU удаляет только неактивные. Shared instancing/ring buffers статической сцены не дублируются дополнительными пулами.
- №81: проверить static matrix updates, sharing/batching стен/landmarks, dirty instance ranges, culling bounds, active transparent instances, redundant postprocess clears/state allocations. Сохранять рисунок/AA/color/frequency и offscreen shadow casters. Для отвергнутых методов записать измеренную цену и пользу.
- №82: actor snapshots/ID indices и scratch данных шага, значения velocitiesBefore до physics, smoke selection/free slots/active count, pickup transform/surface cache и dirtyHUD. Никаких алиасов старых public snapshots или изменения приоритетов/семантики событий. Ранжирование CPU hot paths ожидает подробный профиль.

Полная карта26категорий — [inventory.md](inventory.md), измерения — [baseline-2026-10-11.md](baseline-2026-10-11.md). Эти документы определяют последующие изменения, а не заменяют реализацию и независимую приёмку задач80–82.
