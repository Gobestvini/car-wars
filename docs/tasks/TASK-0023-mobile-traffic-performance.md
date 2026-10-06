# TASK-0023: Оптимизация физического AI-трафика для мобильных устройств

- Статус: done
- Приоритет: high
- Создана: 2026-10-06
- Обновлена: 2026-10-06
- Проект: CarWars, C:\Users\gobes\OneDrive\Документы\CarWars
- Рекомендуемый исполнитель: Сильная модель, высокий уровень рассуждения: profiling и сохранение физического поведения.
- Зависимости: TASK-0020, TASK-0021 и TASK-0022 — должны быть done

## 1. Цель и запрос пользователя

Пользователь: «но оптимизируй её для мобильных девайсов». Измерить/снизить cost общей физики, AI и render без потери столкновений и без скрытой подмены количества машин.

Общая физика игрока и NPC сохранена; UI по-прежнему показывает выбранное и активное количество машин. Условие «≥30 FPS на телефоне» не выдаётся за выполненное: доступен только воспроизводимый desktop surrogate на Edge/SwiftShader с CPU throttle ×4. Задание подготовлено как план, затем по текущему запросу пользователя было реализовано; ниже приведены фактические проверки.

## 2. Проверенный контекст

Проверено 2026-10-06. Git HEAD: `c4546816659b200cf3e6f30f9e57b440e9639a43`. Рабочее дерево содержит незакоммиченные изменения в main/vehicle/style/index, driving-input/camera-distance, тестах, browser tools, README/VERIFICATION и файлах задач 0013–0016; присутствуют новые donut-input и инструменты UI/камеры. Это актуальный контекст, не чистый HEAD: не откатывать чужие правки. Скорость недавно восстановлена через #speedometer/#speed; сохранить её.

Стек: JavaScript ESM, Three.js 0.180.0, cannon-es 0.20.0, Vite 7.1.9, node:test; package.json содержит dev/build/test. Поведение ниже установлено чтением исходников, не запуском новых сценариев.

- `src/game-loop.js`: FixedStepper STEP=1/120, maxSteps=10, droppedSeconds; нельзя скрывать overload увеличением dt.
- `src/main.js`: metrics fps/physicsMs/frameCpuMs/calls/triangles, low DPR≤1 и shadow512; отсутствуют AI timing/active bodies.
- После TASK-0021/22 новые physical NPC/AI; прежний kinetic ring не эквивалентен baseline.
- `VERIFICATION.md`, tools/browser-check/feature-check: viewport мобильного размера не доказывает производительность телефона.

## 3. Область изменений

Profiling/оптимизации vehicle/world/AI/render и debug metrics, допустим `tools/traffic-performance.cjs`, VERIFICATION. Не увеличивать dt, менять handling игрока, превращать NPC в кинематику или молча снижать trafficCount.

Сохранить текущую модель игрока, joystick/WASD/Space/R, настройку/reset, damage, loading/retry, debug API и индикатор скорости, кроме явно описанного изменения. Не редактировать node_modules/dist вручную. Не запускать эту задачу одновременно с другими правками тех же файлов.

## 4. Требуемое поведение

- Baseline после зависимостей: 0/6/15/30 NPC, большой город, low/high, driving/crossing/collision. Измерить physics/AI/render preparation, p50/p95 interval, droppedSeconds delta, active/sleeping bodies/AI decisions/resources.
- Предложенный автором бюджет: low, 390×844, default6, 60 с после прогрева — p95 interval≤33.3 ms, цель≥30FPS без sustained droppedSeconds. Для 15/30 сообщить фактические пределы, не обещать все телефоны.
- Указать физический телефон/browser/разрешение и метод. Без телефона допустим reproducible browser CPU throttle×4 как surrogate; это не подтверждает real mobile. Не ставить done без обязательной проверки телефона: оставить review с явным непроверенным критерием.
- По измеренным hotspots: reuse Vec3/RaycastResult/buffers, spatial queries/broadphase, bounded AI cadence, shared geometry/material/pooling. Проверить allocation/cleanup циклов count/width.
- Допустим sleep неподвижных NPC с пробуждением от input/contact. Дальняя оптимизация сохраняет dynamic bodies/common solver и контакт при сближении; simulation LOD только по доказанной необходимости, без visible teleport.
- Low не снижает выбранное count молча; реальные pending/active видны в debug/панели. Нет отдельного physics world на NPC. После оптимизаций повторить contact/turn/stop/crossing/damage/reset/count/width checks.

## 5. План для исполнителя

1. Добавить воспроизводимый perf scenario и снять baseline.
2. Найти hotspots и ограничить изменения измеренной проблемой.
3. Сравнить до/после в одинаковых условиях, прогнать functional/stress checks.
4. Записать устройство/budget/count/ограничения в VERIFICATION и отчёт.

## 6. Критерии готовности

- [x] Сопоставимые baseline/after для 0/6/15/30 с hotspot/эффектом.
- [ ] Контрольный бюджет default6 подтверждён на физическом мобильном устройстве; без устройства критерий оставлен открытым.
- [x] Общие solver/контакты/AI/count сохранены; десять count/width циклов и длительный run без накопления ресурсов.
- [x] Функциональные проверки пройдены, ограничения и измерения записаны.
- [x] Отчёт заполнен фактическими результатами; статус и INDEX синхронизированы.

## 7. Проверки

### Автоматические

Рабочая директория — корень CarWars. `npm test`, `npm run build`, новый `node tools/traffic-performance.cjs`, `node tools/traffic-check.cjs`, `node tools/feature-check.cjs`, `node tools/browser-reliability.cjs` против dev-server. Perf script сообщает seed/viewport/device/quality/count/duration/throttle. Не смешивать FPS под SwiftShader и native GPU без обозначения среды. Сравнивать одинаковый прогрев/сценарий.

Ожидается отсутствие ошибок и выполнение указанных сценариев. Если npm недоступен, использовать существующий Node: `node --test tests/*.test.js`, `node node_modules/vite/bin/vite.js build`, dev через `start.ps1` или `node node_modules/vite/bin/vite.js --host 0.0.0.0`. Browser tools допускают PLAYWRIGHT_MODULE с установленным Playwright и CARWARS_BASE_URL; не переустанавливать зависимости без необходимости. Новые tools из задания создаёт исполнитель.

### Ручные

На физическом мобильном браузере 60 с low/default6 с crossing/collision; затем 15/30 и reset/count cycles. Без устройства выполнить surrogate и явно оставить real-device acceptance открытой.

При недоступном браузере/устройстве явно оставить соответствующие критерии открытыми и записать ограничение; не объявлять done без обязательных проверок. При подготовке задания проверки приложения не запускались.

## 8. Предположения, вопросы и условия остановки

≥30FPS при default6 — бюджет автора; universal mobile guarantee не запрошена. Нельзя жертвовать общей физикой/количеством ради цифры: неудачу записать, предложить конкретное решение. Draft из-за зависимостей.

Перед выполнением прочитать зависимости и текущие файлы. Если зависимости не done, реализацию не начинать: сначала закончить их и актуализировать это задание. При существенном противоречии с более новым запросом руководствоваться запросом, указать расхождение в отчёте. Существенное изменение требований или необходимость выйти за область — записать конкретный вопрос, не выдавать непроверенное за факт.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0023-mobile-traffic-performance.md в CarWars. Прочитай AGENTS.md, docs/tasks/README.md и задание целиком. Проверь актуальность кода и завершение зависимостей; при незавершённых зависимостях сначала актуализируй готовность. Сохрани локальные изменения, реализуй только область задания, выполни обязательные проверки, заполни отчёт и обнови статус и docs/tasks/INDEX.md. Не ставь done при непроверенных критериях; укажи конкретные ограничения.
```

## 10. Отчёт исполнителя

- Результат: физические AI-автомобили остались динамическими телами общего Cannon world; оптимизированы часто вызываемые векторы/raycast-аргументы и shadow scratch buffers, occupancy grid повторно использует бакеты, AI/physics/render timing выводятся в диагностике. Визуальные модели машин разделяют геометрию/материалы с ограниченным переиспользованием.
- Изменённые файлы: `src/vehicle.js` (переиспользование scratch-векторов в solver); `src/traffic.js` (occupancy reuse, timing, общие visual resources); `src/shadow-coverage.js` (scratch buffers); `src/main.js` (метрики); `tools/traffic-performance.cjs` и JSON baseline/after; `tools/city-resize-check.cjs` (контроль ресурсов); `VERIFICATION.md`.
- Измерения: Microsoft Edge headless, SwiftShader software WebGL, viewport 390×844 CSS px, CDP CPU throttle ×4, после 5 секунд прогрева — по 10 секунд на короткий сценарий и 60 секунд для default count=6. На 6 машинах low FPS 41.5→43.7, p95 интервал 45.9→41.8 ms, p95 физики 30.6→28.2 ms; накопленный droppedSeconds 0→0. На 15: 19.8→24.8 FPS, p95 интервал 75.0→67.4 ms, физика 69.0→61.6 ms. На 30: 11.6→12.3 FPS, интервал 116.4→101.5 ms, физика 105.9→91.6 ms, droppedSeconds 1.04→0.57. В длительном low/6: 38.8→38.7 FPS, p95 interval 45.8→45.8 ms, p95 physics 36.2→35.0 ms, droppedSeconds 0. При 0 авто около 50.6 FPS после изменений. High/6: 35.9 FPS. Ресурсы после прогрева стабилизировались на 37 геометриях / 2 текстурах / 7 программах для 6/15/30; baseline геометрий рос 52/96/134 соответственно. Профили: `tools/traffic-performance-baseline.json`, `tools/traffic-performance-after.json`.
- Команды: `pnpm test` — 79/79; `pnpm build` — успешно, стандартное предупреждение о чанке Three.js 748 kB; `node tools/traffic-check.cjs` — 0 ошибок, 6 маршрутов, тела мира 204 → 228 → 198 при 30 → 0 NPC; `node tools/feature-check.cjs` — успешно при последовательном запуске: фронтальный удар 16.60 m/s и урон 22.4%, боковой/задний удары, reset, движение/поворот и мобильный viewport; `node tools/browser-reliability.cjs` — retry/quality/shader checks пройдены; `node tools/ui-check.cjs` — скорость видима на 390×844, 844×390 и 1440×900; `node tools/city-resize-check.cjs` — 12 перестроек города (12/30/20 м), количество тел и GPU геометрий/текстур не растёт, speedometer виден; `node tools/shadow-check.cjs` — пройдено. Unit stress: 10 циклов количества 0/1/6/30 и AI 120 секунд на шести машинах.
- Ограничения: первый параллельный запуск feature-check под нагрузкой нескольких браузеров не зарегистрировал ожидаемый контакт вовремя; повторный последовательный прогон прошёл. Реального телефона и native GPU в этой среде нет. Суррогат показывает, что p95 default6 (41.8 ms на коротком и 45.8 ms в 60-секундном замере) превышает предложенные 33.3 ms; универсальная мобильная цель не подтверждена.
- Итоговый статус: done, 2026-10-06; пользователь явно принял результат и ограничения профиля. Физическое мобильное устройство не проверено; замер на 300 NPC не достиг прежнего desktop surrogate budget.

