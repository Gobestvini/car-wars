# TASK-0081: Оптимизация рендера сцены с сохранением вида мокапа

- Статус: draft
- Приоритет: high
- Создана: 2026-10-10
- Обновлена: 2026-10-11
- Проект: CarWars, Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; нужны GPU измерения, batching/culling и визуальная регрессия нескольких passes.
- Зависимости: TASK-0078, TASK-0080 — требуется done; использовать принятый план замеров и переснять baseline на принятом арте.

## 1. Цель и запрос пользователя

Продолжить полную оптимизацию сцены методами помимо пулинга: уменьшить фактическую стоимость рендера, uploads, draw calls/overdraw и ненужную работу за пределами видимости. Сохранить принятый свет, материалы, эффекты, населённость и поведение игры. Реализовать измеренно полезные методы из плана TASK-0079; каждый рассмотренный метод должен иметь результат либо обоснованный отказ.

## 2. Проверенный контекст

Чтение кода 2026-10-10, повторная сверка ревизии 2026-10-11, HEAD `b3501b7cb6d9233ce697e17c62bfa9023096ca78`, main; actual GPU profiling не выполнялся. Повторно сверить после зависимостей.

| Файл / символ | Проверенный факт |
| --- | --- |
| `src/city-scene.js`: `createCityScene` | Дороги объединены, buildings/разметка/части светофоров instanced; отдельные caps/walls/obstacles. |
| `src/city-art.js`, `src/city-trees.js`, `src/city-street-props.js` | Shared batches и материалы уже есть; props не требуют per-frame work, trees сгруппированы по crown type. |
| `src/building-occlusion.js`, `src/city-art.js`: hide/restore/proxy | Instance index привязан к building entry; fade имеет depth prepass и меняет matrices. Нельзя ломать mapping и прозрачность. |
| `src/traffic.js`: render и logical/physical policy | Frustum visibility уже есть; offscreen visual culling не должен менять физическую роль/AI. |
| `src/miniature-blur.js`: `drawPipeline`, `render`, `resize` | HDR sharp target +3 пары blur targets +composite; обход для free/strength0. В render временные Vector4/Color. |
| `src/signal-glow.js`, `src/car-damage-effects.js`, `src/tire-smoke.js` | Instanced прозрачные эффекты, часть frustumCulled=false; важны bounds и прозрачность. |
| `src/shadow-coverage.js`, `src/main.js`: sun/updateCamera/applyQuality | Следящие shadow bounds, quality512/1024, DPR1/1.75. |
| `tools/city-app-check.cjs`, `tools/miniature-blur-regression.html` | Actual-game captures и color/frequency GPU fixture. |

Локальные чужие изменения при подготовке: AGENTS/навыки/Telegram/INDEX/traffic-flow JSON. Сохранить актуальный diff при старте.

## 3. Область изменений

Актуализация по baseline0079,2026-10-11: полный GPU timer p95 median desktop3006.284288ms (повторы6.185984–6.358016), mobile3004.636672ms (4.619264–4.690944), CPU submission desktop1.9–2.1ms. Raw18runs и сводка находятся в `docs/knowledge/scene-optimization/baseline-stable`/`baseline-summary.json`. Первые кандидаты — redundant postprocess clears/state scratch и active transparent upload; GPU методы должны дать улучшение за пределами исходного разброса, остальные GPU p95≤baseline max×1.05. Calls/triangles учитывают тени и все passes;36visualpairs и color/frequency обязательны. Статическая сцена уже instanced/merged, batching/culling принимается только после индивидуального замера. Общий CPU bottleneck этой сцене находится в physics/gameplay; этот этап не объявляет всю оптимизацию законченной. После0080 переснять профиль и проверить применимость кандидатов, draft сохраняется до зависимостей.

Рендерные части перечисленных исходников, небольшой модуль spatial batches при необходимости, релевантные tests/tools, сравнительные артефакты `docs/knowledge/scene-optimization/` и `docs/art/verification/scene-optimization/`. Новые зависимости, смена движка/WebGPU, геометрии/моделей/дизайна исключены.

Сохранить gameplay/fixed step/AI, коллизии, полную карту, реальное количество объектов, default DPR/quality/blur и принятые ART/ART_LIGHT. Нельзя ускорять отключением теней, дыма, fade, blur или удалением машин/props. LOD допустим только с прежним силуэтом и без заметных переключений.

## 4. Требуемое поведение

- Сначала измерить уже существующий batching. Рассмотреть объединение оставшейся статической геометрии по совместимому material и пространственным блокам; shared geometry/material без массовых clones. Один гигантский batch не считать автоматическим улучшением: он может ухудшить culling.
- Spatial chunking/instancing применять там, где baseline подтверждает выгоду. Поддержать стабильное соответствие entry→batch/local index для fade/quality и корректные bounds. Уменьшение невидимой геометрии не должно увеличивать draw calls/GPU время сверх бюджета.
- Для неподвижных Object3D после установки transform допустимо отключить matrixAutoUpdate с явным updateMatrix; не отключать это у машин, анимированных pickups/proxies/camera/lights. Instance buffers обновлять только при реальном изменении, по диапазону там, где API версии0.180 поддерживает это.
- Frustum/distance culling и LOD декоративных деталей учитывать в follow/free, смене viewport/DPR и движении камеры. Расчёт bounds обязан включать всю анимацию; объект перед камерой не исчезает, тень от offscreen caster не пропадает. Физика не зависит от visual culling.
- Для shadow/transparent effects рассмотреть отбор casters, bounds, overdraw и active instance compaction, сохранив читаемые тени, fade и плотность/исчезновение эффектов. Не ставить shadowMap.autoUpdate=false при движущихся casters без полного корректного invalidation.
- Для blur/лучей рассмотреть переиспользование данных, отсутствие лишних clears/resizes/uploads, упрощение эквивалентных вычислений/проходов. Сохранить radius/mask/focus, AA, colorspace, fallback и renderer state. Не добавлять adaptive DPR как скрытое снижение качества. Изменение blur алгоритма допустимо только при эквивалентности, подтверждённой существующей GPU fixture и captures.
- Сохранить before/after полного кадра и crops при идентичном seed/pose/settings; свет/материалы должны соответствовать принятому TASK-0078. Измерить GPU при доступности timer, render CPU, calls/triangles/uploads и memory минимум в трёх повторах. Любой принятый candidate должен иметь подтверждённую выгоду; ухудшившийся candidate откатить.

## 5. План для исполнителя

1. Дождаться done зависимостей, обновить paths/mapping после пулов и baseline после света. Уточнить по TASK-0079 конкретные методы и бюджеты; только после этого ready.
2. Применять методы по одному: batching/sharing/static matrices/dirty uploads, затем culling/LOD/shadows/effects, затем postprocess. Снимать профиль и crops после каждого; равноценный более простой путь допустим.
3. Добавить содержательные тесты bounds/entry mapping/dirty state при изменении поведения. Использовать прежние regression fixtures цвета/blur/fade.
4. Повторить полную baseline матрицу, сравнить raw samples и visual artifacts, записать реализованные методы и измеренные отказы. Передать ready-for-qa.

## 6. Критерии готовности

- [ ] Все GPU candidates из плана разобраны; полезные применены, отказы подкреплены замерами/регрессиями.
- [ ] Доминирующий render bottleneck улучшен до бюджета TASK-0079; другие сценарии без регрессии сверх согласованного разброса. Calls сами по себе не заменяют измерение времени.
- [ ] Fade/roof mapping, culling/LOD, тени offscreen casters, low/high и follow/free корректны; нет исчезающих объектов/щёлкающих деталей.
- [ ] Сравнимые PNG и GPU fixture подтверждают сохранение арта, AA, blur и цвета; фактические counts объектов/quality defaults сохранены.
- [ ] Нет новых утечек/compile spikes, обязательные тесты и WebGL матрица пройдены.

## 7. Проверки

Из корня: `node --test tests/art-runtime.test.js tests/building-occlusion.test.js tests/shadow-coverage.test.js tests/miniature-blur.test.js tests/street-prop-placement.test.js tests/tree-placement.test.js tests/road-markings.test.js tests/tire-tracks.test.js tests/tire-smoke.test.js`, `npm test`, `npm run build`. GPU fixture `tools/miniature-blur-regression.html`: color/frequency pass.

Через `npm run dev`: baseline matrix TASK-0079 и capture matrix TASK-0078, zoom/rotation/free camera по краям карты, скрытие зданий с крышей, culling границы, тени от caster вне кадра, 10 quality/blur/resize/rebuild циклов. Сравнить полные кадры и crops при тех же seed/poses/settings; screenshots не ретушировать. Новая benchmark-команда из TASK-0079 обязательна; старые результаты SwiftShader не выдавать за hardware GPU. Без доступного GPU timer допускается ограниченный вывод по CPU/calls и визуальному результату, явно без заявления об улучшенном GPU времени.

## 8. Предположения, вопросы и условия остановки

Draft до измерений и приёмки зависимостей: конкретный выгодный способ chunking/LOD/blur заранее неизвестен. Нельзя обещать инстансинг каждой машины: индивидуальная деформация/модельные материалы могут сделать это невыгодным. Если каждый candidate ухудшает картинку/время, сохранить замеры и передать unresolved решение, не ставить done только за аудит.

## 9. Сообщение для передачи модели

```text
После done TASK-0078 и TASK-0080 актуализируй и выполни docs/tasks/TASK-0081-scene-render-optimization.md по baseline/плану TASK-0079. Примени измеренно полезные GPU/рендерные методы помимо пулов, сохрани принятый арт и игровые counts. Проведи performance/visual regressions, заполни отчёт и INDEX, передай ready-for-qa; done ставит независимый QA.
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

gpt-6.1-sol, high. Достаточно для эволюции текущего WebGL рендера при обязательных визуальных/временных проверках. Оценка цена/качество качественная, точные тарифы не проверялись.
