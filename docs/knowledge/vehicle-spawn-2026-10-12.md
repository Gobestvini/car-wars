# TASK-0083: спавн машин — реализация и проверка

Проверка 2026-10-12, исходная ревизия `9f71cfe`, текущий diff TASK-0083. Изменены только vehicle pool, кадровая выдача гражданских машин и подготовка при загрузке; чужие изменения checkout сохранены.

## Реализация

`ObjectPool.prepareOne` создаёт idle storage без acquire/release callbacks и без eviction. `traffic.warmupVehicles` подготавливает суммарно 300 гражданских и 2 полицейских экземпляра по ключам вариантов, отдавая управление браузеру после каждой фабрики. Прогрев идемпотентен, разделяет поколения world/assets/registry, отменяется при dispose и допускает повтор после ошибки. GPU подготовка показывает только временные idle meshes за экраном загрузки; оба LOD уровня гражданских и обе уникальные police damage geometry загружаются до PLAY.

`advanceSpawnFrame` вызывается один раз на принятый игровой кадр, вне fixed physics loop. Интервал 25 мс, максимум одна машина, максимум 256 проверок кандидатов. Остаточный долг сбрасывается; меню, loading и visibilitychange обнуляют интервал. Safe placement и role immediate/pending API сохранены. Если желаемый civilian key занят полностью, выдаётся свободный совместимый вариант без смены его модели/геометрии и без новой фабрики.

## Автоматические проверки

- `npm run build`: pass, стандартное предупреждение Vite о Three.js chunk >500 kB.
- `node --test --test-isolation=none tests/*.test.js`: 304/304 pass (до последнего уточнения загрузки обеих уникальных police geometry).
- После уточнения: `node --no-opt --no-maglev --test --test-isolation=none tests/vehicle-spawn-scheduling.test.js tests/object-pool.test.js`: 11/11 pass. Новый тест доказывает подготовку двух разных police geometry и идемпотентность visual callback.
- `npm test` и последовательный worker suite на Node v24.19.0 несколько раз аварийно завершались в разных тяжёлых test-worker процессах. TAP зафиксировал exitCode 3221225477 (`0xC0000005`), отдельный запуск также выдал V8 Fatal `Check failed: fixed_size_above_fp ... outgoing_size == result`. Это не assertion failure. Не заявляем обычный `npm test` прошедшим; режим без workers прошёл, целевые checks подтверждены отдельно.
- Независимый QA после финального изменения успешно выполнил актуальный `node tools/verify.js --full`:305/305 tests и build, exit0, квитанция `.checks.json` ok=true. Этот запуск с обычными workers сработал; предыдущие аварии сохранены как ограничение воспроизводимости среды, а не текущий тестовый отказ. Fingerprint: `e53d56f65976e081a807a64cc9740297491bb1e2846530fac044d66f3c164bdb`.

## Браузерные функциональные проверки

Headless Microsoft Edge, WebGL, один локальный Vite, Windows. `tests/vehicle-spawn-browser-check.cjs`: 12 сочетаний 1440×900 / 390×844, low/high, сохранённый count 0/60/300 — pass. Во всех сочетаниях civilian.created=300, police.created=2; loading продолжает отрисовываться (357–609 callback кадра до modelReady); оба роли корректно заполняются после PLAY. Page errors отсутствуют.

10 циклов 300→0→300 с повреждением/удалением/возвратом полиции: created/evicted не растут. В одинаковом финальном состоянии bodies=736, beginContact listeners=3, GPU geometries=52/textures=6 во всех циклах. Heap через performance.memory после принудительного GC колеблется 41–56 МБ, без монотонного роста; это ориентир, а не доказательство отсутствия всех native/GPU утечек.

Reset/rebuild во время pending, 0→300→0, искусственная document.hidden пауза 5 с через настоящий visibilitychange handler и возврат — pass. Контролируемый compile error → RETRY продолжает подготовку без лишних storage, count60 корректен. Pagehide во время warm-up: pools={}, bodies=0, listeners=0, frameScheduled=false, contextLost=true. Дополнение `tests/vehicle-spawn-browser-check.cjs --menu-only`: пауза выдачи в меню, возврат, reset/rebuild, hidden, retry/dispose — pass; отчёт `vehicle-spawn-menu-check.json`.

Артефакты: `vehicle-spawn-browser-check.json`, `vehicle-spawn-menu-check.json`, четыре снимка `vehicle-spawn-{1440,390}-{low,high}.png`. Проверенные визуально desktop-high и mobile-low: корректная сцена/машины/HUD, без тестовых образцов и чёрного кадра.

## Метод сравнительного профиля

`tests/vehicle-spawn-browser.cjs before-controlled` извлекает read-only исходники ревизии 9f71cfe в `.task0083-reference` и обслуживает их через Vite, не меняя src. Test-only HTTP hook предоставляет прямой count control. Дополнительная instrumentation исходного `servicePending` измеряет его время. `after-controlled` использует текущие src. Одинаковые seed, карта, неподвижные игрок/камера, viewport1440×900, low, police0, blur0; 3 последовательных повтора 0→60 и 0→300, заполнение +10 с. Сэмплируются только отображённые игровые кадры по carLab.frameCounters, не все браузерные rAF. Heap до/после снимается CDP Runtime.getHeapUsage после HeapProfiler.collectGarbage. GPU counters — renderer.info.memory. Исходные диагностические `before.json`/`after.json` считают все браузерные rAF и оставлены отдельно; для критерия frame p95 они непригодны.

Финальные controlled JSON содержат все 6 прогонов каждой версии, без page errors. Медиана frame p95 трёх повторов: 60 машин —16,8→16,8мс, 300 —16,8→16,8мс. Средний p95 для60 —17,27→18,10мс (+4,8%); для300 —16,83→16,83мс. Один парный повтор60 имеет18,2→20,7мс (+13,7%); нельзя утверждать отсутствие регрессии каждого отдельного запуска. Во всех after максимум добавлений=1, created300/evicted0.

| Count / повтор | Frame p95 до → после, мс | Максимум spawn service до → после, мс |
| --- | --- | --- |
| 60 /1 |16,8→16,8|4,5→1,1|
| 60 /2 |18,2→20,7|1,3→0,4|
| 60 /3 |16,8→16,8|0,7→0,4|
| 300 /1 |16,8→16,8|2,6→0,7|
| 300 /2 |16,8→16,8|2,0→0,7|
| 300 /3 |16,9→16,9|2,0→3,2|

Медиана максимума сервиса:60 —1,3→0,4мс;300 —2,0→0,7мс. Холодный первый60 —4,5→1,1мс. Есть отдельный выброс3,2мс при300, без новой фабрики. Frame p99/max и полный набор интервалов/CPU histogram сохранены в JSON; общие hitch сцены не исчезли полностью. Заполнение300 занимает около10с вместо8,1с,60 около2с вместо1,6с — ожидаемая цена равномерной выдачи, в пределах12с на30Hz из задачи.

Загрузка modelReady 682→1971мс (это локальный warm filesystem/browser запуск, не сетевой холодный старт). CDP post-GC usedSize до PLAY:18 871 544→24 284 940байт (+5,16MiB). После одинаковых циклов/последнего300:33 003 904→33 418 768байт (+0,40MiB). GPU counters до PLAY выросли из-за загрузки вариантов заранее, после заполнения ресурсы стабилизируются; bytes VRAM этим методом не измеряются. Последнее уточнение GPU второй police geometry включено в финальный after-controlled профиль.

## Ограничения

Physical mobile device и дисплей >60 Hz не проверены; 30/60/120 Hz и jitter проверены синтетическим временем в tests. В браузере hidden моделировался через document.hidden, а не сворачиванием окна. Лимиты search/occupancy и role coordinate/cancel/damage safety проверены содержательными runtime regression tests; полный длительный маршрут управления игроком в браузерной матрице не воспроизводился. Уникальный GPU upload второй полицейской геометрии добавлен после основной matrix; требуется учесть при независимом QA.
