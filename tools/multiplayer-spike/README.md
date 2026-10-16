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

tcp-proxy.js работает с реальным TCP byte stream, сохраняет FIFO, моделирует delay/jitter и ограничивает очередь4MiB. Он не моделирует packet loss. С2026-10-16 доступен отдельный Linux netem стенд в QEMU; инструкции и ограничения ниже.

### Linux netem без установки драйверов Windows

Нужен Windows Python3.10 с msilib. Bootstrap извлекает официальные QEMU11.1.0, 7-Zip26.04, Alpine3.22.6 и Node22.23.3 в `%LOCALAPPDATA%/carwars-netem`; QEMU/ISO/Node проверяются по официальным checksum. Инсталляторы не запускаются. Загрузка около300МБ, гостю выделено768МБ RAM. В трёх отдельных терминалах из корня:

```powershell
python tools/multiplayer-spike/netem-bootstrap.py
# Терминал1, оставить работающим; Ctrl+C завершает гостевую VM
python tools/multiplayer-spike/netem-vm.py --rtt 100 --jitter 20 --loss 1
# Терминал2
& "$env:LOCALAPPDATA/carwars-netem/node22/node.exe" tools/multiplayer-spike/server.js
# Терминал3, после NETEM_READY
& "$env:LOCALAPPDATA/carwars-netem/node22/node.exe" tools/multiplayer-spike/netem-network.js
```

Runner проверяет actual kernel qdisc, последовательно задаёт RTT0/50/100/150, jitter20 и loss1%, получает40 applied-ack samples/профиль с трёх SDK и сохраняет tc drops/TCP RetransSegs до/после. Профиль управляется JSON `%LOCALAPPDATA%/carwars-netem/netem-control.json` (id,rttMs,jitterMs,lossPercent), подтверждение — netem-applied.json. Для отдельного browser capture задать RTT100 в этом JSON и дождаться подтверждения, открыть http://127.0.0.1:2577/?endpoint=http://127.0.0.1:2581 и выполнить30 видимых проб. Не запускать runner параллельно browser capture: он меняет профиль. Для benchmark без перезаписи прежних артефактов:

```powershell
$env:BENCH_OUTPUT_DIR='docs/knowledge/multiplayer/2026-10-16'
& "$env:LOCALAPPDATA/carwars-netem/node22/node.exe" --expose-gc tools/multiplayer-spike/benchmark.js
```

Топология: Windows SDK → QEMU SLIRP hostfwd → Linux kernel TCP/socat → QEMU SLIRP → Windows Colyseus. Netem расположен на guest eth0 egress, затрагивает оба TCP-плеча; это реальные IP drops и TCP retransmissions. Значения delay/jitter — настройки qdisc, не обещание точного WAN RTT: дополнительно действуют TCP recovery, очереди SLIRP и software emulation. Нельзя сравнивать эту топологию с прямым WAN без оговорки. Все host listener привязаны к127.0.0.1; Windows network adapters/drivers не меняются. Гость RAM-only, установка apk происходит только внутри гостя, persistent guest disk отсутствует.

Результаты2026-10-16 находятся в docs/knowledge/multiplayer/2026-10-16. Optimized Node22 завершил полный300с прогон без --no-opt; это снимает неопределённость для этой версии, не диагностирует прошлые падения Node24. Browser RTT100/loss1 дал p95=253.6мс: latency budget200мс не достигнут. Старые артефакты и результаты оставлены как история.

## Wire state и запреты

Schema5: MapSchema<ActorState>. Pose float32[13]: position xyz, quaternion xyzw, velocity xyz, angularVelocity xyz. Wheels float32[28]: по4 колеса, position xyz, rotation, slip, grounded0/1, detached0/1. Дополнительные actor fields: id/role/generation/physical/steering/damage/ack/appliedTick/connected; root tick/seed/signature/contactCount. Quantization до0.001 применяется только к сетевому представлению, не solver. Полный DTO в welcome/full содержит version/build/round/server time/step/map info и coverage warning. Schema задаёт реально проверенную компактную основу, не полный окончательный gameplay DTO.

Input: {roundId:'round-1',seq,steer,throttle,brake}, whitelisted finite values; seq integer0..2147483647 (wire ack int32). Последний допустимый seq замещает pending control и подтверждается после prepare/world.step на tick. Чужой playerId/transform/dt отвергается. Input silence30ticks=250мс включает brake. На сессию максимум60 input/s и transport payload1024bytes (подходит spike-командам, но production после0098 должен отдельно определить лимит transport/control messages). Комнаты3 seats, grace15с; номинальные схема20Hz, AI10Hz и simulation120Hz внутри60Hz accumulator с10substep cap. Фактические scheduler/patch cadence считать из artifacts: длинный прогон дал~40.83/~16.77Hz при сохранённых120Hz physics, не выдавать nominal frequency за measured.

Snapshot buffer/clock estimate и graphical interpolation ещё не реализуются этим spike; Canvas рисует decoded authority сразу, оттого видны ступеньки20Hz. Старые эпохи/final durable gameplay snapshots будут внедрены в0097–0100. Полный протокол и go/no-go записаны в docs/knowledge/multiplayer-server-adr.md.

Уточнение по actual qdisc: профиль RTT0 — loss-only baseline. Linux не сохраняет delay/jitter при delay0ms10ms; ему нельзя приписывать фактически измеренный jitter20. Для RTT50/100/150 actual egress delay25/50/75ms и jitter10ms подтверждены.

### Короткий cadence experiment

После остановки обычного spike server, при работающем netem с RTT100/loss1:

```powershell
$env:SPIKE_PATCH_HZ='30' # допустимы30 или60
& "$env:LOCALAPPDATA/carwars-netem/node22/node.exe" tools/multiplayer-spike/cadence-probe.js
```

Запускать из корня. Helper меняет Room.onCreate только в своём процессе: scheduler120Hz и patches30/60Hz, тот же world/state/input; default server.js остаётся прежним. Через120с helper пишет cadence-probe-server-N.json в dated artifacts и закрывает сервер; в interactive stdin также принимает quit. После подключения3SDK в браузере снять30 проб обычной кнопкой. Это короткое исследование, не новый пятиминутный performance pass. Перед повторением сохранить прежние одноимённые server reports. Прерывание Windows launcher через Ctrl+C может завершить Node без SIGINT handler: не считать отсутствующий JSON успешным завершением.

Executor2026-10-16: scheduler120/patch30 дал browser p95=245.4мс, scheduler120/patch60 —341.1мс при RTT100/loss1, по30 проб (29movement). Медиана второго174.5мс лучше первого195.3мс, но хвост хуже. Серии последовательные со случайными loss, это exploratory probe, не контролируемое доказательство причинности. Простое повышение частоты не подтвердило требуемый p95≤200мс. Исходники основной симуляции не менялись.
