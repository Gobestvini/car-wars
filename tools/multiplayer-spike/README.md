# TASK-0096 — изолированный серверный spike

Production src/** и корневые dependencies не изменяются. Нужны установленные зависимости корня (cannon-es импортируется существующим src/vehicle.js), Node >=22 и npm. Версии всех новых пакетов закреплены в package-lock.json.

```powershell
npm --prefix tools/multiplayer-spike ci --ignore-scripts
npm --prefix tools/multiplayer-spike test
npm --prefix tools/multiplayer-spike start
```

UI: http://127.0.0.1:2577, кнопка подключения создаёт три настоящие SDK/WebSocket-сессии в одной браузерной вкладке. Первая машина управляется WASD/стрелками; две другие получают scripted input. Цвета/метки различают игроков. Рендер — Canvas с серверными poses; ни solver, ни AI в браузерный bundle не входят. Это диагностическая карта, а не Three.js сцена готовой игры. «Столкновение» создаёт новую fixture-комнату с направленными навстречу машинами; служебный collisionFixture разрешён только в изолированном spike и не является production-командой клиента.

Четвёртый join должен вернуть room locked. Отключение третьего закрывает реальный socket; возврат до15с сохраняет playerId. Нажатие после grace даёт expired token. Таймеры/клиенты очищаются при создании новой fixture-комнаты. Токен возврата не отображается в UI/артефактах.

## Проверки и измерения

```powershell
npm --prefix tools/multiplayer-spike run benchmark
npm --prefix tools/multiplayer-spike run network
node --no-opt --no-concurrent-recompilation tools/multiplayer-spike/serve-latency.js
```

Последняя команда открывает сервер2578 и TCP-прокси2580; браузерный URL:
http://127.0.0.1:2578/?endpoint=http://127.0.0.1:2580
Подключить три сессии, затем нажать измерение видимого отклика (30 проб). Local UI загружается напрямую; matchmaking и игровой WebSocket проходят через proxy с RTT100мс и jitter±10мс в каждую сторону (суммарный диапазон RTT±20мс). Различать input→decoded applied ack (network runner) и input→Canvas frame с изменившейся позицией/рулём (browser runner). Рулевой отклик не доказывает качественную езду; movementCount отображается отдельно.

Для короткого smoke разрешены BENCH_SECONDS=10 и WARMUP_SECONDS=2; такой результат не заменяет5мин acceptance. Полный benchmark по умолчанию warmup15с, затем300с реального wall time. Перед ним выполняются accelerated fixed-step профили: один игрок+102NPC, трое+102NPC, трое+300NPC по30с simulation time и все физические102NPC в течение5с simulation time. Не выдавать accelerated duration за wall-time soak. Сырьё и hardware/runtime/source hashes записываются в docs/knowledge/multiplayer/*.json.

При long-lived запуске здесь сохраняется до50000 step/scheduler samples для исследования; GC принудительно вызывается раз в секунду только в benchmark (--expose-gc). Heap tail сравнивается послеGC; production GC policy этим не задаётся. SchedulerMs включает tick work, encodingMs — broadcastPatch включая onBeforePatch/schema encode/send; нельзя складывать snapshotMs и encodingMs повторно. Wire meter считает payload+WS frame header, compression выключен; не включает TCP/IP/TLS/ACK и initial HTTP handshake. Во время measured interval дополнительные full snapshots не запрашиваются.

Предыдущие два default-optimization процесса Node24.19 завершились exit1 без stack trace при длительном прогоне; причина не диагностирована. Для воспроизводимого измерения scripts используют --no-opt --no-concurrent-recompilation и записывают execArgv. Это ограничение исследования, не исправление production runtime; перед релизом нужна проверка оптимизированного совместимого LTS. Скрипт test использует обычный runtime и быстрее завершается.

## Реальная физика и ограничение AI

SpikeWorld использует CarSimulation.prepare/postStep, один world.step(1/120), CityBroadphase, реальные generated buildings/landmarks/boundary houses и боксы/convex prisms тротуаров из общих data-only функций. Collision signature SHA256 включает seed, plan signature и collider descriptors. Отдельная ручная копия builder здесь временная: TASK-0097 обязан выделить единый production builder и проверить parity. Street props/деревья/damage-test obstacles и полный appearance/gameplay в collider coverage не включены.

NPC используют настоящий createRoadGraph/chooseRoadGoal/findRoadRoute, driveControl/followingLimit/edgeProgress, createTrafficSpawnSlots/isTrafficSpawnSafe и createTrafficSignals. Но routing glue, logical motion и union LOD — сокращённый harness. Нет production junction reservations/turn staging/recovery/evasion, multi-player police, wanted, repair/arrest или props causality. Logical NPC могут неверно проходить поворот и копить congestion; настоящая gameplay/load приёмка после TASK-0097 обязательна. Damage/колёса сохраняются из реальной физики игроков, AI damage выключен. Измерение102NPC не включает3 активные police units и потому не подтверждает полный бюджет будущей игры.

## Потеря пакетов

tcp-proxy.js работает с реальным TCP byte stream, сохраняет FIFO, моделирует delay/jitter и ограничивает очередь4MiB. Он не отбрасывает application messages и **не моделирует 1% packet loss/retransmission**. Для обязательного loss profile нужен Linux netem на сетевом пути либо настроенный пакетный WinDivert/аналог на Windows. В текущем окружении такого инструмента нет, WSL distribution недоступна. Не устанавливать драйвер/менять системную сеть как скрытую часть теста. Матрица с потерей пакетов остаётся непроверенной; независимый QA должен отразить это в решении.

## Wire state и запреты

Schema5: MapSchema<ActorState>. Pose float32[13]: position xyz, quaternion xyzw, velocity xyz, angularVelocity xyz. Wheels float32[28]: по4 колеса, position xyz, rotation, slip, grounded0/1, detached0/1. Дополнительные actor fields: id/role/generation/physical/steering/damage/ack/appliedTick/connected; root tick/seed/signature/contactCount. Quantization до0.001 применяется только к сетевому представлению, не solver. Полный DTO в welcome/full содержит version/build/round/server time/step/map info и coverage warning. Schema задаёт реально проверенную компактную основу, не полный окончательный gameplay DTO.

Input: {roundId:'round-1',seq,steer,throttle,brake}, whitelisted finite values; seq integer0..2147483647 (wire ack int32). Последний допустимый seq замещает pending control и подтверждается после prepare/world.step на tick. Чужой playerId/transform/dt отвергается. Input silence30ticks=250мс включает brake. На сессию максимум60 input/s и transport payload1024bytes (подходит spike-командам, но production после0098 должен отдельно определить лимит transport/control messages). Комнаты3 seats, grace15с; номинальные схема20Hz, AI10Hz и simulation120Hz внутри60Hz accumulator с10substep cap. Фактические scheduler/patch cadence считать из artifacts: длинный прогон дал~40.83/~16.77Hz при сохранённых120Hz physics, не выдавать nominal frequency за measured.

Snapshot buffer/clock estimate и graphical interpolation ещё не реализуются этим spike; Canvas рисует decoded authority сразу, оттого видны ступеньки20Hz. Старые эпохи/final durable gameplay snapshots будут внедрены в0097–0100. Полный протокол и go/no-go записаны в docs/knowledge/multiplayer-server-adr.md.
