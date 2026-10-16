# Второй режим: город против трёх гонщиков

Дата: 2026-10-16. Дизайн для TASK-0102–0105. Все числа баланса, кроме заданных пользователем трёх гонщиков и двух минут, — предложения автора для первого игрового теста, не проверенный баланс. Реализация в этом запросе не выполняется.

## Запрос и подтверждённая готовность проекта

Город — отдельный четвёртый участник комнаты. Он видит город сверху целиком, разыгрывает карточки перетаскиванием на карту, размещает полицию и полностью закрывает выбранный конец дороги. За 120 секунд ему нужно поймать всех трёх гонщиков. Если хотя бы один остаётся на свободе, выигрывает команда гонщиков. Последние два правила о командной победе — явная трактовка автора; пользователь не задавал точный подсчёт победы.

Проверено чтением кода 2026-10-16, HEAD `3598b662375a613f822e011b46a8e92555a12a9c`, с существующими чужими рабочими изменениями:

- `src/start-screen.js/createStartScreen`: кнопка `city` уже есть, но PLAY для неё disabled, показано «City mode is coming soon.». Сейчас это заглушка, а не работающий режим.
- В корневом package.json Three.js0.180.0/cannon-es0.20.0/Vite7.1.9, npm test/build/dev. Production `server/` и `src/network/` отсутствуют; есть изолированный `tools/multiplayer-spike/`.
- `tools/multiplayer-spike/server.js/DrivingSpikeRoom` ограничивает maxClients=3 и создаёт CarSimulation на каждую сессию; для города это неверная модель. В новом режиме соединений 4, машин игроков 3. Обычный free-drive сохраняет 3 соединения/гонщика.
- TASK-0096 имеет blocked после независимого QA;0097–0101 — draft. В [ADR](multiplayer-server-adr.md) сохранены latency/cadence/runtime/loss ограничения. Создание новых задач не снимает их и не разрешает строить production на spike.
- `src/traffic.js/createVehicleRuntime`, registerRole/requestSpawn/cancelSpawn: общий NPC registry/physics и safe placement существуют, но привязаны к одному `physics.body`, singleton `playerOccupancy`, targetId `'player'`. `src/police-pursuit.js/createPolicePursuit` уже выдаёт физические controls для заданной цели.
- `src/arrest-system.js/createArrestSystem`: defaults2 с holding+5 с arrest, кандидаты targetId==='player', damage>=1 отменяет попытку. Для нескольких гонщиков и повреждённой машины это нужно расширить **в рамках режима**, не глобально менять одиночную игру.
- `src/vehicle-spawn.js/findSafeSpawnPose` умеет exact/nearest-safe и pending; нельзя оставлять карточку в бесконечном pending. `src/traffic-signals.js/createTrafficSignals.phase` вычисляет фазы от времени; постоянный override должен быть отдельным временным слоем.
- `src/main.js`: PerspectiveCamera38°, far200, Fog100..260, follow offset(12,20,-17), free camera и локальный newRound. Простого увеличения Y недостаточно для обзора всего города и правильного drag-to-world.
- `src/city-generator.js/createCityPlan`, city-layout.js/containsCityPoint и topology roadNetwork задают фактическую нерегулярную карту, не только квадрат 420×420. road-surface.js даёт геометрию тротуаров и sampling высоты.

В общей базе `C:/Users/gobes/.codex/knowledge/README.md` подходящей проверенной записи о multiplayer/city director нет. Использованы проектные ADR, police-pursuit-design.md, vehicle-spawn-2026-10-12.md и playbook. Исторические выводы о single-player spawn не считаются доказательством multi-player safety.

## Режим, роли и раунд

Новый modeId=`city-hunt-v1`; обычный online free-drive и offline не меняют лимиты, seed workflow, управление и арест. Роли server-bound:1 city,3 racer. Количество connected+reserved seats проверяется атомарно **по роли** и суммарно; четвёртый гонщик или второй город отвергаются даже при свободном слоте другой роли. City не получает body/drive input; role из произвольного пакета не меняет авторитет сессии. Пятый участник и spectator seats в MVP не добавляются.

Состояния: waiting → countdown → active → finished. Для старта нужны city и ровно 3 loaded/ready racers с подтверждённым map signature. Город нажимает «Начать», сервер проверяет readiness и запускает countdown3 с. При уходе/потере готовности во время countdown вернуться в waiting без расходов; ready/double-start идемпотентны. В countdown водители стоят с neutral/brake, карт нет. На active: новая roundId, reset всей round-owned динамики, city energy4, все гонщики active. Применять новый seed перед countdown, после map-ready; не создавать ещё одну карту в момент active.

Дедлайн: server monotonic `deadlineMs=activeStartedMs+120000`. Меню/скрытая вкладка/падение FPS и ограничение physics catch-up не продлевают две минуты; клиент только отображает ceil(remainingMs/1000). Не считать 120 с накоплением physics dt при dropped debt. Если таймер уже истёк при обработке очереди, новые карты/аресты не применяются. Capture принимается только когда post-step observation на сервере имеет time<deadline; при равенстве 120000 мс приоритет истечению времени. Нельзя задним числом проставлять capture на вычисленном ранее tick после server stall. Результат roundResult фиксируется один раз и реплицируется всем.

Capture гонщика — завершённый серверный arrest FSM, не касание и не просто damage=1. Сохранить defaults2+5 с, speed/radius/clear-path/operational police проверки; targetId сравнивается с реальным racerId. В этом режиме chase eligibility/profile=3 с начала active независимо от нарушений, чтобы полиция не ожидала первой звезды; free-drive wanted не трогать. Для уничтоженной машины разрешён тот же arrest при наличии полиции, иначе существующая проверка damage>=1 даёт иммунитет. Не вводить автоматический capture только за уничтожение.

Captured необратим до rematch: input/respawn/rejoin не возвращают в гонку; снять body на следующей безопасной границе tick после capture presentation и очистить цели/колёса/contacts, чтобы пленник не стал щитом. UI захваченного переключается на наблюдение за оставшимся гонщиком без extra seat. Если все трое captured либо forfeited до deadline — city victory; если кто-то active при deadline — racer-team victory. В таблице отдельно отмечать captured и forfeited, не считать разрыв сети физическим арестом.

Disconnect: общий grace15 с, часы идут. Racer получает neutral/brake, его body остаётся захватываемым; reconnect сохраняет статус/машину/seat. Истечение grace или добровольный leave в active — forfeit этого racer. City disconnect блокирует только новые карты; ранее созданные эффекты/AI продолжаются; истечение grace или city leave — победа racers с reason city-forfeit. Если deadline и grace совпали, deadline рассматривается первым. Replacement seats во время active/finished не создают новых гонщиков. Rematch после finished — только когда все четыре снова connected/loaded/ready; новая epoch и map-ready, полный reset hand/cooldowns/reservations/entities. Persistence после process restart не обещается.

## Ресурс и пять карт MVP

Пять постоянных карточек в панели, без случайной колоды/редкости/покупок. Энергия 4 на старте, максимум 8, +1 за каждые 3 серверных секунды active (fractional progress в UI). Во finished/waiting не регенерирует. Личный cooldown каждой карты и лимиты активных эффектов; доступность вычисляет сервер. Суммарно максимум 6 живых или зарезервированных police,2 barriers,2 spike strips,1 signal override,1 intercept order. Нет бесплатного автоматического police spawn в city-hunt; парк создаёт город. В free-drive сохранить базовую полицию по прежнему ADR.

| cardId / карта | Цена / cooldown | Цель и действие | Предупреждение / длительность |
| --- | --- | --- | --- |
| patrol / «Патруль» | 2 / 4 с | На road lane поставить 1 police. Выбранная точка snap к ближайшей разрешённой полосе в радиусе 6 м, heading по полосе; ближайший active racer становится исходной целью. Не создавать 7-ю машину. | 1.5 с до активации; police живёт 30 с active time или до уничтожения/конца раунда. |
| roadblock / «Перекрытие» | 3 / 14 с | Выбрать **любой конец конкретного road segment**, заблокировать оба направления и весь проезд через его поперечное сечение вместе с тротуарами. Максимум 2. Не блокировать весь перекрёсток вместо выбранного въезда. | 1.5 с telegraph;12 с от активации. |
| spikes / «Шипы» | 3 / 16 с | Поперечная полоса шипов на дороге, максимум 2. Swept crossing активного racer запускает временное повреждение сцепления: grip×0.7, engine power×0.75 на 3 с. Не удаляет колесо/здоровье, не останавливает машину мгновенно. Police/civilians иммунны. Повторный crossing обновляет максимум до 3 с, не суммирует multiplier. | 1.5 с; полоса 10 с, визуальный tyre warning3 с после попадания. |
| red-light / «Красный сигнал» | 1 / 10 с | Перекрёсток с существующим управляемым светофором: все направления красные, NPC останавливаются по тем же правилам. Racers сохраняют управление, emergency police не должны зависнуть из-за этой карты. | 0.5 с;8 с, затем вычислить обычную фазу от текущего server time, не reset сигнала. |
| intercept / «Перехват» | 2 / 10 с | Бросить на маркер active racer: до 2 ближайших свободных operational police получают фиксированную цель на 8 с. Свободный — не занят другим приказом и не участвует в holding/arresting; обычную погоню можно переназначить. Не создаёт машин, не увеличивает скорость/силы, не телепортирует. При 0 подходящих police rejected без расхода. | Мгновенный принятый приказ;8 с, затем обычный target selection. |

Роли карт: патруль даёт присутствие, перекрытие меняет маршрут, шипы создают короткое окно погони, красный собирает обычный трафик, перехват позволяет сосредоточить уже доступный ресурс. Не добавлять карту разведки при полном обзоре/маркерах всех гонщиков — у неё нет самостоятельной функции. Баланс этих пяти способностей предстоит проверить матчами, он не выведен из текущих unit tests.

## Размещение и физическая безопасность

Все placement targets — серверные road/endpoint/intersection/entity IDs и необязательная запрошенная world x/z, не готовые collider poses и не screen coordinates. Server выбирает канонический target/heading/height по карте. Для физических дорог дать стабильный undirected edgeId (не два разных ID на две полосы) и endpointId=(edgeId,nodeId); IDs живут в roundId/map signature. Near-hit selection детерминирован: distance, затем ID; запрещённые точки не переносятся на другую улицу без preview actual snapped pose.

Police ghost не появляется в здании, на крыше, вне territory, на тротуаре или под машиной. Использовать footprint geometry, sample height и occupancy всех racers/civilians/police/props/dynamic effects, а не только physics.body. Базовый safety: не ближе 12 м к active racer; между footprint и swept projected positions всех машин на горизонте 1.5 с сохранять clearance2 м. Перед физической активацией ещё раз проверить реальные occupancy и прогноз 0.25 с. Не ждать бесконечно и не спавнить молча через 20 с в старой точке.

Barrier cross-section находится внутри выбранного edge на inset=roadWidth/2+1 м от node, перпендикулярно edge. Span не меньше roadWidth+2×sidewalkWidth, с пересечением существующих static краёв до 0.15 м только для исключения лазейки; collider thickness1 м, высота 2.5 м. Концы блокируют объезд по тротуару, а центр не закрывает боковую улицу. Для короткого segment без нужного inset server сообщает unsupported-endpoint; обычные пригодные endpoints все доступны независимо от стороны света/граничной дороги. Любое геометрическое исключение отображается, а не исчезает из targeting молча.

Barrier — статический непроницаемый physics collider, не просто знак/AI flag. До активации warning ghost без коллизии. Полиция и civilians также не проезжают сквозь закрытие. Physics и shared graph closure включаются/выключаются в одной транзакции tick; блокируются оба направления traversing данного edge, пересчитываются планы/reservations. Уже находящиеся на edge автомобили должны безопасно ждать/выйти через открытый конец/развернуться по существующим правилам, не телепортироваться. Истечение TTL/round reset освобождает collider, blocked edges и связанные pending routes. Замыкание ловушки легально: у неё есть заметное предупреждение и 12 с предел; не запрещать тактическое закрытие последнего выхода скрытым правилом связности.

Шипы — серверный swept trigger на road cross-section, без высокого box collider, уничтожающего машину. Дебафф хранить отдельным временным multiplier поверх исходных tuning/damage и снять по server deadline; stacking не должен необратимо переписать grip/power. Trigger ширина road, без наложения на соседний segment. Закрытия и шипы не размещаются на intersecting active/pending effects.

Card lifecycle: request validation → reserve energy/cap/card instance → telegraph → revalidate → activate/commit → expire. Одна pending копия на cardId, максимум 8 pending commands на city session. Предупреждение видят все 4 клиента. При initial reject ни energy, ни cooldown не расходуются. Если активация стала unsafe/мир закончился — cancel pending, вернуть reservation целиком; карточка получает retry backoff2 с для защиты от бесплатного warning spam, но не обычный cooldown. После activate cooldown начинается, refund нет при разрушении/истечении TTL. Intercept без telegraph commit атомарно после проверки цели. Все TTL/regen/cooldowns считаются от монотонного времени и не продлевают match120 с.

## Сеть и защита состояния

Предлагаемые DTO: `playCityCard {roundId, requestId, cardId, target:{type,id,x?,z?}}`, `cardResult {requestId,status,reason,serverActionId,actualTarget,activateAtMs?}`, `roundState {mode,roundId,phase,startedAtMs,deadlineMs,result,racers}`, `cityHand {energy,reservedEnergy,regenAtMs,cooldowns,limits}`, `cityEffects {actionId,ownerId,cardId,target,phase,activateAtMs,expiresAtMs}`, `routingVersion` для динамических закрытий.

Сессия определяет city identity. Racer drive input городу forbidden, city card message гонщику forbidden. Finite x/z, whitelisted card/target type, roundId и map signature проверяются, IDs из другой комнаты/epoch невалидны. Цена/cooldown/TTL/получатель/police body не приходят авторитетно от клиента.

Idempotency key=(sessionId,roundId,requestId), bounded256 результатов/раунд; повтор того же payload возвращает старый result, не новую машину/расход. Повтор ключа с другим payload → request-conflict. Если ключ вышел из retention, server требует resync и отвергает replay, не исполняет его заново; использовать monotonic actionSeq либо bounded replay watermark. Rate limit2 новых card commands/с, максимум 8 queued; retries получают кэш. Race refund/expiry/disconnect/duplicate пакетов имеет один финальный исход и не создаёт отрицательную энергию.

Full snapshot/reconnect включает remaining time, outcome/captured/forfeit, card reservations и все pending/active/expired durable results, police target overrides, closures и spike debuffs. Не replay всех прошлых explosions/telegraphs. Client preview оптимистичен только визуально; ни physics, ни hand не изменяет до server result/state. Удаление видимого ghost не отменяет принятую команду после pointerup; отмена до отправки запросов не создаёт.

## Камера, видимость и управление

Городу дать отдельный OrthographicCamera с постоянным yaw, near top-down pitch около 80° и fit-to-city. Вычислять bounds из territory/contour/boundaryBuildings, проектировать 8 углов world AABB с высотами в camera space и выбирать frustum по свободному viewport без tray/HUD, с 10% margin. Far/near, fog, drawDistance и culling должны показывать реальный дальний край; city-only tilt-shift blur выключить. Для города rooftops не должны закрывать интерактивный road target: поверх сцены screen markers/road endpoint overlays, а preview по игровому surface plane/road data, не по пересечению крыши GLTF.

Initial/«Весь город» показывает **всю карту сразу**; разрешены zoom до 2× и pan с bounds clamp, pinch/колесо, но кнопка fit возвращает весь город, resize/orientation refit. Во время drag карты камера не панорамируется тем же pointer. Минимальные marker targets44×44 CSS px; при близких endpoint markers дать выбор двух кандидатов/zoom, не попадание случайно на другую дорогу. Город видит маркеры всех трёх racers, своё energy/hand/timers и 0/3–3/3 captured; туман войны не добавляется.

Drag: pointerdown на карточке → pointer capture → ghost; ray from camera через координаты canvas clientRect, корректно при DPR1/1.75 и отступах tray. Overlay DOM не считается картой. Превью green/red показывает actual snap, стоимость, cooldown и причину запрета. Pointerup отправляет ровно один запрос, pointercancel/Escape/blur/off-map/leave/rotate отменяют только unsent ghost. Touch page scrolling во время drag карты подавляется, обычное взаимодействие с панелью сохраняется. Доступный fallback: выбрать карточку кликом/Enter и затем target кликом/Enter, Escape отменяет; без обязательного точного drag.

На мобильном 390×844 пять карточек помещаются в нижнюю панель (короткая подпись+цена+таймер), доступна прокрутка внутри панели при крупном шрифте, не поверх скрытого active target. Шрифт/контраст читаемы, renderer viewport для fit учитывает панель. Игроки-гонщики сохраняют follow camera и джойстик; новое input routing города не перехватывает racer controls.

**Обзор всего города не превращает всех NPC в physical:** server physics зоны по-прежнему union трёх racer bodies. City camera увеличивает render/network relevance, а не зону server collider simulation. Рендер дальних NPC остаётся с LOD/instancing; измерять city viewport отдельно, не наращивать Three meshes и shadows бесконтрольно. Это применение проверенного ограничения ADR, не доказательство новой производительности.

## Баланс и проверка

Server tests: role capacity4/3+1 и reconnect races;120 с при stalls/hidden;119999/120000/120001 мс capture boundary; damage1 не иммунен; input/respawn captured запрещён; duplicate cards/refund/late activation; caps6/2/2/1/1; оба конца каждой fixture дороги/разные seeds, widths12/15/30; physical sweep всех типов машин, high-speed crossing шипов; graph closure parity и cleanup; timers не зависят от FPS.

Browser:4 independent contexts с 1 city+3 racers; один участник с touch390×844; весь город в 1440×900/390×844 и на нерегулярных картах, drag/fallback/off-map/cancel, safe preview/rejection, каждый эффект виден всем, city/racer win, capture→spectate, individual reconnect и rematch10 циклов без leaks.

Пять тестовых матчей 120 с с разными стратегиями city/racers: записать captures по времени, energy spent, failed placements, card usage и причины победы. Scripted SDK drivers допускаются для воспроизводимости, но их результаты отделяются от интерактивной проверки читаемости и управляемости через настоящий UI. Агент или тестировщик проверяет обе роли; отдельный набор людей не является условием запуска. Это стартовое наблюдение о балансе, не статистическое доказательство 50% win rate или человеческой сложности. Плохая управляемость/неразличимые endpoints/неиспользуемые карты — воспроизводимые замечания. Менять численные параметры в одном versioned config с before/after, не ослаблять 120 с/3racers/physics authority.

Нагрузка: default102 civilians,3 racer bodies,6 police,2 barriers,2 strips и active signal/order, city all-map view. Предложенные цели из прежнего плана: substep p95≤6/p99≤8.33 мс, wire≤150KiB/s **на каждого из 4 клиентов**, bounded queues/heap; city render median≥30FPS desktop с объявленным hardware/quality. Поле зрения не повышает physics LOD. Снять фактические effective scheduler/patch Hz, не только nominal; на RTT100/jitter20/loss1% проверять команды/таймеры и после correction bounded lag. Старые desktop/no-opt measurements не подтверждают Linux, optimized runtime, телефон или новый workload. Невозможный обязательный сценарий — blocked QA с причиной.

## Порядок внедрения

TASK-0102 — серверные роли 3+1, матч 120 с, захват/исход и контракт карт, без world abilities. Зависит от done TASK-0101 и фактической full multiplayer основы.

TASK-0103 — исполнение пяти карт, collider/graph/AI/trigger safety и lifecycle. Зависит от done0102.

TASK-0104 — меню city, overhead camera, card tray drag/touch, role-specific HUD и сетевой presentation. Зависит от done0103; city ветка использует настоящие серверные карты, не mock.

TASK-0105 —4-client матчевые проверки/профиль нагрузки/проверка баланса и запуск. Зависит от done0104. Отдельная независимая QA после каждого этапа сохраняется.

Все четыре при подготовке draft: требуемая мультиплеерная основа не принята. Не менять maxClients spike или bootstrap локальной игры, выдавая это за готовый второй режим.
