# TASK-0079: Измерить сцену и зафиксировать план полной оптимизации

- Статус: done
- Приоритет: high
- Создана: 2026-10-10
- Обновлена: 2026-10-11
- Проект: CarWars, Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; нужно разделить CPU/GPU/GC и проверить lifecycle всех подсистем.
- Зависимости: нет; с задачей света №78 выполнять последовательно, после изменений света обновить baseline для следующих этапов.

## 1. Цель и запрос пользователя

Запрос: «Нужно все объекты добавить в пулл вообще нужна полная оптимизация сцены, может есть ещё какие-нибудь методы кроме пудинга нужно их тоже применить». «Пудинга» интерпретировано как пулинг.

Подготовить воспроизводимые измерения всей сцены и конкретные решения для последующих TASK-0080–0082: пулы, GPU/рендер, CPU/симуляция. Все классы объектов должны получить обоснованный lifecycle; постоянные объекты используют shared ресурсы/instancing, повторно возникающие — bounded reuse. Создание пула для каждого неподвижного mesh само по себе целью не является.

Согласовать диагностику с существующей `docs/tasks/TASK-0077-frame-pacing-smoothness.md`: выполнять изменения main/game-loop последовательно, переиспользовать её принятые счётчики и переснимать baseline после изменения cadence. Это координация общих файлов, не требование ждать завершения 77 для статического аудита.

Это измерительный этап, а не завершение полной оптимизации. Остальные этапы обязательны; не ограничиться отчётом и не применять все возможные техники без доказанной пользы.

## 2. Проверенный контекст

Проверено чтением исходников 2026-10-10, повторная сверка ревизии 2026-10-11, HEAD `b3501b7cb6d9233ce697e17c62bfa9023096ca78`, main; Three.js 0.180.0, cannon-es 0.20.0, Vite 7.1.9. Живые замеры при подготовке не выполнялись.

| Файл / символ | Текущее поведение |
| --- | --- |
| `src/main.js`: `frame`, `metrics`, `window.carLab` | Фиксированный шаг и потолок рендера 60; есть CPU/render/physics, calls/triangles и resources. В fixed-step создаются Map/Set, actor/source массивы. |
| `src/game-loop.js`: `FixedStepper`, `src/vehicle.js`: `CarSimulation` | Шаг STEP 1/120, ограниченный catch-up, общая физика/SAPBroadphase. |
| `src/traffic.js`: `createVehicleRuntime`, `add`, `removeAt`, `physicalActors`, `physicalTireSources` | Civilian/police, физический/логический LOD, spatial occupancy, создание/удаление simulation и mesh. |
| `src/car-damage-effects.js`: `ParticlePool`, `src/tire-smoke.js`: `TireSmoke`, `src/tire-tracks.js` | Уже ограниченные пулы/буферы; не переписывать их без замера. |
| `src/building-occlusion.js`: `startProxy`, `finishProxy` | При fade создаются/удаляются geometry/material/depth proxy; возможный источник allocation/compile spikes. |
| `src/repair-pickup-visuals.js`: `update` | Instancing уже есть, но каждый update создаёт векторы/матрицы и clone внутри цикла. |
| `src/city-scene.js`, `src/city-art.js`, `src/city-trees.js`, `src/city-street-props.js` | Много общих instanced batches; стены/часть landmarks отдельные meshes. |
| `src/miniature-blur.js`: `drawPipeline`, `render` | Sharp HDR target, шесть blur passes и composite, обход в free/strength0; сохраняется состояние renderer. |
| `src/signal-glow.js`, `src/shadow-coverage.js` | Лучи и следящие тени требуют отдельного профиля, корректного culling/caster coverage. |
| `tools/traffic-performance.cjs` | Старый surrogate benchmark считает внешние rAF callbacks; после лимита 60 это не число отрисованных кадров. Edge/SwiftShader/CDP4x — не телефонный/GPU baseline. |

Чужой diff: AGENTS/навыки/Telegram, README/TEMPLATE/INDEX (TASK-0049), traffic-flow JSON. Не включать его в свои коммиты. Новые задания этой серии подготовлены отдельно от реализации.

## 3. Область изменений

Диагностика в `src/main.js`, необходимые read-only counters в существующих подсистемах, `tools/traffic-performance.cjs` либо новый `tools/scene-performance.cjs`, `docs/knowledge/scene-optimization/` с baseline JSON, inventory и решениями. Допустимы тесты корректности счётчиков. Алгоритмы игры и художественные настройки на этом этапе не оптимизировать.

Не менять физический шаг, количество объектов, defaults графики/blur/света, управление и AI. Не подменять прогресс отключением эффектов или снижением трафика. Новые библиотеки не нужны.

## 4. Требуемое поведение

- Инвентаризация всех подсистем: дороги/бордюры/здания/крыши/стены/landmarks/деревья/props/светофоры/лучи, игрок/NPC/полиция/колёса, damage/skid smoke/следы, repair pickups, тени/postprocess, reset/rebuild/dispose и временные CPU данные. Для каждой: factory/owner, частота создания, active/capacity, sharing, освобождение, предлагаемый метод и риск.
- Снимать число реально обработанных/отрисованных кадров отдельным монотонным счётчиком. Между двумя внешними rAF может быть тот же кадр: не дублировать его CPU sample. Считать интервалы принятых кадров, p50/p95/p99 CPU и render submission отдельно от GPU.
- GPU timing использовать лишь при доступном timer extension и валидных недизъюнктных samples; при отсутствии писать unavailable. Время `renderer.render` на CPU не называть временем GPU. Calls/triangles суммировать по полному кадру со всеми shadow/postprocess passes; различать прямой и postprocess пути.
- Сохранить revision, browser/GPU, viewport, DPR, quality, blur/camera, seed/позы, traffic/police counts, fixed-step/droppedSeconds, warm-up, raw samples, количество повторов. Profiling включать только диагностически, ограничивать объём данных.
- После прогрева провести не менее трёх повторов на той же машине: 1440×900 и 390×844, low/high, 0/60/300 civilians, default police и стресс максимального разрешённого в UI числа полиции; blur0/1. Основные замеры по60 секунд, наиболее тяжёлые/high и lifecycle —300 секунд; camera free, меню/hidden отдельно как regression scenarios. Не создавать огромный декартов продукт без смысла: перечислить выбранную покрывающую матрицу и её причины.
- Сценарии: обычная езда, погоня/повреждение/дым, repeated fade зданий, 0→60→300→0→60 traffic, pickup collection/respawn, десять reset/rebuild/quality циклов. Метрики памяти после GC сравнивать только одинаковым способом; учитывать bounded caches и lazy shader warm-up.
- Отчёт ранжирует bottlenecks, предлагает конкретные изменения следующей серии и до их начала фиксирует бюджеты. Предложенный ориентир автора: ≥20% улучшения p95 подтверждённого доминирующего времени в стресс-сцене, без ухудшения остальных >5% сверх измеренного разброса; memory/allocations/draw calls — отдельные критерии. Цель проверить по baseline, не обещать60 FPS на любом устройстве.

## 5. План для исполнителя

1. Проверить актуальные исходники/состояние TASK-0078 и текущий capture/benchmark; если свет меняется позже, зафиксировать необходимость нового baseline.
2. Добавить счётчики accepted/rendered frame и поэтапный CPU profiling без двойного учёта; адаптировать сбор данных к FPS cap. Проверить прямой/postprocess рендер и disabled profiling overhead.
3. Заполнить inventory, воспроизвести матрицу, сохранить raw JSON и environment. Старые traffic baseline не перезаписывать.
4. В `docs/knowledge/scene-optimization/plan.md` записать решения, capacities/overflow для пулов, GPU candidates, CPU hot paths, бюджет регрессии и точные команды. Для неполезных методов указать измеренную причину отказа.
5. Актуализировать TASK-0080–0082 конкретными данными без изменения пользовательской цели. Переводить следующую задачу в ready только после done зависимости и проверки её контекста. Заполнить отчёт и передать этот этап QA.

## 6. Критерии готовности

- [x] Все подсистемы покрыты inventory; определены reuse/sharing/dispose и проверяемые решения следующих этапов.
- [x] Частота рендера и samples корректны при callbacks120/144 и рендере60; полный кадр считается единожды, GPU/CPU разделены.
- [x] Сохранены воспроизводимые baseline, три повтора, stress/lifecycle и ограничения среды; данные позволяют повторить сравнение.
- [x] Бюджеты/ёмкости/приоритеты следующих этапов определены; отсутствие замера не выдано за отсутствие bottleneck.
- [x] Gameplay/визуальные defaults сохранены; проверки пройдены, profiling отключается без постоянного allocation overhead.

## 7. Проверки

Из корня: `node --test tests/game-loop.test.js`, `npm test`, `npm run build`; для нового sampling helper содержательно проверить отсутствие duplicate samples и расчёт интервалов принятых кадров. `npm run dev`, затем новая команда benchmark (зафиксировать в отчёте); существующий `node tools/traffic-performance.cjs` допустим только после исправления учёта кадров и проверки актуальности UI.

Обязательная WebGL матрица из раздела4, отсутствие ошибок, воспроизводимость по JSON. Физический телефон при наличии — отдельный профиль; SwiftShader и desktop/mobile viewport подписывать честно. Без WebGL и raw измерений этап не принят.

## 8. Предположения, вопросы и условия остановки

Пулинг нужен для повторяющегося lifecycle, статике — sharing/batching/culling. Это предложенное автором техническое толкование запроса. Фактический главный bottleneck неизвестен и является результатом этого этапа. Недоступный GPU timer не блокирует CPU/allocations/calls, но GPU выводы без измерений запрещены. Если браузерные измерения целиком недоступны, оставить blocked с причиной; статический аудит не завершает задачу.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0079-scene-performance-baseline.md. Прочитай AGENTS.md и задание, исследуй всю сцену, измерь актуальную игру с учётом лимита 60 FPS, сохрани baseline/inventory/план и конкретизируй TASK-0080–0082. Не ограничивай общую оптимизацию одним аудитом, но на этом этапе не меняй игровые алгоритмы. Заполни отчёт и INDEX, передай ready-for-qa; done ставит независимый QA. Сохрани чужие изменения.
```

## 10. Отчёт исполнителя

- Результат: Основной baseline завершён:18full runs, три повтора каждой из6сцен. Inventory26категорий, CPU/GPU/stage collector, allocation profile и измеренные бюджеты/ёмкости определены до изменения алгоритмов;0080–0082 актуализированы. Дополнительные эффекты/актуальные full checks и независимый QA завершают этот этап. Оптимизации0080–0082 ещё не реализованы.
- Изменённые файлы и зачем: src/scene-profile.js (typed ring32768, actual frame IDs, stage totals, bounded/disjoint-aware GPU queries), src/main.js (полный кадр shadow/postprocess и stage profiling, CPU включаяHUD), src/traffic.js (actual AI-step timing, factory counters), src/building-occlusion.js (proxy churn/highWater counters), tests/scene-profile.test.js, tools/scene-performance.cjs и tools/run-scene-profile.ps1; docs/knowledge/scene-optimization/{inventory,plan,candidates,environment-2026-10-11}.md и raw artifacts.
- Команды и фактические результаты: целевые game-loop/frame-intervals/scene-profile14/14; scene-profile/building-occlusion/traffic/traffic-physics25/25. Финальный node tools/verify.js --full с process affinity1:281/281 и production build passed,09:55:53Z, fingerprint2f76d8c8bc87c59aba7c5eee65c0b2d9fad305080e227d0311362043203a44b9. Прежний tools/telegram/verify.js удалён параллельной миграцией; ранние native/agent-knowledge отказы сохранены в environment report и не выдаются за актуальный pass. Финальные журналы скопированы в scene-optimization/.
- Ручные проверки и выполненные критерии: baseline-stable18/18 прошёл без page/WebGL errors, overwritten или duplicate frame IDs; GPU queries available/discarded0/skipped0. По300сек×3 stressdesktop/mobile и lifecycle;10reset/rebuild/quality/pickup collect+restore циклов в каждом lifecycle. Actual masks1 всех живых benchmark processes проверены. Separate allocation-stable60s/32KB показал крупный churn footprintsOverlap/segmentHitsRect. Raw/агрегаты/точный протокол и ограничения — docs/knowledge/scene-optimization/{baseline-stable,baseline-summary.json,baseline-2026-10-11.md,allocation-stable,plan.md}. Supplemental keyboard skid/fade три повтора выполняются отдельным tools/scene-effects-profile.cjs.
- Непроверенное, блокеры и отклонения: независимыйQA ожидается. Supplemental skid/fade6/6pass,7integration checks menu/free/follow/reset/controlled hidden/loading/ordinaryHUDpass; controlled hidden getter не выдан за OS tab suspension. Process affinity1 — явное ограничение среды после native failures default-affinity; данные не выдаются за обычный многоядерный запуск или физический телефон. Cadence77 зафиксирован, полная QA77 blocked;79не требует done77. Budget physics p95−20%, CPU/GPU regression≤baseline max×1.05; civilian300/police2/effects2/building8inactive с bounded active entries. Чужие изменения автоматизации и staging сохранены; исходный agent-knowledge fixture исправлен параллельной миграцией, здесь не менялся.
- Итоговый статус и дата: ready-for-qa,2026-10-11; оптимизация80–82 не объявлена выполненной.

## 11. Отчёт QA

2026-10-11, независимый QA-подагент, решение: **принято (`done`)**. Проверен HEAD `0a5a3163cda6ba1c907bac1747cbb00cf50f1c42` и диагностические файлы79; исходники игры SHA-256 `21600b167027e5e71452809668b349851a1d57dd4dffd917dd9c24d4c39f1351` совпадают с supplemental raw. Документальная правка устаревшего абзаца plan.md рассмотрена отдельно. Реализация в ходе QA не изменялась, чужие staged/unstaged правки сохранены.

Сопоставление раздела6 с доказательствами:

- Inventory покрывает статические и динамические категории, physics/CPU transient данные, UI и reset/rebuild/dispose. Проверены factory/owner/sharing/disposal в текущем коде; выявленные отсутствующие final teardown остаются явными кандидатами последующего этапа, а не объявлены исправленными. В0080–0082 зафиксированы bounded capacities, overflow/invalidation и риски эквивалентности.
- SceneProfile вызывается после принятия кадра и реального render; bounded typed ring создаётся только start(), stop() освобождает data/stages. Тест120/144callbacks подтверждает600 отдельных accepted/rendered rows за10сек. Интервалы идут по принятым timestamp, stage totals суммируют fixed steps без повторного добавления AI. renderFrame сохраняет autoReset=false на полный кадр; проверен порядок shadowMap.render/info.reset установленного Three.js и прямой/blur пути. GPU queries отделены от CPU submission, bounded/disjoint-aware; unavailable имеет явный статус.
- Независимый валидатор `docs/knowledge/scene-optimization/qa-0079-validate.cjs` подтвердил18full raw reports:6сцен×3повтора,60/300сек,10сек warm-up, один sourceHash, без errors/overwritten/duplicate IDs. Проверены монотонность IDs/timestamp, точные интервалы строк, actual mask1 всех живых процессов, валидные GPU rows. Все30lifecycle циклов имеют pickup consumed и restore available; отдельные6effects reports содержат60samples, skid tireSmoke10/damageSmoke69–70 и fade active2/proxyCreated20. Allocation raw содержит отдельный collected-object sampling; результаты не смешаны с timing. Повторное reduction через tools/scene-profile-summary.cjs воспроизводит опубликованные диапазоны/медианы.
- План измеренно ранжирует physics/gameplay и sampled churn, сохраняет осторожность для неподтверждённых GPU/raycast кандидатов. Бюджеты−20% stress physics, regression max baseline×1.05, allocation−50% подтверждённых источников, storage300civilian/2police/2effects/8inactive proxies заданы до оптимизаций. Следующие задачи актуализированы и остаются draft до зависимостей.
- Diff79 добавляет диагностику/counters без изменения gameplay/quality/blur/traffic defaults/STEP/AI cadence. Независимые live free/follow/menu/controlled hidden/loading/drive-reset/ordinary HUD сценарии прошли; screenshots free/follow/driving просмотрены, рендер сцены и HUD корректны.

Команды/результаты: `node tools/verify.js --full` с process affinity1, elevated после sandbox-отказа esbuild: **281/281 tests, production build pass**, receipt2026-10-11T10:01:19.786Z, fingerprint `2f76d8c8bc87c59aba7c5eee65c0b2d9fad305080e227d0311362043203a44b9`. Включены game-loop и scene-profile тесты раздела7. Журналы/квитанция: `qa0079-full-tests.log`, `qa0079-full-build.log`, `qa0079-full-receipt.json` в scene-optimization. Предыдущий независимый sandbox full имел281passed, но build Access denied при чтении родительского каталога: этот запуск не считается общим pass; повтор без ограничения прошёл. `node .../qa-0079-validate.cjs` — passed; `node tools/scene-profile-summary.cjs .../baseline-stable` — passed. Независимый Edge запуск tools/scene-regression.cjs с отдельными QA output filenames — **7/7, errors[]**, `qa0079-regression-regression.json` и три `qa0079-regression-*.png`.

Ограничения: длительная матрица не переснималась QA; её полнота и данные проверены независимо по raw/collector/source, а live regression и full suite/build повторены отдельно. Affinity1 — ограниченная воспроизводимая среда, не обычный multicore baseline; viewport390×844 наRTX4080 не аппаратный телефон. Supplemental helper объявляет/наследуетmask1, но не содержит собственного повторного CDP/OS inventory; actual inventory подтверждён основной18runсерией. Controlled document.hidden getter проверяет production обработчик паузы и не доказывает OS suspension. Задача79 не принимает/не заменяет отдельную blocked QA77 и не объявляет выполненными оптимизации80–82. Существенных дефектов критериев79 не найдено.

## Рекомендация модели исполнителя

gpt-6.1-sol, high. Достаточно для профилирования и фиксации решений по известному стеку; оценка цена/качество качественная, без точных тарифов.
