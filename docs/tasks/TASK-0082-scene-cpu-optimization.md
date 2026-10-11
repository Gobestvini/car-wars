# TASK-0082: Оптимизация CPU и итоговая проверка всей сцены

- Статус: draft
- Приоритет: high
- Создана: 2026-10-10
- Обновлена: 2026-10-11
- Проект: CarWars, Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; нужны безопасные изменения hot paths и регрессии общей симуляции.
- Зависимости: TASK-0081 — требуется done; использовать принятые baseline/пулы/арт всей предыдущей серии.

## 1. Цель и запрос пользователя

Закончить запрошенную полную оптимизацию сцены: убрать подтверждённые CPU/GC расходы в игровых циклах, повторные обходы/поиски и ненужное обновление данных. Проверить совокупный результат пулов, рендера и CPU на исходной матрице, сохранив gameplay и внешний вид.

«Полная» означает покрытие всех подсистем inventory с обоснованным решением, а не обещание отсутствия любых возможных дальнейших улучшений или60 FPS на каждом устройстве.

## 2. Проверенный контекст

Чтение исходников 2026-10-10, повторная сверка ревизии 2026-10-11, HEAD `b3501b7cb6d9233ce697e17c62bfa9023096ca78`, main; CPU profile при подготовке не снимался. После предыдущих этапов контекст обязательно обновить.

| Файл / символ | Подтверждённый кандидат |
| --- | --- |
| `src/main.js`: fixed-step внутри `frame` | Создание velocitiesBefore Map, actor массивов, policeIds Set, filter/map/find для damage/arrest/tracks/smoke; HUD вызывается в fixed-step. |
| `src/traffic.js`: `physicalActors`, `physicalTireSources`, `roleStates`, `nearbyOccupants` | Повторные snapshots/массивы; уже есть occupancy Map, role registry, AI ticks, hybrid LOD. |
| `src/tire-smoke.js`: `sample`, `emit`, `update`, `activeCount` | filter/sort/slice/Set, linear find свободной частицы и повторные проходы capacity. Пул уже фиксирован. |
| `src/repair-pickup-visuals.js`: `update` | Векторы/quaternion/matrix каждый кадр, новые axis/clone/offset на экземпляр. |
| `src/building-occlusion.js`: `vehicleSightTargets`, `occludedBuildingIds`, `update` | Sight targets/наборы/проверки здания; spatial broadphase кандидат только после профиля. |
| `src/miniature-blur.js`: `render` | Сохранение renderer state временными Vector4/Color на каждом кадре; учитывать уже сделанное в 0081. |
| `src/game-loop.js`, `src/vehicle.js`, `src/traffic-planner.js`, `src/traffic-junction.js` | Fixed-step/physics/AI и existing spatial/decision policies: не заменять их слепо. |
| `src/traffic-violations.js`, `src/arrest-system.js`, `src/wanted-system.js`, `src/repair-pickups.js` | Потребители snapshots: важен порядок before/after и реальные контактные события. |

Чужой diff AGENTS/навыков/Telegram/INDEX/traffic-flow JSON сохранить; коммитить только свои изменения.

## 3. Область изменений

Актуализация по baseline0079,2026-10-11:18full runs, отдельный60s allocation sampling32KB в `docs/knowledge/scene-optimization/allocation-stable`. Physics/gameplay p95 median desktop30022.9ms/mobile30023.4ms; бюджет серии≤18.32/18.72ms, CPU остальных случаев≤baseline maximum×1.05 (точные числа plan.md). Подтверждённые крупные источники sampled churn: `footprintsOverlap`/SAT axes/corners минимум3.56GB, `segmentHitsRect` минимум3.47GB; это оценка созданного объёма включая collected objects, не retained heap. Первые изменения — эквивалентные scalar/scratch проверки в `src/traffic-spawn.js` и `src/main.js`, с тестами границ/случайных OBB fixtures и сохранением contact/order semantics. Budget:≥50% снижения sampled sizes этих двух источников при одинаковом отдельном профиле; не сравнивать sampling-overhead CPU с обычной матрицей. Raycast candidate требует отдельного подтверждения CPU; actor views/pickup scratch/smoke остаются следующими кандидатами. После0081 актуализировать профиль, статус draft сохраняется до зависимости.

CPU части перечисленных модулей, специализированные scratch buffers/index helpers при необходимости, соответствующие tests и отчёты `docs/knowledge/scene-optimization/`. Допустимы read-only диагностические API. Смена движка/физики, Web Workers/WASM, новые зависимости и широкая архитектурная переработка исключены.

Сохранить STEP1/120, потолок60, catch-up/hidden/menu semantics, seeded AI, безопасный spawn, junction reservations, police pursuit/wanted/arrest/damage/repair, traffic LOD, эффекты/арт. Не уменьшать число физически необходимых автомобилей или частоту контактной физики ради бенчмарка.

## 4. Требуемое поведение

- Reuse scratch vectors/matrices/arrays/maps/sets и typed buffers там, где профиль показывает churn. Очищать length/entries без потери capacity. Не требовать «ноль всех JS allocations»: целиться в измеренные hot paths и дорогие constructors.
- Один согласованный actor snapshot на фиксированный шаг для потребителей, O(1) lookup по ID/role вместо вложенных find, безопасное обновление индексов на spawn/release/LOD/reset. Сохранить public read-only snapshots: вызывающий не должен наблюдать внезапную мутацию возвращённого объекта при следующем шаге. Внутренний временный view явно ограничить сроком жизни текущего шага.
- velocitiesBefore копировать до физики, а contacts/after positions читать после; не хранить ссылки на изменяемую velocity вместо прежнего значения. События impact/repair/wanted/arrest не теряются и не дублируются при повторном использовании буферов.
- Для smoke рассмотреть free-list/active-list и отбор ограниченного числа источников без сортировки всех; сохраняются прежние приоритеты player→police→civilian, distance limits, deterministic emission, capacity и alpha lifecycle. Не сканировать весь capacity ради activeCount при наличии корректного счётчика.
- Pickups используют заранее созданные scratch transform/axis, surface height кешируется лишь пока не меняется city generation; bob/rotation/respawn остаются прежними.
- Spatial broadphase/кэш кандидатов для building occlusion и traffic применять только по профилю, проверяя границы cells, быстрый проезд, телепорт/reset, смену камеры/road width и удаление actor. Narrow phase безопасности остаётся точным. Не кэшировать решение «не перекрывает» через изменившуюся камеру без invalidation.
- HUD/DOM обновлять только при изменении или в допустимом render/UI cadence; simulation events обрабатывать каждый необходимый шаг. Hidden/menu ранние выходы не запускают тяжёлые визуальные обходы; сохранённые показатели после resume корректны.
- Не менять AI think cadence, physics frequency или sleeping policy без доказанного сохранения существующих сценариев. Безопасный вариант — reuse/индексы/исключение повторных вычислений. Все изменённые caches инвалидируются на reset/rebuild/dispose.
- Финальный отчёт сравнивает исходный baseline 0079, каждый этап и совокупный результат минимум в трёх повторах: p50/p95/p99 CPU/frame/GPU где доступен, allocations/GC, calls/triangles, memory/pool highWater, droppedSeconds и gameplay. Сцену/настройки не облегчать. Любой пункт inventory имеет итог implemented/already-efficient/deferred с измеренной причиной; незакрытая обязательная цель означает незавершённую серию.

## 5. План для исполнителя

1. После done 0081 перечитать hot paths и свежий профиль, обновить бюджет/кандидатов и перевести в ready. Не повторять оптимизацию, уже сделанную пулом/рендером.
2. Убрать повторные snapshots/find и временные transforms; затем подтвердившиеся smoke/occlusion/HUD расходы. Изменения применять по одному и измерять.
3. Содержательно проверить lifetime snapshots, invalidation, event order, deterministic AI и selection priorities. Не добавлять тесты ради отсутствия каждого слова new в коде.
4. Выполнить regressions, полную производительную/визуальную/lifecycle матрицу серии. Составить `docs/knowledge/scene-optimization/final-report.md` с командами и raw JSON ссылками.
5. Передать ready-for-qa; QA отдельно проверяет CPU-этап и итог сохранения требований серии. Не закрывать предыдущие задачи без их собственной независимой приёмки.

## 6. Критерии готовности

- [ ] Измеренные hot paths оптимизированы; p95 доминирующего CPU времени достигает бюджета 0079, регрессий других сценариев сверх бюджета нет.
- [ ] Actor indices/snapshots/scratch buffers не нарушают before/after contacts, IDs, удаление, reset и seeded behavior; gameplay regressions проходят.
- [ ] HUD, pickups, smoke и occlusion сохраняют результат; allocation/GC profile подтверждает снижение churn без растущего cache.
- [ ] Полная inventory закрыта решениями; есть сравнение исходной, промежуточной и финальной сцены на одинаковой нагрузке, с честными ограничениями среды.
- [ ] Итоговая visual/lifecycle матрица и все проверки выполнены; внешний вид принятого 0078 и counts/settings сохранены.

## 7. Проверки

Из корня: `node --test tests/game-loop.test.js tests/traffic-flow.test.js tests/traffic-junction.test.js tests/traffic-liveness.test.js tests/traffic-violations.test.js tests/police-pursuit.test.js tests/arrest-system.test.js tests/wanted-system.test.js tests/repair-pickups.test.js tests/tire-smoke.test.js tests/building-occlusion.test.js`, `npm test`, `npm run build`. Добавить тесты snapshot lifetime/индекса/invalidation/event ordering только для реально меняемого поведения. Existing seeded длительные traffic suites не укорачивать ради pass.

Обязательная WebGL через `npm run dev`: вся performance matrix 0079, visual matrix 0078, полная погоня/повреждение/ремонт/арест, 20 spawn/fade cycles и 10 reset/rebuild/quality/hidden-resume cycles. Сравнить raw samples, CPU allocation profile, bodies/listeners/resources и принятые кадры. Если игра упирается в cap 60, улучшение оценивать временем/GC/headroom, а не требовать FPS>60. Длительные runs проводить порциями без потери промежуточных данных; физический телефон и surrogate различать.

## 8. Предположения, вопросы и условия остановки

Draft: точные CPU bottlenecks/бюджеты и актуальная структура появятся после 0079–0081. Пользователь не должен заранее выбирать технику оптимизации. Если изменение требует ослабления gameplay/качества или выхода за перечисленные границы, сохранить профиль и описать решение отдельно; не прятать это под «оптимизацией». Недоступная обязательная проверка не считается pass.

## 9. Сообщение для передачи модели

```text
После done TASK-0081 актуализируй и выполни docs/tasks/TASK-0082-scene-cpu-optimization.md. Прочитай AGENTS.md, baseline/план и результаты всей серии. Оптимизируй подтверждённые CPU/GC hot paths без изменения gameplay/качества, затем сравни совокупный результат с исходной сценой. Заполни final-report, отчёт задачи и INDEX, передай ready-for-qa; done ставит независимый QA.
```

## 10. Отчёт исполнителя

- Результат: Не выполнялась.
- Изменённые файлы и зачем: —
- Команды и фактические результаты: —
- Ручные проверки и выполненные критерии: —
- Непроверенное, блокеры и отклонения: —
- Итоговый статус и дата: —

## 11. Отчёт QA

Не проводилась.

## Рекомендация модели исполнителя

gpt-6.1-sol, high. Достаточно для безопасной оптимизации текущих JS hot paths с содержательными регрессиями. Оценка цена/качество качественная по доступным моделям, точные тарифы не проверялись.
