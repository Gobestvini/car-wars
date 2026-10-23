# Общий simulation core, TASK-0097

Реализация 2026-10-23 поверх `25bac72`. Независимое решение и окончательные проверки — в [TASK-0097](../tasks/TASK-0097-headless-multiplayer-game-world.md). Этот этап не означает выкладку или приёмку полного сетевого релиза.

## Владельцы и контракт

- `src/simulation/game-world.js` владеет единственным cannon world/materials, статикой, player registry, props, repair и персональными wanted/arrest/violations. Цикл: prepare всех → один `world.step(1/120)` → postStep всех → gameplay. `addPlayer/removePlayer/setPlayerInput/step/snapshot/dispose` работают без браузера.
- `src/simulation/vehicle-runtime.js` — существующие traffic AI, pools, LOD и spawn service без Three.js. `traffic.js` сохраняет прежний browser API, подключая `traffic-visual-adapter.js`. Offline `main.js` использует тот же GameWorld с визуальным runtime, сохранёнными tuning, count, камерой, вводом, GLB и эффектами.
- `src/multiplayer/map-contract.js` и `street-world.js` строят общие коллайдеры/props; scene только связывает visual callbacks с manifest по id и проверяет pose/type. Debug damage obstacles также входят в подписанную геометрию и исключения placements.
- `spawn-phase.js` содержит чистую фазу появления. Серверная машина не имеет тела в solver/ввода до безопасной посадки; rendering не нужен. NPC insertion вызывается simulation time, а render-frame advance в этом режиме ничего не добавляет.
- HostedDrivingRoom создаёт GameWorld и ждёт hash карты. Исторический `tools/multiplayer-spike/world.js` остаётся исследовательским harness. Тест, который подменяет hosted sim на SpikeWorld, не подтверждает production core.

## Общие и персональные правила

102 civilian сохраняются; union LOD/occupancy/эвакуация/безопасность появления учитывают всех игроков. Полиция использует прежний pursuit controller в том же runtime: базовая одна машина на игрока, две при wanted ≥3, максимум шесть. При выборе цели приоритет имеют звёзды, затем дистанция и id; действующая равноприоритетная цель сохраняется в пределах персональной квоты. Нулевой розыск, отключённый/появляющийся/арестованный игрок не являются целью. Offline сохраняет свой count/cap и hooks.

Props хранят shove suppression и crime episodes по playerId. Repair выполняется после общего solver в стабильном порядке playerId; consumed pickup не может отремонтировать второго игрока. Respawn меняет только машину/розыск/арест этого игрока, поколение и ввод; props, карта, остальные машины и использованные pickups сохраняются. Gameplay snapshot содержит полицейские назначения, wanted/arrest/appearance, pickup и repairRevision; журнал ограничен 64 событиями с id `round:serial`. Online client использует роли для полицейской модели и блокирует ввод при arrested/appearing; полный HUD остаётся задачей 0099.

## Проверенный способ выделения headless core

Признак: чистый AI тянет Three.js даже без вызова rendering. Причина: `traffic-evasion` импортировал segment/AABB helper через visual `building-occlusion`. Способ: вынести геометрический helper в `simulation/segment-aabb.js`, сохранить re-export для старого API и проверить всю цепочку loader-ом, запрещающим `three`/`three/*`. Проверка 2026-10-23: отдельный Node child импортирует GameWorld без DOM, делает 120 шагов и dispose; targeted suite 12/12. Ограничение: отсутствие импорта rendering не доказывает gameplay-паритет, для него нужны отдельные fixtures и браузер.

Другой обнаруженный случай: при извлечении appearance easing остался импортирован только прежний wrapper → `ReferenceError` в spawn effects. Рабочий способ — явно экспортировать чистую функцию/константы и проверять старый visual API отдельно. После исправления appearance и общие регрессии прошли; не удалять visual wrapper ради headless pass.

## Артефакты и пределы

[Каталог проверки](multiplayer/2026-10-23-core/README.md) содержит фактические результаты исполнителя и воспроизводимые команды. Пятиминутный ускоренный прогон проверяет 36 000 физических тиков; он не измеряет WAN, долгую wall-clock работу scheduler, рендер или вместимость VPS. Browser-проверка — Edge с WebGL и touch emulation, без физического телефона. Серверный Docker закреплён на Node 22.23.3; локальный Node 24.19.0 иногда завершался без JS-стека и один раз выдал невоспроизводимый `Array.some` TypeError в неизменённом road-surface. Причина не установлена; успешный Node 22 прогон не считается её диагностикой.
