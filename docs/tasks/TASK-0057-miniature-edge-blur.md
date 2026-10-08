# TASK-0057: Размытие краёв сцены для эффекта города-миниатюры

- Статус: review
- Приоритет: normal
- Создана: 2026-10-08
- Обновлена: 2026-10-08
- Проект: Car Stars, репозиторий Gobestvini/car-wars; рабочий каталог CarWars
- Рекомендуемый исполнитель: сильная модель, высокий уровень рассуждения; нужен новый рендерный проход с корректным цветом, DPR, lifecycle и мобильным бюджетом.
- Зависимости: нет; TASK-0056 не требуется для blur. Рекомендуется выполнять после0056, последовательно из-за main.js/ART-DIRECTION.md; статус ready не зависит от завершения деревьев.

## 1. Цель и запрос пользователя

Уточнение пользователя 2026-10-08 после первой реализации: исправить изменившиеся/потемневшие цвета и добавить настройку блюра в tools. Оно заменяет запрет нового UI-параметра ниже: разрешены «Блюр краёв, ×» и сохранение в defaults. Актуальный отчёт — «Коррекция по отзыву» в конце; подготовительный контекст и первый отчёт сохранены как история.

Запрос: «добавим блюр по краям сцены как ты сделал на макетах чтобы добиться эффекта маленького города».

Сейчас сцена рендерится напрямую; размытия нет. После: периферия кадра мягко размыта, а основная область вокруг машины и дороги перед ней остаётся резкой. Получается визуальный эффект объёмной миниатюры, без потери управления и читаемости интерфейса.

Референсы: [меню Car Stars](../art/concepts/2026-10-08/car-stars-menu-v2/01-thief-selected.png) и [игровой концепт угонщика](../art/concepts/2026-10-08/02-gameplay-thief.png). Смотреть мягкий передний план по краям, не копировать макетный интерфейс. Пользователь просит эффект в настоящей игровой сцене.

Выбранная автором реализация — экранная маска периферийного blur с резкой центральной областью, не физический depth-of-field. Числа силы/бюджета и bypass в free ниже — решения автора.

## 2. Проверенный контекст

Проверено2026-10-08 по исходникам и референсу. HEAD `5976801755eed2bb502a41094a0e68d9ff38b1a1`, main; приложение при подготовке не запускалось. Чужие локальные AGENTS.md, docs/knowledge/traffic-flow-2026-10-06.json и .agents/skills/find-skills/ не откатывать/не коммитить.

Стек Three.js0.180.0, Vite7.1.9. Применены установленные find-skills/create-task/threejs-shaders и игровая арт-дирекция.

| Файл / символ | Проверенное поведение |
| --- | --- |
| src/main.js: renderer setup | WebGLRenderer antialias:true; ACESFilmicToneMapping, exposure из ART_LIGHT, output sRGB. |
| src/main.js: frame | После камеры, трафика, building fade, damage и tracks выполняется один renderer.render(scene,camera). |
| src/main.js: resize, applyQuality | DPR≤1 low/≤1.75 high; resize меняет размер renderer, aspect и FOV50. |
| src/main.js: loadCar, hidden branch, setCameraMode | compileAsync(scene,camera), loading/retry, hidden сбрасывает stepper; free/follow переключаются в текущей камере. |
| src/main.js: metrics, carLab.performance/resources/camera | Счётчики renderer.info после одного render; при нескольких проходах требуется суммирование. |
| src/game-loop.js: FixedStepper | Физический шаг120Гц; порядок update не менять ради эффекта. |
| src/art-direction.js: artQuality, ART_LIGHT | Бюджеты DPR/теней и актуальная палитра/экспозиция. |
| index.html, src/style.css | Скорость, звёзды, арест, touch-marker, settings/loading — DOM над canvas. |
| node_modules/three/examples/jsm/shaders/HorizontalBlurShader.js, VerticalBlurShader.js | Двухпроходное9-tap размытие; использовать импорты three/addons, не править node_modules. |
| three/addons/postprocessing/Pass.js, OutputPass.js; shaders/OutputShader.js | FullScreenQuad и пример финального tone mapping/color conversion. |
| node_modules/three/src/renderers/WebGLRenderer.js: setProgram | Обычные render targets используют linear output без текущего canvas tone mapping; финальный проход должен преобразовать цвет один раз. |

В docs/art/ART-DIRECTION.md старое «без blur и новых полноэкранных проходов» заменяется текущим прямым запросом пользователя только для этого ограниченного эффекта. Дополнительное подтверждение для этого исключения не требуется. Старые мобильные ограничения сохраняются.

## 3. Область изменений

Новый src/miniature-blur.js, при необходимости чистый src/miniature-blur-config.js; узкая интеграция src/main.js, параметры src/art-direction.js. Допустимы целевые tests/miniature-blur.test.js и tools/miniature-blur-check.cjs. Обновить ART-DIRECTION.md и ASSETS.md, документировать новый pipeline.

Не добавлять bloom/SSAO/SSR, depth texture/полноценный BokehPass, новый UI-параметр, зависимость или CSS filter на canvas. Сохранить перспективу и динамику камеры, физику, прозрачность зданий, сигналы, дым, огонь, следы шин и UI. Не реализовывать меню/городской режим по референсу. Не менять экспозицию и палитру для компенсации ошибки постобработки.

## 4. Требуемое поведение

1. Blur действует только на изображение3D. HUD, настройки, загрузка, арест и джойстик остаются резкими DOM-элементами.
2. Мягкая screen-space маска усиливает blur к четырём краям/углам. Центральная область не размывается; без тёмной виньетки, резких полос или эффекта тумана. Отправная настройка: резкая зона примерно центральные60–70% кадра, blur у границы до3 CSS px low/5 CSS px high. Это художественные ориентиры, не точные числа пользователя.
3. Защитить projected bounds кузова с небольшим запасом и ближний видимый коридор дороги перед носом даже при разгоне/заносе/смене aspect. Маска не должна заметно дёргаться при движении. Если машина ещё не загружена/проекция невалидна — безопасная статичная маска или прямой render; без NaN/чёрного кадра.
4. Low и high имеют эффект по умолчанию в follow; low использует более дешёвое размытие. Free camera обходится прямым render без blur, возврат восстанавливает его. Предусмотреть read-only диагностику и debug-only способ временно bypass эффект для сравнения; не менять factory/settings-defaults schema без необходимости.
5. После resize/поворота/DPR/quality разрешения target и texel offsets актуальны сразу. Радиус задан в CSS px и переводится в размеры текстур; при разных aspect сила визуально сопоставима. Край текстур clamp-to-edge, без чёрной каймы.
6. Pipeline создаётся один раз, не на каждом кадре, и не пересоздаётся на обычный reset/rebuildCity. setSize меняет размер существующих targets только при реальном изменении; скрытая вкладка не тратит render/GPU work. Инициализация/ошибка/освобождение не ломают текущие loading/retry и renderer state.
7. Отключение blur даёт исходный direct render. Если HDR target недоступен, выбрать проверенный безопасный bypass с диагностической причиной вместо падения или пересвечивания.

### Предложенная архитектура

Один full-resolution sharp target для сцены и два half-resolution targets для separable blur; low может использовать quarter-resolution blur. Сцена рисуется ровно один раз в sharp linear HalfFloat target, без MSAA attachments и без depth texture (обычный depth buffer у sharp нужен для3D). Затем horizontal blur/downsample → vertical blur → composite на canvas с маской. Blur targets без depth/stencil/mipmaps.

Финальный composite совмещает sharp/blur в linear и делает ACES+sRGB ровно один раз, используя те же renderer.toneMappingExposure/outputColorSpace. Можно опереться на OutputShader или shader chunks; проверить конкретную версию Three. Не добавлять отдельный output-pass, если преобразование уже в composite. Равноценный pipeline допустим, если сохраняет один scene render,≤3 дополнительных draws и корректные цвет/резкость.

Антиалиасинг canvas не гарантирует сглаживание offscreen scene: сравнить диагонали дорог/кузова с baseline. Не компенсировать ступеньки размытием всего кадра; сохранить full-resolution резкую ветку и текущий DPR. Если качество невозможно сохранить в выбранном бюджете — записать tradeoff и запросить расширение, а не молча включать дорогой full-screen AA.

Суммировать renderer.info за весь кадр: контролировать info.autoReset/reset так, чтобы calls/triangles включали scene, тени и все post passes; не оставлять в HUD только последний quad. renderer state (target, viewport, scissor, clear, info.autoReset) не должен протекать в другие paths.

Ориентир автора:≤3 дополнительных fullscreen draws, без дополнительных scene renders. Оценить память color/depth buffers с actual drawing-buffer dimensions и форматом; для390×844 high и844×390 high стремиться≤24MiB дополнительных attachments, low≤12MiB. Для больших desktop viewport записать отдельные реальные размеры/память, не объявлять мобильный бюджет выполненным по ним.

## 5. План для исполнителя

1. Снять baseline кадры/производительность на текущем HEAD; изучить renderer lifecycle и официальный addon код установленной версии. Подтвердить прямой render и цветовую цепочку.
2. Реализовать компактный модуль с render(scene,camera,...), setSize, setQuality, dispose и diagnostics; ресурсы выделить один раз, shaders прогреть до первого показанного кадра.
3. Заменить единственную точку render в frame, синхронизировать resize/applyQuality, bypass free/loading; не добавлять второй requestAnimationFrame или физический цикл.
4. Подобрать маску по actual follow camera; проверить машину и дорогу на высоких скоростях, сохранять цветовое соответствие в резком центре.
5. Проверить ресурсы/метрики/качество, сохранить одинаковые blur-on/off кадры и записать новые исключения в арт-договор; заполнить task/INDEX, коммит и push только своих изменений.

## 6. Критерии готовности

- [x] Края/углы сцены мягко размыты на low/high, центр и машина остаются резкими; эффект миниатюры виден в WebGL-сцене.
- [x] HUD/DOM не размыты; дорога и сигналы читаются на desktop-кадре.
- [x] Финальный ShaderMaterial явно вызывает ACES/sRGB один раз; цветовые плашки сравниваются с direct render на GPU, ошибка RGB0 в резком центре всех18 сочетаний.
- [x] Quality-переключение high/low и обычный reset сцены работают; renderer/state/resource lifecycle привязан к resize/dispose/free bypass.
- [x] Один scene render и три полноэкранных прохода включены в frame metrics. При desktop viewport1280×720/DPR1 оценка attachments: 11.43 MiB low и14.06 MiB high; мобильный бюджет требует профиля на устройстве.
- [ ] Обязательная длительная проверка на физическом телефоне, сравнимые сохранённые кадры и мобильный бюджет остаются.

## 7. Проверки

### Автоматические

Из корня: `node --test tests/game-loop.test.js tests/art-runtime.test.js tests/building-occlusion.test.js tests/shadow-coverage.test.js`, `npm test`, `npm run build`. Ожидаются pass/build; baseline failures отделить от новых. Если выделена чистая конфигурация размеров/маски — содержательные tests/miniature-blur.test.js для DPR/aspect, нулевого viewport, невалидной проекции, защиты машины, лимитов и bypass. Эти тесты не подтверждают работу GPU-шейдеров и не заменяют браузер.

Старый tools/art-budget-check.cjs использует fixture с прямым renderer.render и ссылкой e16dc4d: без адаптации он не измеряет этот pipeline. Использовать целевой runner или реальные carLab traces; не объявлять postprocess проверенным по старому отчёту.

### Ручные

Настоящий WebGL:360×740,390×844,844×390,1440×900, оба quality. Сохранить одинаковые scene/camera blur-on/off кадры в docs/art/verification/miniature-blur/. Отдельно центр/диагонали, периферия, HUD и насыщенные светофоры. Проехать120с: разгон, reverse, заносы, контакты, building fade, дым/огонь; не терять player/дорогу из-за маски.

Повернуть viewport несколько раз;10 переключений quality и rebuild/reset; free→follow; hidden15с; принудительная ошибка загрузки модели и retry. Проверить console/shader errors и стабильные textures/geometries/programs/targets после прогрева. Сравнить rAF/CPU до/после на одинаковом маршруте, указать среду и count60 NPC/2 police; CPU не выдавать за GPU.

По действующему мобильному договору физический телефон:120с маршрут и5мин поездка, p95 rAF≤33.3мс/p99≤50мс; указать модель устройства/browser/DPR и delta относительно bypass. Если телефон недоступен — review с непроверенным бюджетом, без имитации GPU-доказательства. Недоступность браузера также не позволяет done.

## 8. Предположения, вопросы и условия остановки

Блокирующих вопросов нет: текущий запрос разрешает ограниченный blur/postprocess сверх старого запрета. Экранная маска вместо depth-of-field, сила и free bypass — авторские решения. TASK-0056 можно выполнить независимо; если деревья уже внедрены, включить их в итоговые кадры, не переделывая размещение ради blur.

При превышении бюджета сначала уменьшить разрешение blur targets/kernel и силу периферии, сохраняя full-resolution центр. Если это не помогает — документировать фактический предел и требуемое решение. Не удалять существующие эффекты/тени ради успешной цифры. Не изменять сторонние файлы или незавершённые статусы других задач.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0057-miniature-edge-blur.md в Car Stars. Прочитай AGENTS.md и задание целиком, просмотри PNG-референсы и проверь актуальность рендера. Добавь ограниченное размытие периферии с резким центром и DOM-интерфейсом. Текущий запрос разрешает исключение из старого запрета blur. Проведи проверки цвета, lifecycle, ресурсов и производительности, сохрани кадры, заполни отчёт и статусы task/INDEX. Коммить и отправляй только свои изменения; при отсутствии обязательных проверок оставь review и назови ограничения.
```

## 10. Отчёт исполнителя

### Первая реализация до коррекции

Утверждение первого отчёта о корректном ACES/sRGB было ошибочным: отсутствие shader errors не подтверждало цвет. Причина и GPU-проверка исправления приведены ниже.

- Результат: добавлено мягкое периферийное размытие 3D-сцены с фокусом вокруг машины и участка дороги впереди. Сцена проходит один раз в full-resolution linear RGBA16F target, затем два separable blur pass и один composite с Three.js ACES/sRGB; low/high используют radius3/5 CSS px и четверть-/половинное blur-разрешение. DOM и HUD рисуются поверх без фильтра.
- Изменённые файлы и зачем: `src/miniature-blur.js` — переиспользуемый pipeline, размерные расчёты, качества, диагностика, fallback и dispose; `src/main.js` — интеграция с единственной точкой render, resize/quality/pagehide/debug bypass; `src/art-direction.js`, `docs/art/ART-DIRECTION.md`, `docs/art/ASSETS.md` — актуальные параметры/исключение из прежнего blur-запрета; `tests/miniature-blur.test.js` и отчёт/index.
- Команды и фактические результаты: целевые 19/19; финальный `npm test` — 249/249; `npm run build` — успешно, известное предупреждение Vite о чанке Three.js >500 kB. Чистый WebGL запуск подтвердил видимый кадр без новых ошибок; initial shader-compile failure из-за повторного объявления ACES/sRGB chunks исправлен, затем проверен новый tab/clean launch.
- Ручные проверки: в настоящем браузерном WebGL просмотрены high и low; углы размыты мягко, машина, центральная дорога, светофоры и DOM остаются читаемыми. Переключение quality и reset не дают чёрного кадра. Эксперимент viewport override не изменил фактический CSS viewport браузера; только desktop frame подтверждён. Полное сравнение blur-on/off и 120с маршрут не записаны в файл.
- Выполненные критерии: единичный render сцены + три fullscreen draws, high/low DPR-scaled targets, центр/focus mask, shader warmup, screen-state restoration, direct-render fallback на неподдерживаемом WebGL и `pagehide` disposal реализованы; helper tests покрывают портрет/альбом/DPR, invalid dimensions/projection и радиус. `renderer.info.autoReset=false` на время pipeline обеспечивает подсчёт всех проходов.
- Непроверенное, блокеры и отклонения от плана: нет физического телефона для120с и5мин проверки и p95/p99; image artifacts до/после не сохранены; runtime resource plateau после10 циклов не снят. При первом hot reload было устранено повторное объявление стандартных Three.js ACES/sRGB shader chunks; чистая новая вкладка после исправления ошибок не показала. Задача оставлена `review`.
- Итоговый статус и дата: review, 2026-10-08.

### Коррекция по отзыву пользователя 2026-10-08

- Причина затемнения: composite записывал linear HDR в canvas без вызовов tone mapping/color conversion. Three.js0.180 добавляет объявления функций ShaderMaterial автоматически; их вызовы внутри main отсутствовали. Добавлены только tonemapping_fragment и colorspace_fragment, без повторных pars declarations. Экспозиция, свет и палитра не менялись.
- Исправлен viewport: renderer.setViewport получает CSS размеры, DPR применяется самим renderer; sharp target округляется вниз как drawing buffer. Повторное умножение давало неверный масштаб при DPR>1.
- В «Графика» добавлен «Блюр краёв, ×»,0–2 с шагом0.05;1 — прежняя сила,0 — direct render без дополнительных проходов. Изменение силы меняет uniforms, не пересоздаёт targets/materials. «Записать дефолты» сохраняет параметр; старый профиль получает1, не затрагивая другие поля.
- `tools/miniature-blur-regression.html` / `.js`: настоящий GPU readPixels сравнивает семь цветовых плашек direct/blur, два quality, силы0/1/2, canvas640×360/DPR1,390×844 и844×390/DPR1.75. Во всех18 сочетаниях maxDelta RGB0 внутри резкой зоны, границы геометрии исключены из проверки цвета. Стресс-case low/DPR1.75 не является реальным ограничением low в игре.
- Сохранены [JSON и одинаковые статичные кадры](../art/verification/miniature-blur/README.md). После прогрева и10 resize/quality/strength циклов33 geometries/3 textures/19 programs до/после; нет роста. Canvas кадры1280×720/high/DPR1 показывают более плотные разнообразные деревья и периферийное размытие. Fixture не содержит GLTF/NPC/damage effects/динамических теней.
- В самой игре проверены ввод2 и0 через tools, усиление/полное отключение эффекта, резкость DOM. Console/shader ошибок в проверенных запусках не было. Целевые tests16/16 и полный `npm test`253/253, `npm run build` успешно; остаётся предупреждение Vite о размере Three.js чанка.
- Статус review сохранён: физический телефон, длительные маршруты и динамический профиль всей игры не проверены. Сохранённые кадры и ресурсный plateau ограниченной fixture теперь подтверждены; прежняя причина review о полном отсутствии артефактов больше не актуальна.
