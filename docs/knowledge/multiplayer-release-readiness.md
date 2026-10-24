# До сетевого релиза CarWars

Сверка2026-10-24: общий core, authoritative комнаты и online клиент приняты независимым QA; финальный клиентский full437/437+build. **Полный сетевой релиз ещё не принят.** Таблица описывает текущую реализацию и остаток требований. Источник статусов — файлы задач и INDEX.

| Этап | Что уже есть в коде | Что осталось до приёмки |
| --- | --- | --- |
| [0096](../tasks/TASK-0096-multiplayer-architecture-spike.md), done | Исследование Colyseus, реальная физика/AI, netem, отрицательные latency результаты; независимый QA 16 октября | Исследование завершено. Его no-go относится к старому server-only варианту, а не к последующей реализации prediction |
| [0097](../tasks/TASK-0097-headless-multiplayer-game-world.md), done | Единый offline/hosted GameWorld: 120 Hz, до трёх игроков, union LOD/102 civilian, общий police pool до 6, wanted/arrest/repair/props causality по playerId, общая геометрия/подпись, безопасное appearance, simulation-time spawn, gameplay DTO | Независимый QA принял 23 октября: core/SDK17, 300 sim seconds, browser high/low и все обязательные сценарии; подтверждена full419 + build |
| [0098](../tasks/TASK-0098-authoritative-three-player-rooms.md), done | map-ready/nonce/build/hash, loading без body, атомарные3 места/reservations, bounded input/output/transfers, полный durable DTO/events, deadline scheduling60/20 и120Hz physics, reconnect/leave/shutdown/dispose | Независимый QA принят23 октября:8/8 SDK,11/11 regressions, настоящие5/16с и20cycles, paused TCP reader,3Dhigh/low; matching full427 + build |
| [0099](../tasks/TASK-0099-multiplayer-client-and-three-car-render.md), done | Персональный wanted/arrest HUD, create/join/invite, cancel/retry/reconnect, neutral menu/freecam/hidden, cleanup listeners/timers/GPU; исправлены5 lifecycle/startup дефектов | QA принят24 октября:23client+6room/server,16Edge+Chrome cases и отдельные reproducer/offline/high-low; final Linux437/437+build. Physical phone/WAN budgets не входят |
| [0100](../tasks/TASK-0100-multiplayer-smoothing-and-network-resilience.md), ready | Buffer/interpolation, local prediction/ack replay, contacts/static streaming; старые ARM/public3D probes | Привести buffer/clock/epochs к контракту; новая матрица по2мин/RTT0/50/100/150+jitter/loss, input-to-visible/corrections, slow reader/bandwidth cap/stall/hidden/reconnect5/16с |
| [0101](../tasks/TASK-0101-multiplayer-self-host-and-release-validation.md), blocked | Docker/Compose/Caddy/HTTPS/WSS preview, health, лимит двух комнат, ARM probes/public smoke | Зависимость 0100; origin/readiness/draining/bounded shutdown, lifecycle20, stress300/default102+police/multiroom sizing, финальная приёмка QA |
| [0102–0105](../tasks/TASK-0102-city-hunt-server-round-and-roles.md), draft | Только дизайн режима «город против трёх гонщиков» | После 0101: серверные роли/раунд → карты/перекрытия → камера/UI города → баланс/нагрузка |

## Порядок продолжения

1. **TASK-0110 завершена и принята независимым QA 2026-10-23.** Подэтап 0097: общий серверный ремонт, один победитель при гонке, восстановление машины и состояния для всех клиентов. Собственная QA-приёмка не закрывает всю 0097; публичный сервер этим коммитом не обновляется.
2. **0097 и0098 завершены независимым QA:** общий core,102civilian/3–6police, map-ready/limits/lifecycle приняты. Их контракты сохраняются.
3. **0099 завершена24 октября:** HUD/личный respawn, cancel/retry/cleanup и финальная браузерная приёмка прошли. Следующая — **0100, ready**. Source build6 требует совместимого клиента/сервера; старый публичный VPS автоматически не обновлялся.
4. Повторить 0100 на полном игровом составе. Исторический key-event-to-local-step и частота кадров не являются input-to-visible или измерением реального телефона.
5. Провести эксплуатационные и нагрузочные проверки 0101, затем независимую QA-приёмку выпуска. После неё начинать режим 3+1.

Незавершённые зависимости блокируют приёмку.0097–0099 теперь `done`,0100 — `ready`,0101 — `blocked` до0100. Уже работающие части preview перечислены выше; одной сверки исходников недостаточно для финального релиза.

## Какой код действует сейчас

- `src/simulation/game-world.js` и `vehicle-runtime.js`: общий headless physics/AI/gameplay. Offline `src/main.js` подключает к нему visual `traffic.js`/`traffic-visual-adapter.js`; HostedDrivingRoom создаёт тот же core. `tools/multiplayer-spike/world.js` сохранён для исторических research harness, hosted его больше не создаёт. [Контракт и проверенные приёмы](multiplayer-shared-core.md).
- `tools/multiplayer-spike/hosted-room.js`, `room-clock.js`, `deploy/server.js`: действующие Colyseus hosted adapter и scheduling; `server.js` также сохраняет research adapter; `deploy/` — существующий комплект запуска. Не строить параллельный room только ради ожидаемого старым заданием имени `server/`.
- `src/multiplayer/game.js`, `room-client.js`, `frame-codec.js`, `snapshot-buffer.js`, `prediction.js`, `prediction-world.js`: 3D presentation и non-authoritative local prediction. Клиент не решает AI, damage или игровые транзакции.
- [План](multiplayer-server-plan.md) уже фиксирует решение 18 октября перейти к prediction. Строгий запрет client solver в первоначальных заданиях исторический; authority сервера сохраняется.

Незакоммиченный H3-эксперимент в рабочем дереве не подключён к действующему WebSocket hosted preview и не считается принятой частью релиза. Его файлы и чужие изменения сохранены отдельно от этого этапа.

## Доказательства и пределы

Прочитаны исходники и тесты текущего дерева; это подтверждает наличие реализации, а не прохождение всех сценариев. Исторические результаты не выдаются за новые запуски:

- [Hosting](multiplayer-hosting.md) и [deploy README](../../tools/multiplayer-spike/deploy/README.md): выкладка и SDK/3D smoke 18 октября, ограничение preview.
- [Prediction](multiplayer-client-prediction.md): ARM64 Node22, четыре 40-секундных netem профиля, 3 клиента/102 NPC, редкие collision corrections до 2.39 м. Полной двухминутной browser-матрицы окончательного gameplay здесь нет.
- [Destruction](multiplayer-destruction.md): серверные повреждения/props, late join/reconnect и joystick.
- [QA камеры](../tasks/TASK-0107-multiplayer-camera-placement.md), [QA props](../tasks/TASK-0108-sidewalk-prop-immediate-ghost-fade.md), [QA NPC](../tasks/TASK-0109-npc-sidewalk-collision-liveness.md): независимые приёмки 19 октября, последний full 402/402 + build. Их область ограничена этими исправлениями.
- Ремонт и сверка очереди приняты независимым QA: 6/6 Node/SDK, 24/24 regressions, пять дополнительных сценариев, основной browser и повторный damage до следующего frame; matchingReceipt 407/407 + build подтверждена. Отчёты — в [TASK-0110](../tasks/TASK-0110-multiplayer-shared-repair.md), разделы 10–11.
- Новый общий core: [артефакты исполнителя 23 октября](multiplayer/2026-10-23-core/README.md), full419/419 + build, SDK10/10, core12/12, 300 simulation seconds на optimized Node22.23.3, offline high/low и online repair browser. [Независимый QA](multiplayer/2026-10-23-core/qa/README.md) принял 0097: собственные17/17, повторный soak, online regression и high/low с настоящими curb/building contacts, skid smoke/tracks, damage/wheel/repair/wanted/arrest/new map. 0098 позднее принята отдельно; финальная сетевая/эксплуатационная приёмка 0099–0101 не проводилась.
- [QA0098](multiplayer/2026-10-23-rooms/qa/README.md): собственные8/8,11/11 regressions,5/16с и20cycles, три разных control/ack/movement, event dedup/full resync,3Dhigh/low; подтверждена full427/427+build. [Контракт и проверенные приёмы](multiplayer-rooms.md). Это не WAN/physical-device/VPS sizing gate.

- [Окончательный QA0099](multiplayer/2026-10-24-client/qa-clock/README.md):23client/snapshot/prediction+6room/server,16Edge+ChromeLAN cases, personal HUD/respawn, cancel scheduled/CONNECTING retry, stale async callbacks, friendlabel churn, cold startup/deadline,10leave/pagehide/offline/high-low. [Linux final437/437+build](multiplayer/2026-10-24-client/linux-clock/README.md),8/8 sourceSHA. Native Windows failures и прежний Linux436/437 сохранены, причиной исправления Windows runtime не объявлены. [Проверенные приёмы клиента](multiplayer-client-lifecycle.md).

Текущая публичная версия, реальный телефон и матч на нескольких физических устройствах24 октября не проверялись. Изменения этого этапа не опубликованы на игровом сервере автоматически.

## Проверенный приём ведения очереди

Признак: `draft`/«Не выполнялась» в старых заданиях при наличии deployed preview; `in-progress` в 0096 при сохранённом положительном QA. Причина: прямые запросы на развитие кода не сопровождались сверкой исходной серии. Способ: сопоставить критерии с actual owner/API и доказательствами, восстановить уже принятое исследование по прежнему QA, частичные задачи оставить незавершёнными, явно перечислить остатки и сменившиеся архитектурные решения. Проверка 2026-10-23: чтение кода/отчётов и машинная сверка файлов задач с INDEX; это проверка документации, а не новый gameplay pass. Не использовать такой аудит как замену независимой QA.

Приёмка конкретной задачи: адресный `queue.js set TASK_PATH qa-in-progress`. Общий `claim` выбирает всю очередь и может захватить старый review0049; в QA0098 это произошло и было немедленно восстановлено до исходного review, с пустым diff0049. Проверка23 октября: snapshot/diff и освобождённый claim lock. Не использовать общий claim как адресный selector без проверки API.
