# TASK-0036: Устойчивое движение NPC без беспричинных зависаний

- Статус: in-progress
- Приоритет: high
- Создана: 2026-10-06
- Обновлена: 2026-10-06
- Проект: CarWars, C:/Users/gobes/OneDrive/Документы/CarWars
- Рекомендуемый исполнитель: Сильная модель, высокий уровень рассуждения: связанные traffic rules, FSM, физика и logical LOD.
- Зависимости: TASK-0034 и TASK-0035 — должны быть done; TASK-0033 — stop-plane реализована и должна использоваться как единый контракт

## 1. Цель и запрос пользователя

Запрос: боты останавливаются и ничего не делают. После исследования и safe spawn исправить причину остановок: допустимые очереди продолжают движение после разрешения, тупики с доступным безопасным выходом разрешаются; при полностью закрытом пути NPC ждёт с понятной причиной и повторной оценкой.

## 2. Проверенный контекст

Проверено по рабочему дереву 2026-10-06: Three.js 0.180.0, cannon-es 0.20.0, Tweakpane 4.0.5, Vite 7.1.9, node:test. Git HEAD: c4546816659b200cf3e6f30f9e57b440e9639a43. Дерево грязное: main.js, traffic.js, city-generator.js и другие файлы изменены; city-scene.js, settings.js, traffic-ai.js, traffic-signals.js, ряд тестов/tools и задачи0013–0029 untracked. Описание относится к рабочему дереву, не чистому HEAD. При подготовке тесты приложения и воспроизведение багов не запускались; симптомы даны пользователем, факты ниже проверены чтением кода. Сохранять существующие локальные изменения.

| Файл / символ | Проверенный факт |
| --- | --- |
| src/traffic.js / updateControllers, reservations, replanAtNearest | Выбор route, progress, signal, reservation и манёвра связан в одном проходе по states. |
| src/traffic.js / noProgressTime, stuck-recovery | Без leader timer обнуляется; с постоянным leader replan recovery не запускается; недостаточно просто увеличить steering/throttle. |
| src/traffic.js / passingOffset | Static corridor check, нет прогноза времени сближения/проверки всего return path. |
| src/traffic.js / stepLogical, updateLod | Внешний logical control тот же, движения/contacts различаются; правило не должно работать лишь рядом с player. |
| docs/knowledge/traffic-npc-reference.md; TASK-0034 | Начальные рекомендации и обязательный design/trace этап. |
| tests/traffic-ai.test.js, traffic-physics.test.js, traffic.test.js | Existing route/leader/reservation/LOD tests; требуется измерять движение, не только имя state. |

## 3. Область изменений

После ADR34: traffic.js/traffic-ai.js и небольшие helper modules для follow/progress/intersection/maneuver по выбранному плану. Сохранять CarSimulation shared world,60/300,10Hz decisions,STEP=1/120 игрока, signal phases и обычную камеру/UI. Не мигрировать к внешнему симулятору. Сохранять загрузку/retry, speedometer, обычное управление/пончики и штатный Tweakpane. Не редактировать node_modules/dist вручную и не откатывать чужие изменения. Внести отчёт и статус в этот файл и INDEX.

## 4. Требуемое поведение

- Окончательный набор/interfaces/параметры заполняет исследование34; до завершения зависимостей не начинать production patch. Базовые требования ниже обязательны независимо от выбранной car-following модели.
- Применить ADR `docs/knowledge/traffic-npc-design.md`: snapshot→hazards→decision→controls на одном состоянии, общий для logical/physical LOD. Сохранить10Hz решений/STEP=1/120s и spatial hash12м; не выполнять state mutations так, чтобы результат зависел от порядка обхода.
- Продольное следование использует oriented bumper gap и closing speed; стартовые параметры для проверки `s0=2м`, `T=0.8с`, `b=5.5м/с²`, city speed≤8.5м/с. Оставить bounded safe-speed эквивалент; full IDM не обязателен. Красная фаза использует TASK-0033 stop-plane и передний габарит.
- Прогресс мерить вдоль направленного ребра. `noProgressTime` растёт при<0.2м продвижения за1с только вне законного wait reason; после3с сделать path/corridor reevaluation. reason/state различают signal, очередь, junction priority, blocked exit, no path, collision jam и controller stall.
- Junction keep-clear проверяет выходной oriented footprint минимум4.16м+2м до въезда. FIFO/aging использует request time и stable ID tie-break; entered reservation освобождается после заднего bumper выхода; stale owner очищается по удалению/route invalidation, timeout не разрешает второй конфликтный въезд.
- Recovery планирует swept oriented footprint ведущих/задних/встречных участников до3с на полном пути выезда/возврата; `cooldown=2с`, reevaluation без коридора каждые0.5с. Два участника взаимного контакта имеют устойчивый yield priority. Полностью закрытый путь означает объяснимое ожидание без телепортации/удаления/отключения contacts.
- Приёмочные метрики: после green/освобождения лидера начать движение≤3с; после stall≥3с переоценить путь; две контактирующие машины со свободным corridor разъезжаются≤15с. При полностью заблокированном выходе законное ожидание не является liveness fail.
- Reset/count/network/mode переходы очищают stale progress/requests без потери route/ID и скачка позиции. У300 возможна настоящая очередь: не обещать свободное движение каждой машины при полной блокировке сети.
- Опубликовать diagnostics waitingReason/blocker/progressTime/reservation age/maneuver и trace. Не маскировать сложные случаи state='following' при нулевой физической скорости.

## 5. План для исполнителя

1. После done34/35 проверить актуальность helper contracts и прочитать весь research ADR; перевести draft→ready и записать выбранный scope.
2. Воспроизвести исходные trace fixtures и реализовать выбранный follow/progress/junction/recovery по этапам.
3. Прогнать одинаковые ситуации в logical и shared physical mode, displaced car и mutual contact.
4. Выполнить стресс/регрессии и профилирование в одинаковой среде; записать residual настоящий congestion отдельно от bugs.

## 6. Критерии готовности

- [x] Green/освобождение дороги запускает очередь в утверждённый срок; signal waiting не провоцирует незаконный объезд.
- [x] NPC после толчка/off-route без лидера восстанавливает progress либо сообщает конкретное отсутствие safe route.
- [x] Два соприкоснувшихся NPC со свободным corridor выходят за15 с без прыжка/удаления; occupied/oncoming corridor блокирует манёвр.
- [x] Перекрёсток с забитым выходом не запирается новыми въездами, нет starvation/stale owner или конфликтной entered reservation.
- [x] Logical и physical mode сохраняют safety/liveness; tests/trace/профиль60/300 записаны.

## 7. Проверки

### Автоматические

`pnpm test`; `pnpm build`; `node tools/traffic-check.cjs`; `node tools/city-resize-check.cjs`; `node tools/traffic-performance.cjs`; `node tools/traffic-repro.cjs`. Добавить deterministic15–60с fixed-step traces для всех критериев: physical contact, red→green, leader clear, blocked outbound, two-way yield, lost route и logical↔physical. Проверять прогресс/footprint/gaps, а не только state. Сравнить performance на6/60/300 до/после с TASK-0027 desktop surrogate baseline при одинаковом seed/environment; реальный телефон нужен только для заявления о мобильном бюджете.

Команды выполнять из корня CarWars, против существующего dev-server или `pnpm dev`. Browser tools используют `CARWARS_BASE_URL` и при необходимости `PLAYWRIGHT_MODULE` для установленного Playwright; не устанавливать зависимости только ради запуска проверок. Ожидается отсутствие ошибок, результаты записать в отчёт. Если обязательная проверка недоступна, оставить соответствующий критерий открытым и статус review.

### Ручные

Desktop/mobile viewport: поездка среди60 NPC, red queues, перекрёсток с blocked exit, collision jam и displaced NPC; свободной камерой проверить logical район. Потом count300 стресс и возврат60, десять reset/rebuild. Настоящий затор имеет причину и реагирует на открытие пути.

## 8. Предположения, вопросы и условия остановки

Draft из-за зависимости от done34/35. Runtime overlaps воспроизведены trace для count300 и переданы safe insertion в TASK-0035. Постоянный необъяснимый stall в зафиксированном scenario не воспроизведён; stall/off-route fixture всё равно обязателен для proof, поскольку code inspection выявил неполный no-progress timer. Эта задача заменяет незавершённую liveness-приёмку24 по новому запросу; предыдущий отчёт сохранить. Полный MOBIL, highway presets и runtime SUMO/CARLA вне scope. Если механика потребует внешнего движка/новой road topology, сначала актуализировать scope отдельным решением.

Перед правками перечитать актуальный код и задание. Новейший запрос пользователя имеет приоритет; при расхождении записать его. Незавершённые обязательные зависимости не допускают ready. Невыполненные обязательные проверки означают review, а не done.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0036-npc-traffic-liveness.md в CarWars. Прочитай AGENTS.md, docs/tasks/README.md и задание целиком. Проверь актуальность кода и зависимости, сохрани локальные изменения. Выполни изменения в указанной области, проведи перечисленные проверки, заполни отчёт и обнови статус задачи и INDEX.md. Не объявляй done при открытых критериях; запиши конкретное ограничение.
```

## 10. Отчёт исполнителя

- Результат: начат аудит и проверена базовая ливнес-регрессия. Попытка добавить edge-progress/bumper-aware braking и rear-clear reservations нарушила два существующих traffic-ai сценария; эти незавершённые правки сняты, текущая реализация оставлена в исходном состоянии. Без полного swept-path/recovery решения работу закрывать нельзя.
- Изменённые файлы и зачем: production-файлы не изменены; диагностический план и границы незакрытой работы зафиксированы в этом отчёте.
- Команды и фактические результаты: после снятия неудачного прототипа `node --test tests/traffic-ai.test.js` — 8/8 pass; изолированный `node --test tests/traffic-spawn.test.js` — 4/4 pass; полный `pnpm test -- --test-concurrency=1` — 103/103 pass. Параллельный прогон может нестабильно завершать worker тяжёлого spawn-файла. `pnpm build` — pass.
- Ручные проверки: не выполнялись.
- Выполненные критерии: регрессионный baseline возвращён; никакого скрытого выключения физики/телепортации не внесено.
- Непроверенное, блокеры и отклонения от плана: все требования liveness, swept return path, FIFO aging, keep-clear, физический взаимный разъезд и логический LOD остаются открытыми. Нужна отдельная итерация с deterministic trace tests перед внедрением AI-контрактов.
- Итоговый статус и дата: in-progress, 2026-10-06.

### Завершение 2026-10-06

- Результат: предыдущий неудачный прототип заменён проверенным snapshot→hazards→FIFO decisions→controls controller. Одна occupancy snapshot на10Hz, общие правила для physical/logical LOD и физический STEP1/120 сохранены.
- Файлы: src/traffic-planner.js выделяет oriented bumper/headway safe-speed (s0=2,T=0.8,b=5.5), edge progress, swept corridor, passing и direction-aware reverse control; src/traffic.js интегрирует keep-clear, rear-clear reservations, deterministic contact retreat и диагностику. tests/traffic-liveness.test.js содержит16 целевых сценариев, traffic-ai/physics/traffic дополняют регрессии.
- Прогресс: <0.2м за1с вне signal/queue/priority/blocked-exit увеличивает stall age; после3с маршрут/коридор переоценивается. Ближайшая lane lookahead цель возвращает смещённую машину на полосу. Recovery имеет2с cooldown и0.5с retry; waitingReason/blocker/progressAlong/reevaluations/reservationAge/maneuver доступны в carLab.
- Безопасность: весь путь выезда и возврата проверяется oriented footprint с3с прогнозом лидера, задних и встречных. Для recovery используется расширенная spatial shortlist и всегда учитывается игрок; граница дороги проверяет повёрнутый кузов, окончание манёвра оставляет передний бампер перед stop-plane. Новые маршруты не двигают тело. Контактный yield определяется устойчивым ID, манёвры учитывают уже принятые чужие коридоры.
- Junction: выходной footprint длиной4.16м плюс2м проверяется до въезда; очередь сортируется requestedAt/ID. Entered reservation удерживается до выхода заднего bumper, а не истечения timeout или смены route node. Невошедший заблокированный owner освобождает заявку; removed owner очищается.
- LOD: устранён каскад включения физики через далёких соседей; activation привязана к зоне взаимодействия игрока. Ground-only contact не удерживает дальнее тело, настоящие контакты с машинами/препятствиями сохраняют физику. Проверка безопасной активации выполняется только для её кандидатов; mode snapshot не зависит от порядка state iteration.
- Автоматические проверки: node --test --test-concurrency=1 tests/*.test.js —124/124 pass; pnpm build — pass с обычным предупреждением Three.js chunk. Browser traffic-check/city-resize-check/traffic-repro/traffic-direction-check — pass без page errors; 12 rebuild без накопления ресурсов. Trace: docs/knowledge/traffic-liveness-trace-2026-10-06.json, в восьми snapshots60/6/300/reset нет OBB overlaps. Startup/смена green могут иметь одиночный кадр near-zero до первого motion tick; после5с необъяснимых near-zero в зафиксированных снимках нет, устойчивый stall проверяется отдельными фиксированными fixtures.
- Приёмочные fixtures: red5с не вызывает объезд и green выпускает≤3с в обоих LOD; leader-clear≤3с в обоих LOD; взаимный физический контакт разъезжается за15с без прыжка/удаления; проход неподвижного игрока и возврат без chassis contact/OBB overlap; закрытый/встречный/задний/return corridor запрещает манёвр и повторно проверяется; displaced NPC за15с возвращается с progress; blocker-free stall вызывает reevaluation; entered reserve не передаётся по timeout; FIFO результат одинаков при обратном порядке массива. Шесть hybrid NPC проходят >100м каждый за120с и меняют цели.
- Профиль: tools/traffic-performance.cjs, Edge/SwiftShader,390x844,DPR1,CDP4x,seed20261005,5с warmup,10с короткие/60с длинный, отдельная чистая сцена каждого count. Итоговый JSON: traffic-liveness-performance-2026-10-06.json; до исправления LOD: traffic-liveness-performance-before-lod-2026-10-06.json. Low6:36.4FPS/p95 33.3мс; low60:29.0FPS/p95 50.0мс,8physical/52logical,0 dropped; low300:10.9FPS/p95 141.6мс,23physical/277logical,1.48с dropped; длительный low60:31.2FPS/p95 54.1мс,0 dropped. До LOD: low60 12.2FPS/p95 116.7мс; low300 2.93FPS/p95 458.3мс. Geometry/texture/programs стабильны24/2/8.
- Сравнение TASK-0027: прежний1с surrogate low60=31.0FPS/p95 66.7мс,low300=10.2FPS/p95 154.2мс. Текущее длительное измерение не является идентичной1с выборкой; оно не доказывает мобильный бюджет33.3мс. Реальный congestion на300 допустим и не маскируется телепортацией; физический телефон не проверялся. Первоначальный sequential stress не заполнил300 за15с из-за безопасного insertion, runner теперь допускает очередь и использует свежий seed для сопоставимых профилей.
- Визуальная сверка: свободная камера над городом, реальные левые/правые повороты после выхода в правую полосу; desktop/mobile screenshots и управление игрока/пончики проверены общей серией. Сложные заблокированные дорожные сценарии доказаны deterministic shared-world/LOD tests, не выдаются за проверку каждого случайного затора.
- Итог: done, 2026-10-06. Ограниченный локальный planner, не полноценный городской navigation/ПДД engine; старый отчёт сохранён выше.

### Повторное открытие по длительному обзору города, 2026-10-06

- Новейший запрос: при длительном просмотре города сверху трафик должен продолжать движение; добавить длительный тест. Дополнительно уменьшить интервалы между машинами и после настоящего удара игрока запускать ускоренное бегство с укрытием за зданиями и возвратом к обычному циклу. Эти требования расширяют прежний scope; первоначальные s0=2/T=0.8 и общий предел8.5 являются baseline, не ограничением новой калибровки и временного бегства.
- Воспроизведение: при60 NPC через140с весь трафик неподвижен. Распространение legal wait тормозило даже далёких последователей; на выходе поворота body-heading leader ошибочно видел встречную очередь. Entered owners удерживали junction больше100с, так как не могли закончить поворот. Короткая предыдущая browser-трасса этого не обнаружила; прошлое done не доказывало длительную устойчивость.
- Исправление: очереди закрывают gap через bounded safe-speed, а не копируют полный тормоз лидера. Leader определяется относительно направленной полосы, lookahead и скорость незавершённого поворота уменьшены. Контактная машина с препятствием сзади может отъехать вперёд; заблокированный передний коридор сохраняет торможение/recovery. Runtime bumper gap1.1м, headway0.55с; conservative spawn gap2м оставлен без изменений.
- Бегство: настоящий Cannon player/chassis impact от1.5м/с включает evasion; дальняя цель выбирается по дистанции/укрытию и без немедленного разворота навстречу преследователю. На прямой цель11.5м/с, повороты/сигналы/очереди остаются безопасными. Через6с при достаточной дистанции и укрытии либо через20с режим завершается; повторный удар перезапускает его. Identity, физические контакты и логический LOD сохраняются, reset отменяет реакцию. Источник: src/traffic-evasion.js, диагностика carLab.trafficAI().evasion.
- Автоматические проверки: tests/traffic-flow.test.js проходит300с default city с реальными зданиями,60 NPC и неподвижным игроком. Каждые60с все60 проходят>5м; каждый за весь прогон>150м. Не допускаются остановка всего города, entered reserve>20с, скачки и OBB overlaps в секундных snapshots. Во второй половине камера смотрит вне города: culling не останавливает движение. Полный node --test --test-concurrency=1 tests/*.test.js —132/132 pass; pnpm build — pass с прежним предупреждением Three.js chunk.
- Точечные регрессии: исходная взаимная блокировка turning owner/встречной очереди выпускает обоих; stopped leader с20м до последователя закрывает gap до0.7–1.8м без объезда. Настоящие rear/front/side chassis impacts запускают evasion и безопасный выход из контакта; NPC разгоняется>9м/с, сохраняет ID и переходит в logical LOD, затем возвращается к обычной скорости. Quiet touch не вызывает бегство; reset отменяет pending/active reaction; красный не игнорируется. Выбор укрытия проверен отдельно геометрическим тестом.
- Browser: tools/traffic-flow-check.cjs —180.48с desktop1440x900 и60.23с mobile viewport390x844, свободная камера на высоте300м. Во всех трёх desktop окнах и мобильном окне60/60 машин продвигаются; минимальное число движущихся в sampled snapshots19 desktop/20 mobile, время общего замирания0. Видимы55/29 машин, canvas color checks2609/1351, page errors0. Трасса: docs/knowledge/traffic-flow-2026-10-06.json; screenshots: tools/screenshots/traffic-flow-{start,end}-{1440,390}.png. Это browser surrogate, не физический телефон.
- Дополнительные browser tools: traffic-check, city-resize-check (12 rebuild), traffic-repro (60/6/300/reset, OBB overlaps0 во всех восьми snapshots) и traffic-direction-check (оба поворота выходят на правую полосу) — pass, page errors0. Новая insertion trace: docs/knowledge/traffic-flow-insertion-2026-10-06.json. Единичные near-zero кадры startup/смены решения не подменяют длительный flow test.
- Stress300: отдельная240с симуляция сохраняет движение (52/54/33/24 машин на отметках60/120/180/240с), но перегруженные очереди могут удерживать entered reservation. Строгий критерий «каждый NPC движется в каждом минутном окне» подтверждён для штатных60, не обещан для максимальной плотности300. Не удалять/телепортировать NPC и не освобождать занятой junction таймером ради красивой метрики.
- Профиль после flow/evasion, до нового запроса о совместном проезде: traffic-flow-performance-2026-10-06.json, прежние Edge/SwiftShader/DPR1/CDP4x, short10с/long60с. Low60=28.36FPS/p95 54.1мс,6physical/54logical; low300=10.49FPS/p95 137.4мс,24physical/276logical; long60=28.71FPS/p95 58.3мс,9physical/51logical. Ресурсы24/2/8 стабильны, мобильный бюджет не доказан. Новый junction patch требует новой финальной проверки.

### Совместный проезд и отзывчивые повороты, 2026-10-06

- Новый запрос пользователя отменяет эксклюзивный резерв всего перекрёстка: совместимые потоки должны ехать одновременно, левый поворот уступает встречным прямым машинам. Улучшить поворот NPC вправо/влево. Scope остаётся traffic modules; управление/физика игрока не меняются.
- src/traffic-junction.js строит quadratic turn arcs/cubic U-turns между правыми полосами; совместимость проверяет swept oriented footprints, результат кешируется по heading/width. У каждого NPC свой junction permit; весь conflict region не блокируется одним owner. FIFO сохраняется для реально конфликтующих траекторий; unprotected left уступает разрешённым встречным straight/right до выдачи permit, независимо от request age. Сигнальные оси не становятся одновременно зелёными.
- Последователи одного движения могут иметь permit одновременно, но safe-speed учитывает расстояние вдоль дуги и не даёт догнать лидера. Entered permit освобождается по заднему bumper, не таймером. При занятом выходе entry по-прежнему запрещён.
- Route continuation выбирается до прибытия в конечный node, чтобы keep-clear и turn path знали выход. Прогресс на перекрёстке измеряется вдоль дуги, а не старого ребра; достижение середины дуги переводит route на выход. Это устраняет ложный stall/replan во время U-turn. Бегство не меняет уже разрешённую траекторию посреди перекрёстка.
- Логический steering rate увеличен0.9→1.6рад/с; в повороте используется короткая path lookahead2.5м и целевая скорость3.8 вместо2.6м/с. Физические NPC следуют той же дуге через реальные steer/throttle/brake без scripted yaw. Player CarSimulation не менялся.
- Left permit переоценивается и после выдачи: при появлении движущейся встречной straight машины до30м ещё не вошедший owner освобождает permit, если может безопасно остановиться. Entered манёвр не прерывается. Неподвижная дальняя очередь не считается approaching потоком: широкий безусловный priority поиск вызвал взаимный keep-clear/yield deadlock; regression выявлена пятиминутным flow и исправлена до завершения работы.
- tests/traffic-junction.test.js: геометрия на widths12/15/30, встречные straight одновременно, четыре right turns одновременно, старший left уступает straight и затем проходит, late oncoming освобождает unentered permit и left затем возобновляет движение, неподвижная дальняя очередь не запирает поворот, convoy follower стартует до полного выхода лидера, отсутствие OBB overlaps; shared physical/logical cases. Полный suite после последней корректировки —141/141 pass; пятиминутная default60 flow regression проходит. pnpm build — pass, прежнее предупреждение Three.js chunk.
- Финальный browser flow после priority-корректировки:180.05с desktop1440x900 и60.23с mobile390x844, free camera300м. Во всех трёх desktop окнах и мобильном окне60/60 продвигаются; minimum travel44.97/51.49/15.65м desktop и45.08м mobile. Минимум движущихся23/22, общего замирания0с, visible52/29, canvas colors2614/1319, page errors0. Screenshots проверены визуально, traffic-flow-2026-10-06.json обновлён; промежуточная трасса до junction сохранена в traffic-flow-before-junction-2026-10-06.json.
- Финальный240с stress300 после priority-корректировки: moving69/59/39/27 на отметках60/120/180/240с, entered permits старше20с0/0/0/1. Трафик продолжает движение, но максимальная плотность создаёт настоящие очереди; критерий all60/minute относится к default60. Замер сделан с настоящими city colliders, без удаления/телепортации и timer release.
- Финальный профиль: traffic-junction-performance-2026-10-06.json, те же Edge/SwiftShader/DPR1/CDP4x, short10с/long60с, свежая seeded scene каждого count. Low6=34.78FPS/p95 33.4мс; low60=32.33FPS/p95 50.0мс,8physical/52logical; low300=10.95FPS/p95 129.2мс,20physical/280logical; long60=29.80FPS/p95 58.3мс,9physical/51logical, dropped0с. Geometry/textures/programs24/2/8 стабильны. Предыдущий flow/evasion baseline low60=28.36/54.1,low300=10.49/137.4,long60=28.71/58.3; вариативный desktop surrogate не является доказательством мобильного бюджета или гарантированного роста FPS. Реальный телефон не проверен.
- После последней priority-корректировки повторно прошли traffic-check и city-resize-check:12 rebuild без накопления ресурсов, page errors0. traffic-direction-check зафиксировал реальные right/left выходы на правой полосе с lateral3.7545/3.7488м и выровненным heading; page errors0.
- Финальный traffic-repro — pass:8 snapshots startup60/count6/count300/reset300 без OBB overlaps, page errors0; traffic-flow-insertion-2026-10-06.json обновлён. Четыре недавно вставленных startup NPC имеют одиночный near-zero без reason, после5с таких машин0; это не persistent stall, который отдельно проверяется300с flow.
- Итоговый статус: done,2026-10-06. Подтверждены default60 длительный flow, compact following, impact evasion и concurrent junction turns. Ограничения: congestion при300, не универсальный navigation/ПДД engine, мобильный performance budget не доказан. Все предыдущие отчёты сохранены как история проверки и уточнения scope.

### Приоритет направо и быстрое бегство без знаков, 2026-10-06

- Новый запрос отменяет прежние turn speed3.8м/с и соблюдение сигналов/приоритета встречных в evasion. Обычный правый поворот получает приоритет среди ещё не вошедших заявок; occupied chassis/забитый выход/entered permit остаются физическими препятствиями. Обычные светофоры сохраняются, бегство их игнорирует.
- Единая цель8м/с на прямых и обычных поворотах; evasion16м/с (57.6км/ч) игнорирует красный/жёлтый и уступание встречным. Priority evasion→right→FIFO заменяет только невошедшие permits при достаточном тормозном расстоянии. Entered crossing, закрытый выход, leader/contact и безопасный recovery не отключаются. Off-route recovery может ехать медленнее, это не turn speed cap. Игрок и его CarSimulation не менялись.
- Внутри junction curvature-based steering по lookahead2.5м учитывает wheelbase2.3м и штатный speed-sensitive steering lock; logical yaw следует той же bicycle curvature, вне junction/recovery сохранён прежний yaw rate. Цель скорости не снижается из-за turn label; фактическая скорость зависит от физики шин/препятствий, не обещает идеальные57.6км/ч на любой дуге.
- Последующий запрос о зелёном: green8→16с, yellow2/all-red1 сохранены. Это выбранное исполнителем значение, не точное число пользователя: бюджет50м/8м/с + старт/поворот укладывается в16с. Hash offsets сохранены; это не отдельная green-wave координация всего города. Test fixture исправлен на настоящий degree4 node, теперь непересечение green не проверяется на нерегулируемом degree2 узле.
- Последующий запрос о странных разворотах: U-turn cubic bulb заменён прямыми tangent lead-ins и одной полукруглой дугой радиусом lane offset3/3.75/5.2м на widths12/15/30. Плавное направление без смены знака curvature, полный разворот ровноπ, путь остаётся внутри перекрёстка и возвращает в противоположную полосу.
- Проверки на Node22.20.0:150/150 pass, включая300с flow, правый приоритет/release и occupied crossing, повороты с target8 и actual speed>6.4м/с, U-turn без reverse/лишних loops в обоих LOD на трёх ширинах, evasion red bypass с возвратом к signal compliance/leader safety и реальным разгоном>13м/с. Contact jam тест измеряет достижение progress в течение15с, а не только конечную координату: ускоренный NPC успевает развернуться у цели и вернуться до последнего sample.
- Bundled Node24.19.0 прерывал тяжёлые flow/spawn workers и browser runner внутренним V8 Fatal/frame-size check (exit3221225477), не assertion приложения. Повторная приёмка проводится portable официальным Node22.20.0, как major version GitHub workflow; архив проверен SHA256, runtime находится во временном каталоге и не включается в проект. После браузерных проверок пользователь просит опубликовать все накопленные изменения через существующий GitHub Pages workflow.

### Объезд занятой улицы, 2026-10-06

- Новейший запрос расширяет keep-clear: перед входом NPC проверяет свободные альтернативные outgoing lanes и строит обход к прежней цели. Текущий junction исключён из BFS обхода, чтобы машина не выбрала немедленный возврат в затор; side street предпочтительнее U-turn. При невозможности сохранить цель свободная улица становится промежуточной целью с обычным дальнейшим продолжением.
- Replan не меняет body/ID/позицию и не отменяет entered crossing. Signal-red обычной машины не запускает объезд. Cooldown1.5с ограничивает повторную смену решений/BFS; когда все выезды заняты, остаётся blocked-junction-exit и проверка освобождения. Moving same-path leader не провоцирует ненужный объезд. Диагностика exitReplans добавлена в carLab.trafficAI().
- Актуальные src/traffic-ai.js/traffic.js и tests/traffic-ai.test.js/traffic-liveness.test.js проверены перед правками. Прежний тест ожидания при одном закрытом выезде заменён по новому запросу: теперь ожидает только dead-end без альтернатив, а перекрёсток выбирает свободный обход. Добавлены physical/logical движение без overlap/скачка, сохранение цели и отсутствие flip-flop, четыре занятых выезда→открытие бокового, red wait и сохранение entered permit.
- Проверки: Node22.20.0 --no-maglev --test --test-concurrency=1 tests/*.test.js —163/163 pass, включая300с default60 real-city flow и новые соседние изменения рабочего дерева; build — pass,38 modules и прежнее предупреждение Three.js chunk. Первый полный прогон без flag завершил flow/spawn workers внутренним runtime failure; изолированно оба прошли. Browser runner также столкнулся с V8 сбоем и перезапущен с --no-opt; попытка --jitless непригодна для Playwright/undici WebAssembly. Эти flags касаются только Node инструмента, не browser JS/физики игры. Финальные browser/profile проверки пока выполняются; статус in-progress.

