# Архитектура полицейского преследования и координатного спавна

Дата проверки исходников: 2026-10-07. Этот ADR задаёт контракт для TASK-0048; он описывает решение, а не уже реализованную систему.

## Решение

Обобщить существующий runtime в `src/traffic.js`: экспортировать `createVehicleRuntime()` и сохранить `createTraffic()` как совместимую гражданскую façade. Runtime остаётся единственным владельцем NPC registry, shared-world registration, occupancy, LOD, role dispatch и fixed-step integration; `src/vehicle-spawn.js` (новый) содержит coordinate safety/queue helpers; гражданский планировщик остаётся в traffic domain, а police policy находится в новом `src/police-pursuit.js`. `registerRole(role, hooks)` отделяет role-specific создание, контроллер, визуализацию и reset hooks; generic runtime не решает chase policy.

Сравнивались: (1) оставить всё в гражданском controller и добавить специальные police ветки; (2) немедленно извлечь весь manager в новую `vehicle-runtime.js`; (3) сохранить существующую единственную точку world/actor lifecycle, назвать её role-aware runtime API и вынести координатный safety и role policies. Выбран вариант3: он повторно использует проверенный manager, который уже владеет shared world, count insertion, occupancy, LOD и одним `world.step`; извлечение всей 800-строчной FSM в момент добавления второй роли добавило бы миграцию ко всем существующим traffic tests/callers, не улучшив ownership. Не добавлять вторую runtime façade или вторую world.

## Компоненты и границы

| Файл | Ответственность после миграции |
| --- | --- |
| `src/traffic.js` | Единственный NPC registry/runtime, actor IDs, shared `CarSimulation.world`, actor bodies/meshes, общая occupancy, role dispatch, LOD, reset/remove/dispose и один `world.step` за fixed tick. Экспортирует `createVehicleRuntime(...)` и legacy `createTraffic(...)`. Civilian route planner/controller остаётся здесь; police policy не размещать здесь. |
| `src/vehicle-spawn.js` (новый) | Проверка конечной позиции и угла, bounds, высоты доступной поверхности, building/static OBB и oriented footprint конфликтов; exact и явно запрошенный nearest-safe поиск; queue и cancel по request ID. Переиспользует SAT/footprint math из `traffic-spawn.js`; road-slot генератор гражданских остаётся в последнем модуле. |
| `src/police-pursuit.js` (новый) | Независимый controller для одного target ID: pursue/intercept/ram/maintain-block/recover; выдаёт реальные steer/throttle/brake. Никакой физической интеграции, владения body или position teleport. |
| `src/police-visual.js` (новый либо фабрика в `traffic.js`) | Police skin/roof beacon и материалы. Общие geometry/material создаются и dispose-ятся runtime ровно один раз; actor mesh снимается при удалении. Выбор между этим файлом и локальной фабрикой не меняет API. |
| `src/main.js` | Создаёт runtime с `sim.world`, передаёт fixed-step input, регистрирует city plan/bounds/obstacles/surface sampler, связывает player target, reset/rebuild и read-only diagnostics. Только одна точка зовёт `runtime.stepWorld`. |

Не извлекать `CarSimulation` или переписывать гражданский planner. `DEFAULT_TUNING`, кузова, шины, player damage, разрешение collision контактов и cannon-es solver остаются общими.

## API

```js
const runtime = createVehicleRuntime(scene, THREE, count, roadNetwork, roadWidth, obstacles, mapBounds);
runtime.registerRole('civilian', civilianRole);
runtime.registerRole('police', policeRole);

runtime.requestSpawn({
  role: 'police',
  position: { x: 12, y: 0, z: -30 },
  yaw: Math.PI / 2,
  targetId: 'player',
  options: { placement: 'exact' },
});
// { status: 'created', id, pose }
// { status: 'pending', requestId, reason }
// { status: 'rejected', reason }
runtime.cancelSpawn(requestId);
runtime.remove(id);
runtime.stepWorld(playerInput, STEP);
```

- `position:{x,y,z}` requires finite `x/y/z`; `y` describes the surface point and must match the map's sampled playable-surface height within a small tolerance. The simulation spawn height is derived from that surface plus the car's suspension rest height. `yaw` defaults to `0`, must be finite. Unknown role, unknown target, non-finite coordinate/angle, outside map bounds, unsupported height or a building/static collision rejects with a stable reason code. Never fall back to map center.
- `placement:'exact'` is default. If the pose is valid and unoccupied it creates immediately. If another registered role occupies the clearance, return `pending` and retry the exact pose within the bounded per-tick budget; do not move it silently. Pending records retain role/target, have stable request IDs, and can be cancelled. Reduction of a role's requested count cancels its own newest pending requests first.
- `placement:'nearest-safe'` explicitly authorizes deterministic search over nearby map samples (bounded by a caller supplied `maxDistance`, capped by runtime). A successful result reports the actual pose and distance from the requested coordinate. Invalid map geometry is rejected before this search; a building coordinate does not silently become an alternate spawn.
- Buildings and static city colliders are checked by oriented chassis footprint; every role (physical or logical) is checked against shared occupancy including dimensions and velocity. A role cannot spawn overlapping the target or another vehicle. Exact valid-but-occupied positions may wait; occupied does not imply unsafe geometry.
- Spawn result is a discriminated object, never just a boolean. Reasons include `unknown-role`, `missing-target`, `invalid-pose`, `out-of-bounds`, `blocked-by-building`, `unsupported-surface`, `occupied`, `capacity` and `cancelled`.

## Ownership and lifecycle invariants

  1. The player `CarSimulation` supplies the world's sole `C.World`; role factories pass that world and shared materials to each NPC `CarSimulation`. No role creates a private integration world or adds another ground plane.
2. Game fixed-step calls `runtime.stepWorld(input, STEP)`. Runtime prepares the player once, lets each role update control and prepare its physical simulations once, invokes `world.step(STEP)` exactly once, and runs player/role post-step synchronization once. Controllers never call `world.step`.
3. The role registry is authoritative. A new actor is registered into its role, global actor map, occupancy and visual collection atomically only after safe pose validation. Failed creation rolls back body, mesh and reservation.
4. Physical/logical transition changes membership in `world.bodies` and interpolation only; it never removes occupancy. Police are limited to two active actors and remain physical for their entire pursuit, ram and block states. This keeps contacts real and bounds their cost. A police actor cannot go logical while it might hit the player.
5. `remove(id)` unregisters reservations/occupancy, removes the body from the shared world, detaches the mesh and role controller state, then returns its ID. `reset()` keeps actor identities where safe, resets role state and velocity, and revalidates exact pose; any placement must use the explicit reset policy, not write body position from a controller. `dispose()` drains every role and pending request, removes all bodies/meshes/listeners, disposes owned visuals once, and leaves the player/world alive.
6. `rebuildMap(map)` swaps bounds, surface sampling and static obstacle index, clears old city-dependent reservations/routes, revalidates pending requests, and asks each role to recover. It must not carry an old city obstacle snapshot forward. Police keep target ID and recalculate intercept against its current pose after a rebuild; invalid unentered spawn requests reject with `map-changed` or remain pending only if their exact pose remains valid.
7. Resetting the player preserves the stable `player` target ID. Police transition to `pursue` and calculate a fresh route/lead point; stale intercept coordinates are discarded. Removing the target returns a structured `missing-target` failure and disables/cancels pursuit, never leaves a dangling controller.

## Police policy contract

Controller transitions: `pursue → intercept → ram → maintain-block`; any moving state enters `recover` on no forward progress for the controller's bounded recovery window, then returns to `pursue`. Reset/rebuild or renewed target movement exits `maintain-block` back to pursuit. Every transition exposes state, elapsed time, target ID, last measured contact and recovery count in read-only diagnostics.

- Pursuit steers to a bounded lead point derived from target position and velocity; direct line pursuit is allowed only when static geometry and non-target vehicle corridor are clear. Buildings remain solid. Otherwise request a directed-road/sidewalk-safe detour from route helpers, replan when target or obstruction changes, and retain normal collision braking.
- Intercept selects a reachable lead point in front of/alongside the target with a free approach lane. Ram is the only state allowed to plan a trajectory toward the target footprint. Cannon still resolves the collision: no velocity writes, forced damage, target teleport or collision mask bypass. Other police/civilian vehicles remain avoidance obstacles.
- After contact, `maintain-block` attempts to occupy an adjacent blocking pose and apply safe low-speed pressure, without looping reverse/ram into the same contact. It returns to chase when target gains separation or changes direction. Bounded recovery changes route/approach side; it does not delete/recreate the police actor.
- Police ignores red/yellow signal *stopping* for its own intent (author decision for an aggressive pursuer), but still uses junction conflict permits, respects collision occupancy and cannot enter an already occupied trajectory. Civilian signal compliance and priority are not changed.
- Police and target share ordinary physical collision filters. Police target contact is permitted in the controller's planned trajectory; spawn overlap remains prohibited. Police are physical from spawn through removal.

## Reproducible acceptance plan for TASK-0048

- Compare player and police `CarSimulation` in isolated identical flat-road worlds: same mass, `DEFAULT_TUNING`, initial zero velocity and full throttle, same solver and fixed step; only controller differs. Record speed and displacement at5/10 seconds. At10s, police speed **and** distance must be at least90% of player; do not infer attainable top speed from the 48 m/s force threshold.
- Seeded free straight from behind: police closes and records real impact/contact; target coasts with no throttle and is held below0.5 m/s continuously for2s by physical contact/blocking. Repeat3 seeds and collect target/police speed and contact trace.
- Target at lateral offset: demonstrate predictive interception/ram; target actively accelerating away: repeatable intercept/contact is required, instant stop is not promised.
- Target behind a building: no mesh/body intersection, route around obstruction, eventually reacquire target. Also place target on a safe sidewalk/plaza pose.
- Safe spawn fixtures at center street, edge street and valid off-road pose; plus exact building/out-of-bounds/occupied pose. Invalid returns rejected, occupied is pending/cancellable, nearest-safe only moves when explicitly requested. Every test asserts OBB clearance.
- Two police plus60 civilian traffic share one world and occupancy; targeted300-second civilian flow also passes with police count0. Police stays physical while chasing; civilians brake for an occupied police footprint; deliberate police target contact remains possible.
- Repeat12 spawn/remove/reset/rebuild/dispose cycles; body, mesh, pending request and reservation counts return to baseline and no duplicate world step occurs. Browser tests show two distinct police, count0, respawn, reset/rebuild, both quality modes and center/edge placements. A390×844 viewport is not evidence of physical-mobile performance.

## Открытые продуктовые значения

Лимит двух police, 90% на10с, lead horizon, recovery timer/distance, безопасный block offset, стоп ниже0.5 м/с на2с, ближайший поиск maxDistance и список сигналов — предлагаемый измеримый контракт исполнителя; пользователь точные числа не задавал. Задание0048 может уточнить эти числа при реализации, если сохранит исходное поведение и оставит воспроизводимые измерения.
