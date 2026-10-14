# ADR: серверная архитектура CarWars, TASK-0096

Дата: 2026-10-14. Статус: исследование завершено для прототипа; production go/no-go ограничен непроверенными сценариями. Независимое QA ещё должно вынести решение по задаче. Baseline HEAD dc9eb0603b82bd3db4d1accbc7dda214efa9bb0c, исследовались также существующие рабочие изменения. Их hashes сохранены в benchmark artifacts; автор их не менял.

## Решение и сила доказательств

**Выбрать Node.js + Colyseus + существующий cannon-es для следующего прототипирования.** Общий headless мир с реальной CarSimulation, зданиями, границей города и тротуарами запускается, три SDK-сессии получают Schema state, физика столкновений и headless AI functions работают. Это технический go для выделения simulation core, а не разрешение считать полный multiplayer готовым.

**No-go для выпуска и автоматического перевода TASK-0097 в ready:** обязательный профиль1% packet loss с TCP retransmission недоступен; оптимизированные длительные процессы Node24.19 дважды завершились exit1 без stack trace; не доказаны production traffic reservations/evasion/police/props/gameplay load; задержка при RTT100 близка к целевым200мс, а all-clients ack имеет превышения. Downstream0097–0101 сохраняют draft до QA/закрытия blockers. Смена физического движка этими результатами не обоснована.

## Сравнение вариантов

Оценка цены интеграции качественная (число систем и объём переноса), не денежный тариф. Только основной кандидат запускался; альтернативам не приписывается benchmark.

| Стек | Версия/лицензия и источник | Соответствие коду и эксплуатация | Вывод автора |
| --- | --- | --- | --- |
| Colyseus на Node | Реально установлены core0.18.18, ws-transport0.18.4, SDK0.18.5, Schema5.0.39, MIT; локальные package metadata + [Room](https://docs.colyseus.io/room), [reconnection](https://docs.colyseus.io/room/reconnection) | Комнаты, seats/lifecycle, schema deltas, WebSocket. ESM/Node позволяют переиспользовать нынешний cannon и pure JS helpers; обычный self-host. Наш запуск подтвердил совместимость именно этого набора. | Основной кандидат: меньше собственной инфраструктуры. Physics/AI/game rules проект всё равно реализует сам. |
| Nakama | Apache2.0: [LICENSE](https://github.com/heroiclabs/nakama/blob/master/LICENSE); runtime по [официальной документации](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/). Не установлен, конкретная binary release не проверялась. | Authoritative match/backend доступны, но JS runtime использует goja/ES5 и не предоставляет Node APIs. Нельзя считать современный ESM cannon/Map-код drop-in; нужны transpilation/polyfills с проверкой или отдельный Node physics service. Self-host добавляет backend/database lifecycle. | Хорош для аккаунтов/social/persistence, которых здесь пока нет. Более высокая цена переноса; не отвергаем способность выполнять physics вообще, но совместимость не доказана. |
| geckos.io | @geckos.io/server3.1.0 по npm metadata; BSD3-Clause, [официальный репозиторий](https://github.com/geckosio/geckos.io) | Node/WebRTC data channels поверхUDP. Условия доставки могут уменьшить HOL, но потребуются собственные room/state/reconnect и ICE/NAT/UDP-порты. Self-host возможен. | Резервный транспорт при доказанном WebSocket latency/loss blocker, не повод заранее писать весь netcode. |
| Node + raw WebSocket | ws8.22.0 по npm metadata, MIT, [репозиторий](https://github.com/websockets/ws) | Код физики переносится без второго runtime, HTTP/WS простой self-host. Все seats, lifecycle, snapshots/delta/ack/version/reconnection необходимо поддерживать самому. | Baseline архитектуры, лишняя собственная работа по сравнению с проверенным Colyseus. |

Сведения проверены2026-10-14; цены hosting не исследовались и не обещаются. Engine migration на Godot/Unity или Rapier в эту задачу не входит: работоспособность cannon в общем Node world подтверждена. Сохранить ощущения машины выгоднее, чем менять solver без доказательств.

## Проверенный прототип и непокрытый код

Исходники: [README стенда](../../tools/multiplayer-spike/README.md), world.js/server.js/state.js/protocol.js, интеграционные tests. Из root импортируются реальные CarSimulation/CityBroadphase/createCityPlan/sidewalk supports и AI createRoadGraph/chooseRoadGoal/findRoadRoute/driveControl/followingLimit/edgeProgress/signals/spawn-safe functions. Нет THREE/DOM/WebGL в headless graph. Карта seed20261005:412 boxes и238 convex prisms; signature `7ee310664502559afb995feee1d07155086e49d596ac70044db038c269d38e3a`.

Стенд делает prepare всех физических игроков/NPC → один world.step(STEP) → postStep → snapshot. Unit fixture столкновения с реальным зданием и player-player collision прошли. SDK-интеграция подтвердила capacity3, отказ4, реальное декодирование Schema, applied input ack, late join, reserved seat/reconnect identity, expiry, invalid/rate-limit handling и cleanup empty world. Ускоренный grace0.4с используется только тестом; server default15с.

Вместо createVehicleRuntime использован временный glue: lane following, headway, signal stop, маршруты и physical/logical LOD возле union игроков. Отсутствуют production reservations/turn staging/recovery/evasion, police policy, wanted/arrest/repair/props causality и authoritative appearance. Logical motion упрощён; телеметрия не доказывает traffic flow quality. Collider builder не включает street props/trees и дополнительные damage-test obstacles, временно повторяет выбор descriptors из scene builder. TASK-0097 должен удалить дублирование и доказать collision parity, TASK-0098 — полный wire/gameplay state. Нельзя публиковать этот сервер как production игру.

## Измерения и ограничения переноса результатов

Артефакты: [benchmark.json](multiplayer/benchmark.json), [simulation-preliminary.json](multiplayer/simulation-preliminary.json), [network-latency.json](multiplayer/network-latency.json), browser captures в той же папке. Реальный hardware: i9-13900KF,32 logical CPUs,~64GiB RAM, Windows11 build22631, Node24.19.0. CPU-affinity/выделенный server не задавались, desktop и браузеры могли создавать конкурирующую нагрузку; результаты не являются sizing дешёвого VPS.

Benchmark состоит из30с accelerated baseline1+102,3+102 и3+300,5с all-physical3+102 и real-time3 SDK+102NPC300с после15с warmup. Все численные итоговые значения и raw samples — в JSON; не заменять длительный прогон коротким smoke. Population проверяется при создании: если safe slots не хватает, harness завершает запуск с ошибкой, а не silently снижает count.

Ускоренные профили показали p95 substep~1.72мс(one player),~1.99мс(three),~4.05мс(300 NPC),~8.03мс(all102 physical); p99 all-physical~9.81мс. Эти числа относятся к конкретному записанному baseline с --no-opt и не являются production SLA. **All-physical102 уже не укладывается в предложенные p95≤6/p99≤8.33мс: union LOD необходим.** Проверка сохранности взаимодействий logical↔physical остаётся в0097; нельзя пользоваться LOD, игнорирующим двух игроков.

Итоговый real-time прогон300.043с после15с warmup:36004 physics ticks, substep p50/p95/p99=2.673/3.313/3.749мс; scheduler callback p95=11.698мс, broadcastPatch p95=1.172мс. Wire14.853KiB/s на каждого из3 клиентов; heap tail120с вырос0.97%, droppedSeconds=0, maximum accumulator debt53.4мс. Physical NPC стабилизировались на34 из102. В сырье сохранены36004 step timings,3000 AI timings,12250 scheduler timings и5033 patch timings. Это проверенный5мин сокращённый harness, не полный production budget.

**Номинальные60Hz scheduler/20Hz patch не равны фактической cadence:** за measured300с callback частота~40.83Hz, patch~16.77Hz. Accumulator удержал120Hz simulation за счёт нескольких substeps; network cadence просела. Не объявлять snapshots20Hz доказанными. Для0098/0100 отдельно проверить timer scheduling/GC/encoding на target runtime и cadence histogram; не увеличивать physics dt для «исправления». Desktop concurrent browser load мог повлиять на эти показатели. Этот результат усиливает latency blocker даже при хороших substep budgets.

Стресс300 — ускоренная оценка CPU, не5мин network300 и не подтверждение NPC liveness. Offline baseline означает headless harness с1 игроком, не профилирование полного browser offline runtime. Длительный профиль не содержит3 police units, props/wanted/gameplay, поэтому productionCoverage=false всегда, даже если все toy budgets зелёные.

Измерение encoding включает весь broadcastPatch, включая schema update/send; отдельно snapshotMs является вложенным измерением. Wire payload+WebSocket frame header с выключенной compression; TCP/IP/TLS overhead не учтён. Memory снимается после forcedGC раз в секунду, tail120с; такая GC policy нужна измерению, не production. Ограниченная история metrics учитывается в росте heap. CPU process включает сервер и3 SDK-клиента в одном процессе. Это ограничения сравнения, не скрытые исключения.

## Частоты и серверное время

Сохранить STEP1/120s, scheduler60Hz с accumulator, max10 substeps/callback, AI10Hz. World.step ровно один на substep независимо от player count. Overrun учитывается как droppedSeconds/maxDebt, dt не увеличивается. Schema patch20Hz; authoritative state для patch обновляется в onBeforePatch, чтобы отдельные20Hz таймеры не добавляли лишний50мс lag. setSimulationInterval в0.18 работает как alias setTimestep; future implementation может использовать официальный fixed-step API, но не должен совмещать его catch-up с собственным вторым accumulator.

Encoder.BUFFER_SIZE=256KiB для full snapshot, иначе default buffer вызывает предупреждение resizing. defineTypes работает в установленной Schema5, но deprecated; production0098 использовать рекомендуемые schema/t builders, повторно проверить encoding. Только wire представление округляется до0.001 и float32; physics остаётся double. Не обещать bit-exact lockstep между платформами.

## Контракт production core и DTO

Принять interfaces плана: createGameWorld(config), addPlayer/removePlayer/setPlayerInput/step/snapshot/dispose; data-only collision builder, один world/materials на комнату. Новые src/simulation/**, server/rooms/driving-room.js, src/network/protocol.js/room-client.js/snapshot-buffer.js. Offline использует тот же core и прежние настройки; online branch не исполняет solver/AI.

Handshake: protocolVersion/buildId/roomId/playerId/roundId/mapSeed/mapConfig/generatorVersion/collisionSignature/serverTick/stepSeconds. Map-ready подтверждает signature; до готовности ввода нет, loader timeout освобождает seat. Generation меняется при новой сущности/respawn; устаревшая epoch не оживляет удалённую машину.

Input whitelist: roundId,seq,steer[-1,1],throttle[-1,1],brake[0,1]. Сессия определяет игрока; seq monotonic и ack означает применение control на physics tick, не просто receipt. Последнее разрешённое состояние замещает pending, пропущенные seq не проигрываются. Spike ограничивает seq0..2^31-1 по wire ack int32; **production должен вводить новую input epoch до исчерпания либо использовать float64 safe integer в обоих wire направлениях**. Timestamp — диагностика, не physics clock. Respawn отдельная серверно проверяемая команда с requestId/cooldown. Gameplay results/transforms/damage клиентом не принимаются.

Полный authoritative snapshot должен включать всё из плана: actor ids/generation/pose/quaternion/velocity/angularVelocity/wheels/steering/damage/lifecycle, detached-body pose, per-player ack/wanted/arrest, shared pickups/props/signals. Текущая compact Schema proof покрывает только часть; окончательная wire структура расширяется0098 после0097. Bounded eventId/tick/actorId dedup; durable effects итог хранится в snapshot. Старая история событий не воспроизводится целиком при late join.

Ограничения ввода: silence250мс →neutral/brake, max60inputs/s, input≤1KiB, bounded one pending state/player. Spike transport maxPayload1KiB; в production разделить transport maximum от input validator, иначе handshake/respawn/type расширения ломаются. Добавить sustained-spam disconnect, room admission и slow-client backpressure≤256KiB per socket с полным resync после reconnect; последняя политика — требование production, не уже протестированная feature spike.

## Игроки, AI и полиция

До3 игроков, включая reservations. Все player bodies physical; NPC physical-zone union по всем игрокам, hysteresis24/36м и retained contacts до60м по исходному плану. Harness сохраняет любой dynamic contact; bounded60м retention и безопасный contact cleanup не доказаны. Нельзя promote только возле host или despawn скрытый от одного игрока NPC, видимый другому.

Общий пул полиции: предложить global cap6 (до2 на игрока), default1 на активного игрока=до3. В текущем production offline cap2 и default1; police-intensity.js меняет скорости/lead/ram/canMaintainBlock, **не количество**. Предложенное расширение pool capacity не выдаётся за текущее поведение. Для online desired units:1 на игрока,2 при wanted≥3 (профиль позволяет block); общий6. Это явное правило multiplayer MVP, сохраняющее offline1/default cap2. Высший eligible wanted →distance →playerId, стабилизация допустимой текущей цели. Idle level0 не получает преследование; arrest/disconnected не новые targets. Проверить нагрузку3 базовых и6 активных отдельно.

Индивидуальные damage/wanted/arrest/respawn; player-player удар не вводит новую crime rule. Shared pickups/props, repair winner serverTick затемplayerId, multi-player causality для StreetPropPhysics без общего singleton playerPushedUntil. Respawn не сбрасывает чужие машины/seed/props; новый мир — новая комната. Эти правила не реализованы spike и проходят0097, не считаются критерием его игрового выпуска.

## Recovery и capacity

Colyseus0.18: onDrop вызывает neutral и allowReconnection(client,15), onReconnect восстанавливает connected, onLeave удаляет игрока, истечение promise удаляет body/seat. SDK auto reconnect отключается в ручном disconnect test, чтобы проверить explicit token flow. Токены не публикуются. Late join автоматически получает Schema full state, welcome/full RPC даёт version/map metadata. Restart процесса теряет ephemeral мир; новая комната, без обещания persistence.

Measured capacity: подтверждена **одна** комната3 игроков со сокращённым AI102. Для первого production профиля MAX_ROOMS=1 до реального multiroom sizing. Worker/thread/shard и Redis не вводить по предположению; одинаковая Node event loop может обслуживать room orchestration, но один simulation world не распределять между processes. Interest management пока не нужен по самому сокращённому wire budget, но окончательное решение только после полного DTO/props/police замера. При превышении150KiB/s сначала уменьшить wire deltas/precision согласованно, затем distance-based relevance с полным state enter/exit; не уменьшать server authority зоны.

## Latency strategy и stop conditions

Сохранить серверную authority и отсутствие online client solver. Remote interpolation100мс с bounded adaptive50–150мс, local latest-state/extrapolation≤100мс, wheel/camera согласованы. Cosmetic immediate steering можно; нельзя считать его доказательством physics response. После>500мс без state network warning/freeze, после respawn/resync reset buffer. Эти правила реализует0100; spike Canvas рисует decoded state сразу, без interpolation.

Реальный TCP byte-stream proxy проверил nominal RTT0/50/100/150 сjitter20, не loss. P95 applied-ack для всех3 клиентов:110.8/196.6/215.1/252.9мс в записанном network run; max all3 — иной metric, чем local visible response. Browser30 проб на RTT100 дал p95~199.3мс (29 movement responses) в первом наблюдении. Повторный сохранённый [browser-rtt100.json](multiplayer/browser-rtt100.json) дал p50/p95/p99=157.8/203.8/215.8мс,29 movement responses: целевой200мс **не выдержан** даже без loss. Оба результата отражены, лучший прогон не выбирается как pass. Нужно измерение полного renderer/input steering/траекторий в0099/0100; RTT150 уже требует честной оценки управляемости, не обещания LAN качества.

Если полный renderer не достигает input-to-visible p95≤200мс на RTT100/loss1%, остановить переход к релизу. Следующий вариант для обсуждения: local non-authoritative player prediction +ack replay/reconciliation на общих control/vehicle state, с серверными damage/AI/contacts results. Это изменяет строгое требование «без client solver»; не внедрять его молча. Более близкий сервер и20→30Hz patch эксперимент — альтернативы с измерениями bandwidth/CPU. Полный lockstep или движок migration заранее не обоснованы.

## Закрытие blockers и следующие этапы

Для завершения обязательной матрицы нужен packet-level impairment tool (Linux netem или настроенный Windows WinDivert аналог), loss1%/RTT0–150/jitter20 с TCP retransmission, browser capture. Исследование не устанавливает драйверы и не меняет системную сеть скрыто. Также нужен воспроизводимый optimized-runtime soak или отдельная диагностика exit1; --no-opt исследование не подтверждает stable production Node.

TASK-0097: выделить реальный core/collider parity/union occupancy и полностью перенести rules; TASK-0098: сверить API0.18/Schema5, full gameplay DTO, limits/backpressure; TASK-0099: online Canvas proof заменить настоящим Three.js presentation; TASK-0100: измерить настоящий renderer и gameplay latency; TASK-0101: Linux/self-host/WSS и полноценная нагрузка с3/6 police. Существующие зависимости/QA-порядок сохраняются, исполнение этих этапов настоящим ADR не запускается.
