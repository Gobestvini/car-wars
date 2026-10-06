# TASK-0017: Все твики через Tweakpane

- Статус: done
- Приоритет: high
- Создана: 2026-10-06
- Обновлена: 2026-10-06
- Проект: CarWars, C:\Users\gobes\OneDrive\Документы\CarWars
- Рекомендуемый исполнитель: Средняя модель, высокий уровень рассуждения: миграция DOM и событий UI.
- Зависимости: нет

## 1. Цель и запрос пользователя

Пользователь просит использовать https://tweakpane.github.io/docs/ «для всяких твинов». Автор трактует это как твики параметров. Перевести все текущие настройки в Tweakpane и дать последующим задачам единый способ добавлять параметры.

Это подготовка задания, реализация не выполнялась. Численные решения автора явно помечены и допускают равноценную реализацию в указанных границах.

## 2. Проверенный контекст

Проверено 2026-10-06. Git HEAD: `c4546816659b200cf3e6f30f9e57b440e9639a43`. Рабочее дерево содержит незакоммиченные изменения в main/vehicle/style/index, driving-input/camera-distance, тестах, browser tools, README/VERIFICATION и файлах задач 0013–0016; присутствуют новые donut-input и инструменты UI/камеры. Это актуальный контекст, не чистый HEAD: не откатывать чужие правки. Скорость недавно восстановлена через #speedometer/#speed; сохранить её.

Стек: JavaScript ESM, Three.js 0.180.0, cannon-es 0.20.0, Vite 7.1.9, node:test; package.json содержит dev/build/test. Поведение ниже установлено чтением исходников, не запуском новых сценариев.

- `index.html`, `src/style.css`: ручная панель `#settings` и controls softness/grip/power/quality/trails, две команды сброса.
- `src/main.js`: `updateTuning`, `setSettingsOpen`, `applyQuality`, `resetCar`, чтение trails из DOM в frame.
- `package.json`, `pnpm-lock.yaml`: Tweakpane отсутствует.
- `tools/ui-check.cjs`, `tools/browser-check.cjs`, `tools/browser-reliability.cjs`, `tools/feature-check.cjs`: зависят от прежних controls.

## 3. Область изменений

Эти файлы и допустимые новые `src/settings.js`, `src/runtime-settings.js`. Не менять физику, генерацию города и камеру. Не добавлять анимационную библиотеку.

Сохранить текущую модель игрока, joystick/WASD/Space/R, настройку/reset, damage, loading/retry, debug API и индикатор скорости, кроме явно описанного изменения. Не редактировать node_modules/dist вручную. Не запускать эту задачу одновременно с другими правками тех же файлов.

## 4. Требуемое поведение

- Установить совместимую фиксированную npm-версию Tweakpane и обновить существующий pnpm lockfile; production не зависит от CDN. Прочитать [Getting started](https://tweakpane.github.io/docs/getting-started/), [Bindings](https://tweakpane.github.io/docs/input-bindings/), [UI components](https://tweakpane.github.io/docs/ui-components/): Pane, addBinding, кнопки и folders. Эти страницы проверены при подготовке; версию сверить при выполнении.
- Один объект параметров вместо чтения удалённых inputs из цикла. Сохранить диапазоны softness 0..1, grip 0.55..1.8, power 0.5..1.6 и DEFAULT_TUNING, high/low, trails, reset tuning и reset машины. Reset обновляет UI и исполняется ровно один раз.
- Сохранить оболочку открытия: default closed, aria-expanded, hidden/inert, Escape, Tab/focus, освобождение pointer/keys. Касание/редактирование значения в панели не управляет машиной и не запускает игровые shortcuts.
- Предложение автора: единый модуль settings регистрирует bindings и callbacks; TASK-0019/0021 добавляют туда roadWidth/trafficCount. Неработающие параметры заранее не показывать.
- На 390×844, 844×390, 1440×900 нет overflow, панель прокручивается в границах, цели управления ≥44 px. Сохранить скорость, loading/retry, явный debug, joystick, WASD/Space/R и window.carLab. Удалить старые дубли controls.

## 5. План для исполнителя

1. Найти все чтения controls в main и browser checks.
2. Подключить Pane и общий объект значений, перевести callbacks/frame на него.
3. Сохранить оболочку панели и адаптировать browser checks, проверяя эффекты, а не внутренние классы Tweakpane.
4. Проверить настройки/сбросы/ввод и заполнить отчёт.

## 6. Критерии готовности

- [x] Все пять настроек и две команды через Tweakpane реально действуют; старых дублей нет.
- [x] Редактирование не двигает машину; открытие отпускает joystick; скорость остаётся видимой.
- [x] Сборка, проверки и визуальный осмотр трёх viewport выполнены.
- [x] Отчёт заполнен фактическими результатами; статус и INDEX синхронизированы.

## 7. Проверки

### Автоматические

Рабочая директория — корень CarWars. `npm test`, `npm run build`; против `npm run dev`: `node tools/ui-check.cjs`, `node tools/browser-check.cjs`, `node tools/feature-check.cjs`, `node tools/browser-reliability.cjs`. Новые unit-тесты для внешнего UI не нужны; адаптировать существующие browser scenarios без ослабления эффектов.

Ожидается отсутствие ошибок и выполнение указанных сценариев. Если npm недоступен, использовать существующий Node: `node --test tests/*.test.js`, `node node_modules/vite/bin/vite.js build`, dev через `start.ps1` или `node node_modules/vite/bin/vite.js --host 0.0.0.0`. Browser tools допускают PLAYWRIGHT_MODULE с установленным Playwright и CARWARS_BASE_URL; не переустанавливать зависимости без необходимости. Новые tools из задания создаёт исполнитель.

### Ручные

На трёх viewport открыть/закрыть, поменять каждый control, обе команды reset; проверить Tab/Escape, ввод чисел и удержание joystick → открытие панели. Снять открытые/закрытые кадры.

При недоступном браузере/устройстве явно оставить соответствующие критерии открытыми и записать ограничение; не объявлять done без обязательных проверок. При подготовке задания проверки приложения не запускались.

## 8. Предположения, вопросы и условия остановки

«Твины» трактуются как твики: указанная библиотека предназначена для панели параметров. Persistence настроек не запрошено. TASK-0016 содержит прежнее требование удалить скорость; новый запрос пользователя и текущий восстановленный #speedometer имеют приоритет.

Перед выполнением прочитать зависимости и текущие файлы. Если зависимости не done, реализацию не начинать: сначала закончить их и актуализировать это задание. При существенном противоречии с более новым запросом руководствоваться запросом, указать расхождение в отчёте. Существенное изменение требований или необходимость выйти за область — записать конкретный вопрос, не выдавать непроверенное за факт.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0017-tweakpane-settings.md в CarWars. Прочитай AGENTS.md, docs/tasks/README.md и задание целиком. Проверь актуальность кода и завершение зависимостей; при незавершённых зависимостях сначала актуализируй готовность. Сохрани локальные изменения, реализуй только область задания, выполни обязательные проверки, заполни отчёт и обнови статус и docs/tasks/INDEX.md. Не ставь done при непроверенных критериях; укажи конкретные ограничения.
```

## 10. Отчёт исполнителя

- Результат: установлена Tweakpane 4.0.5; диапазоны авто, качество, trails и действия reset работают через единственную модель настроек. Скорость на экране и доступность компактной панели сохранены. Итерационный close/open и фокус работают.
- Изменённые файлы и зачем: `package.json`, `pnpm-lock.yaml` — dependency; `src/settings.js` — Pane/bindings/callbacks; `index.html`, `src/style.css` — оболочка панели и размеры touch targets; `src/main.js` — модель параметров и runtime callbacks; `tools/ui-check.cjs`, `tools/browser-check.cjs`, `tools/browser-reliability.cjs`, `tools/feature-check.cjs` — новые Tweakpane controls и проверки их реального действия.
- Команды и фактические результаты: Node 24.19.0 из runtime, pnpm 11.19.0. `pnpm test` — 66/66; `pnpm build` — успешно (ожидаемое предупреждение Vite о чанке Three.js). `node tools/ui-check.cjs` — 390×844, 844×390, 1440×900, speed, overflow, hidden/inert, focus/Escape, реальные range/settings effects и touch dimensions. `node tools/browser-check.cjs` — движение, поворот, reset, grip binding, keyboard/touch; `node tools/browser-reliability.cjs` — loading retry, quality, shaders; `node tools/feature-check.cjs` — damage, city smoke, controls. Все browser checks без JS errors.
- Ручные проверки: скриншоты настроек/сцены просмотрены в `tools/screenshots/settings-390x844.png`, `settings-844x390.png`, `settings-1440x900.png`; browser scenarios визуально отрисовали Tweakpane в Edge/WebGL software backend. Физический телефон не проверялся.
- Выполненные критерии: диапазоны softness/grip/power проверены текущими binding values и тестовым изменением сцепления 1.8→0.65→1.8; high/low и trails переключались; reset машины проверялся browser/feature check; speed отображается; панель свёрнута по умолчанию и освобождает удерживаемое управление.
- Непроверенное, блокеры и отклонения: реальный телефон не использовался; эмуляция Playwright прошла на указанных viewport. Tweakpane выбирает подписи списка также как строковые values, поэтому quality хранилище использует «Высокая»/«Лёгкая» и переводится в runtime `high`/`low`.
- Итоговый статус и дата: done, 2026-10-06.

