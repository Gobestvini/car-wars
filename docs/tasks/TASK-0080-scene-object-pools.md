# TASK-0080: Повторное использование динамических объектов всей сцены

- Статус: draft
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

- [ ] Все категории inventory имеют реализованную политику; повторные spawn/fade/effects в прогретой ёмкости используют storage повторно, created стабилен.
- [ ] У повторно выданной машины нет старого damage/AI/скорости/события; role/ID, pending spawn, hybrid LOD и listeners корректны.
- [ ] После20 циклов traffic0→60→300→0→60, police spawn/damage/despawn и повторного fade нет роста listeners/bodies/active resources; pool capacity не превышена.
- [ ] Shared ресурсы не уничтожаются на release; reset/rebuild/dispose не оставляют bodies, ссылки или GPU ресурсы; overflow не ломает gameplay.
- [ ] Внешний вид/управление сохранены, memory/CPU укладываются в бюджеты TASK-0079, проверки выполнены.

## 7. Проверки

Из корня: `node --test tests/traffic.test.js tests/traffic-physics.test.js tests/traffic-spawn.test.js tests/police-damage.test.js tests/building-occlusion.test.js tests/car-damage-effects.test.js tests/vehicle-repair.test.js`, `npm test`, `npm run build`. Добавить lifecycle-тесты acquire→mutate→release→acquire, exhaustion, stale ID/listener, unique deformation, double release/dispose, reset/rebuild. Проверять игровой результат и число bodies/listeners/factory calls, а не структуру реализации.

Обязательная игра через `npm run dev`: матрица TASK-0079 и20 циклов из критериев, столкновение с повторно выданным NPC/копом, полное повреждение/ремонт игрока, повторный fade с крышей low/high, hidden/resume и десять city rebuild. До/после — одинаковый environment и raw report с pool counters; post-GC память в прогретом состоянии не растёт монотонно. Полнота teardown подтверждается счётчиками и heap/resource inspection, а не только FPS.

## 8. Предположения, вопросы и условия остановки

Draft: отсутствуют измеренные capacities/overflow budgets и подтверждённый выбор building cache. Их определяет TASK-0079, дополнительных вопросов пользователю сейчас нет. Если reuse повышает память/старт выше бюджета, ограничить прогрев/ёмкость; не скрывать регрессию. Без обязательного WebGL lifecycle не объявлять приёмку. Смена игровой модели поведения выходит за границы.

## 9. Сообщение для передачи модели

```text
После done TASK-0079 актуализируй и выполни docs/tasks/TASK-0080-scene-object-pools.md. Прочитай AGENTS.md и inventory/baseline. Реализуй bounded reuse всех повторно возникающих категорий, сохрани shared ресурсы, IDs/listeners, физику и арт. Проверь нагрузку/lifecycle, заполни отчёт и INDEX, поставь ready-for-qa. Только независимый QA ставит done; чужой diff сохранить.
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

gpt-6.1-sol, high. Достаточно для специализированных пулов с независимыми регрессиями lifecycle. Оценка цена/качество качественная по доступному списку, без точных тарифов.
