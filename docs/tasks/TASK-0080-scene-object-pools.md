# TASK-0080: Повторное использование динамических объектов всей сцены

- Статус: blocked
- Приоритет: high
- Создана: 2026-10-10
- Обновлена: 2026-10-11
- Проект: CarWars, Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; межсистемный lifecycle, физика, повреждения и shared GPU ресурсы.
- Зависимости: TASK-0079 — требуется done, inventory, baseline, capacities/overflow policy и актуализация этого задания.

## 1. Цель и запрос пользователя

Часть запроса на полную оптимизацию сцены и добавление объектов в пул. Устранить повторное создание дорогих динамических runtime/visual/physics объектов там, где они возвращаются в игру, сохранив bounded memory и игровой результат. Все категории inventory TASK-0079 должны иметь решение: пул, существующий буфер, постоянный/shared ресурс или измеренно обоснованное исключение.

Сейчас spawn/remove NPC и fade зданий создают/освобождают объекты; после прогрева повторный цикл использует их повторно в заданной ёмкости. Постоянную сцену не дублировать ради формального наличия пула. Снижение draw calls и CPU algorithms выполняются в следующих этапах.

## 2. Проверенный контекст

Чтение кода 2026-10-10, повторная сверка ревизии 2026-10-11, HEAD `b3501b7cb6d9233ce697e17c62bfa9023096ca78`, main. Это статические факты, не профиль производительности; актуализировать после зависимости.

| Файл / символ | Точка изменения |
| --- | --- |
| `src/traffic.js`: `createVehicleRuntime`, `add`, `removeAt`, `reset`, `setVisualAssets`, `dispose` | Создаются CarSimulation/mesh/AI/listener; remove удаляет body, detached wheels и police geometry. Civilian maxCount300, роль полиции имеет отдельный registry. |
| `src/vehicle.js`: `CarSimulation`, `reset`, `repair`, `disposeDamageListener` | Сброс физики/колёс/повреждений; reset сам по себе не гарантирует сброс AI или правильную повторную подписку. |
| `src/vehicle-visuals.js`, `src/traffic-models.js` | Общие assets, клонированная деформируемая police geometry, модельные варианты; не освобождать общие ресурсы на release. |
| `src/main.js`: `policeDamageVisuals`, `frame`, `rebuildCity`, pagehide | Police deformation/effects создаются по actor.id, удаляются при исчезновении; reset/rebuild/dispose требуют согласования владельцев. |
| `src/building-occlusion.js`: `startProxy`, `finishProxy`, `dispose` | Geometry/material clones, целостный depth prepass, restore instanced здания; повторный fade сейчас всё пересоздаёт. |
| `src/city-art.js`: `entry.art.proxy`, `hide`, `restore`, `setQuality` | Декор/крыши участвуют в proxy, quality может перестроить depth geometry. |
| `src/car-damage-effects.js`: `ParticlePool`, `CarDamageEffects` | Bounded particle pools уже есть; дорого повторное создание набора для каждой исчезнувшей police. |
| `src/tire-smoke.js`, `src/tire-tracks.js`, `src/repair-pickup-visuals.js` | Уже fixed capacity/ring buffer/instancing; сохранить и проверить, не создавать дубликаты. |

Чужие изменения AGENTS/навыков/Telegram/INDEX и traffic-flow JSON сохранить. При старте получить актуальный git status/diff; не коммитить чужую часть.

## 3. Область изменений

Актуализация по baseline0079,2026-10-11:18full runs в `docs/knowledge/scene-optimization/baseline-stable`, сводка/бюджеты в `baseline-2026-10-11.md` и `plan.md`. Lazy capacities: civilian300 суммарно по вариантам, police2/effects2; другие роли bounded по registry maxCount. Building cache8inactive/current-generation entry, LRU только inactive; измеренный lifecycle active highWater2. Factory count достигает790 за10циклов, listeners пока bounded1/3beginContact. Memory критерий последних5равных post-GC состояний и CPU регрессионные пределы определены в plan.md; после зависимости проверить supplemental fade/high-water и актуальность этих чисел. Это конкретизация задания, статус draft сохраняется до независимой приёмки0079.

Перечисленные runtime/visual/lifecycle исходники, содержательные тесты пулов и существующих подсистем, отчёты `docs/knowledge/scene-optimization/`. Допустимы небольшой `src/object-pool.js`, специализированные scene/vehicle pools и tests. Не создавать универсальный framework или новую зависимость.

Сохранить внешний API createVehicleRuntime, семантику actor IDs/ролей, безопасный spawn/pending count, logical/physical переходы, управление/физику STEP, damage/repair, fade/целостный depth, арт и quality. Не менять статусы исторических задач.

## 4. Требуемое поведение

- Интерфейс пула: acquire/release/reset/dispose и диагностика active/free/capacity/created/reused/highWater/overflow. Release идемпотентен либо отвергает double release явной ошибкой в диагностике; объект не выдаётся одновременно двум владельцам. Dispose окончательно освобождает ресурсы ровно один раз.
- Пулы разделить по несовместимым ролям/моделям/world generation; не переиспользовать stale geometry после смены assets/city. Логический ID нового actor остаётся новым, хотя storage переиспользован. Старая ссылка/асинхронный callback не получает доступ к новой жизни объекта.
- На release удалить body/detached bodies из world, reservations/occupancy, ссылки HUD/wanted/arrest, transient events и active effects. На acquire сбросить position/previousPosition/interpolation, velocity/forces, sleeping/collision state, wheels/suspension, damage/deformation, AI route/random/role state/target и все timers. Collision/damage listeners прикрепляются ровно один раз и обращаются к актуальному actor, а не к closure старого id/AI.
- Нельзя отдавать один повреждённый geometry buffer двум машинам. Геометрию восстанавливать из неизменённого эталона перед выдачей. Shared materials/textures живут дольше объектов и освобождаются owner при teardown.
- NPC/полиция, damage-effect containers и building proxies — обязательные кандидаты на reuse. Для зданий допустим lazy cache по entry или ограниченный совместимый pool; выбрать по TASK-0079, с memory cap, корректным depth и quality transitions. Тёплое повторное посещение не создаёт новые geometry/material/programs в пределах прогретой ёмкости.
- Ёмкости/прогрев брать из измерений TASK-0079, фиксировать до реализации. Нельзя заранее создавать 300 полных CarSimulation во всех режимах без оценки памяти/старта. Разрешено ограниченное lazy growth вне steady-state и дозированный warm-up. При исчерпании не отнимать активную машину: сохранить pending spawn; декоративный эффект может пропускать emission по прежней bounded policy. Неограниченный рост запрещён.
- Reset возвращает данные в пригодное состояние без дублирования слушателей, rebuild инвалидирует несовместимые ресурсы, pagehide/dispose уничтожает активную и свободную части. Скрытие таба/меню не вызывает накопленной волны spawn/effects.
- В inventory не остаётся категории без решения. Для существующих пулов достаточно доказать повторное использование и lifecycle; для одноразовой статичной геометрии обосновать sharing/disposal вместо дополнительного пула.

## 5. План для исполнителя

1. После done TASK-0079 сверить план/ёмкости, обновить контекст и перевести в ready до начала разработки. Сохранить свежий baseline, если параллельно менялся арт.
2. Ввести явных владельцев shared/unique ресурсов и проверяемый lifecycle пулов. Начать с vehicle acquire/release и идентичности listeners; не заменять это одним scene.remove/visible=false.
3. Связать police deformation/effects с reuse, обеспечить restore. Переиспользовать building proxies с прежней целостной прозрачностью/depth и переключением high/low.
4. Проверить existing smoke/tracks/pickups; покрыть пропущенные категории inventory. Добавить диагностические counters и сравнение factory churn до/после.
5. Выполнить регрессии и нагрузочные циклы. Записать память/created/reused/overflow и все исключения; передать ready-for-qa.

## 6. Критерии готовности

- [x] Все категории inventory имеют реализованную политику; повторные spawn/fade/effects в прогретой ёмкости используют storage повторно, created стабилен.
- [x] У повторно выданной машины нет старого damage/AI/скорости/события; role/ID, pending spawn, hybrid LOD и listeners корректны.
- [x] После20 циклов traffic0→60→300→0→60, police spawn/damage/despawn и повторного fade нет роста listeners/bodies/active resources; pool capacity не превышена.
- [x] Shared ресурсы не уничтожаются на release; reset/rebuild/dispose не оставляют bodies, ссылки или GPU ресурсы; overflow не ломает gameplay.
- [ ] Внешний вид/управление сохранены, memory/CPU укладываются в бюджеты TASK-0079, проверки выполнены.

## 7. Проверки

Из корня: `node --test tests/traffic.test.js tests/traffic-physics.test.js tests/traffic-spawn.test.js tests/police-damage.test.js tests/building-occlusion.test.js tests/car-damage-effects.test.js tests/vehicle-repair.test.js`, `npm test`, `npm run build`. Добавить lifecycle-тесты acquire→mutate→release→acquire, exhaustion, stale ID/listener, unique deformation, double release/dispose, reset/rebuild. Проверять игровой результат и число bodies/listeners/factory calls, а не структуру реализации.

Обязательная игра через `npm run dev`: матрица TASK-0079 и20 циклов из критериев, столкновение с повторно выданным NPC/копом, полное повреждение/ремонт игрока, повторный fade с крышей low/high, hidden/resume и десять city rebuild. До/после — одинаковый environment и raw report с pool counters; post-GC память в прогретом состоянии не растёт монотонно. Полнота teardown подтверждается счётчиками и heap/resource inspection, а не только FPS.

## 8. Предположения, вопросы и условия остановки

TASK-0079 принята независимой QA2026-10-11: capacities/overflow и проверяемый building cache budget зафиксированы в plan.md. Дополнительные skid/fade6/6прогоны подтвердили active2/proxyCreated20 за60сек и реальный дым. Дополнительных вопросов пользователю нет. Если reuse повышает память/старт выше бюджета, ограничить прогрев/ёмкость; не скрывать регрессию. Без обязательного WebGL lifecycle не объявлять приёмку. Смена игровой модели поведения выходит за границы.

## 9. Сообщение для передачи модели

```text
После done TASK-0079 актуализируй и выполни docs/tasks/TASK-0080-scene-object-pools.md. Прочитай AGENTS.md и inventory/baseline. Реализуй bounded reuse всех повторно возникающих категорий, сохрани shared ресурсы, IDs/listeners, физику и арт. Проверь нагрузку/lifecycle, заполни отчёт и INDEX, поставь ready-for-qa. Только независимый QA ставит done; чужой diff сохранить.
```

## 10. Отчёт исполнителя

- Результат: Реализованы lazy bounded пулы civilian300/police2/effects2, lease invalidation, очистка overlap/contact/cooldown/listener, восстановление деформации, cache8inactive для building proxies с high/low depth reuse и явный final pagehide owner. Разработка/проверки продолжаются.
- Изменённые файлы и зачем: object-pool, traffic, vehicle, building-occlusion, city-art, main, tire-smoke; содержательные pool/traffic/art/LRU tests; scene-pooling-check и pool counters в диагностическом sample. Политика всех категорий inventory — `docs/knowledge/scene-optimization/pooling-2026-10-11.md`.
- Команды и фактические результаты: целевые18/18; актуальный full `node tools/verify.js --full`288/288 и production build pass11:27:57Z, fingerprint971ff71dcee32e7717db7a5e41a44506ac804a3d7ef81b775ba501441796385d, affinity1. После frozen-контролей упрощён доступ к active actor без вложенных getter, release обнуляет старые поля. Final receipt/logs `pooling-direct-full-*`; прежние failed/success logs сохранены отдельно.
- Ручные проверки и выполненные критерии: актуальный `pooling-direct-stable/report.json`55/55 на src hash e781c68d7d478fa654c219dca1b11da53b95a410b88cc34ba124fe4b84e2f026:20traffic cycles, police terminal damage/deformation/reuse, две реальные contact episodes повторно выданных civilian/police, полный repair игрока,20fade/high-low,10rebuild, controlled hidden/resume, BFCache/final/double teardown. Factory civilian300/police2/effects2, overflow0; traffic heap range1086360≤2235178.45bytes, city range725884≤1985625bytes, resource/body counts стабильны; final bodies/geometry/textures/live GL programs0 и146owners dispose exactly once. Предыдущая visual36pairs с принятым0078: sameTransforms=true, calls/triangles неизменны, worst mean absolute channel error0.01461/255, GPU color/frequency fixture pass; актуальный повтор captures ожидается после timings.
- Непроверенное, блокеры и отклонения: полная18run timing matrix и CPU budget не подтверждены; final3low0 p95=13.3/9.1/6.8ms. Reference до пулов также не воспроизводит старый baseline, причина не установлена. Пользователь подтвердил параллельную нагрузку и затем явно изменил текущий порядок работы: «давай пропустим эти замеры … давай залей я гляну на девайсе». Дальнейшие performance замеры прекращены по этому запросу; ускорение и прохождение CPU budget не заявляются. Проверка на физическом устройстве ожидает пользователя, независимый QA должен учитывать это явное исключение, не считать отсутствующие данные pass. Актуальные36visualpairs/GPU fixture прошли: sameTransforms=true, counts неизменны, worst mean absolute channel error0.005651/255.
- Итоговый статус и дата: ready-for-qa,2026-10-11; публикация текущей проверенной реализации по запросу пользователя, без объявления полной оптимизации №81–82 выполненной.

## 11. Отчёт QA

Независимая проверка 2026-10-11, QA-подагент `qa_0080`, навык `.agents/skills/qa-tasks/SKILL.md`. Проверенная ревизия `934421a120ac2f74c5905f1d01c9839b1d30610c`; изучены изменения object-pool, traffic/vehicle, building-occlusion/city-art, main/teardown, lifecycle-тесты и исходник браузерного проверяющего инструмента. Реализация QA не изменялась.

- Актуальность доказательств: повторное вычисление src-only SHA256 дало `e781c68d7d478fa654c219dca1b11da53b95a410b88cc34ba124fe4b84e2f026`, совпадающий с `pooling-direct-stable/report.json`. Вызов экспортированной `fingerprint()` из актуального `tools/verify.js` дал `971ff71dcee32e7717db7a5e41a44506ac804a3d7ef81b775ba501441796385d`, совпадающий с успешной `pooling-direct-full-receipt.json`. Квитанция неизменённого кода переиспользована: журнал содержит288/288pass,0fail; production build прошёл. Старый путь `tools/telegram/verify.js` отсутствует после отдельной миграции; это расхождение инструкции, а не отказ проверки. Новый full/browser запуск не выполнялся.
- Критерий1 подтверждён: политика категорий inventory описана в `pooling-2026-10-11.md`; runtime имеет lazy bounded300/2, эффекты2, здания8idle LRU. Raw содержит20traffic-состояний,55проверок, `passed=true`, пустой список pageerrors; created после прогрева стабилен. Одновременная выдача и несовместимые варианты защищены lease/active map, active storage не вытесняется при exhaustion.
- Критерий2 подтверждён кодом и содержательными тестами из принятой квитанции: новый actor/AI/ID, invalidation старого lease, обнуление старого actor.simulation/mesh, active guard старого collide closure, восстановление deformer, очистка overlap/contact/cooldown и один актуальный listener. Тест повторно выданной police включает реальную world-contact episode и новое повреждение; браузерный raw включает отдельные production collisions civilian/police и полный repair игрока.
- Критерии3–4 подтверждены имеющимися актуальными WebGL доказательствами:20traffic циклов0→60→300→0→60,20police terminal damage/deformation/release,20fade high/low,10city rebuild. Отдельно проверены немедленный release полиции при controlled hidden, persisted/final/double pagehide. Final bodies/geometries/textures0, contextLost=true; все146наблюдавшихся resource owners dispose exactly once. Четыре JS program descriptors остаются в renderer.info, это не скрывается; проверяющий инструмент отдельно требует0live GL programs после context loss. Shared owner освобождается при final teardown, не при release.
- Часть критерия5 подтверждена:36visualpairs `pooling-direct/comparison.json`, одинаковые transforms/calls/triangles, максимальный mean absolute channel error0.005650747/255. Просмотрены мобильный high/blur/follow и настоящий fade-high кадр; крышa/цоколь сохраняют целостный fade. GPU color/frequency fixture и bounded quality/rebuild counters сохранены. По независимому пересчёту последних пяти raw traffic heap range1086360≤2235178.45bytes; city range725884≤1985625bytes, resources56/13/33 и bodies734 стабильны.
- Ограничения: hidden и pagehide синтетические/контролируемые; физическая OS suspension и игра на физическом телефоне не проверены. Прохождение CPU budget и полная18run матрица не подтверждены: финальные3low0p95=13.3/9.1/6.8ms при budget3.15ms. Сравнение причин и влияния пулов недостоверно из-за невоспроизводимого старого baseline и подтверждённой пользователем параллельной нагрузки; это не трактуется как воспроизводимый дефект именно пулов и не является доказательством ускорения.

Решение: **blocked — полная приёмка ограничена неподтверждённым performance-критерием и ожидаемой проверкой пользователя на девайсе**. Последний прямой запрос «давай пропустим эти замеры … давай залей я гляну на девайсе» имеет приоритет: дополнительные timing серии отменены, возвращаться к ним в рамках текущего запроса не требуется. Публикация текущего варианта разрешена пользователем и не означает `done`/прохождение CPU budget. Воспроизводимых функциональных дефектов в проверенном объёме не выявлено. Для полной приёмки требуется результат проверки на устройстве и согласованное решение по отложенному performance-критерию; отсутствующие данные не отмечены pass.

## Рекомендация модели исполнителя

gpt-6.1-sol, high. Достаточно для специализированных пулов с независимыми регрессиями lifecycle. Оценка цена/качество качественная по доступному списку, без точных тарифов.
