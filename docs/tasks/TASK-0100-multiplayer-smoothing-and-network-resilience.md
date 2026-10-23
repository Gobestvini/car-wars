# TASK-0100: Обеспечить плавность езды и устойчивость к задержкам сети

- Статус: blocked
- Приоритет: high
- Создана: 2026-10-14
- Обновлена: 2026-10-23
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Сложные временные зависимости и диагностика сетевого движения: gpt-6.1-sol, high.
- Зависимости: TASK-0099 — требуется done

## Актуальная сверка 2026-10-23

Эта сверка имеет приоритет над историческим baseline и будущими путями ниже. Проверены исходники рабочего дерева поверх `5416e88`; чужие локальные изменения не являются завершённой частью этого задания. Общая карта выпуска: [что осталось до сетевого релиза](../knowledge/multiplayer-release-readiness.md).

**Уже реализовано:** Уже реализованы SnapshotBuffer, ClientPrediction/PredictionWorld, input history, ack/replay, nearby collisions, bounded replay и streamed static colliders. Документирован переход к non-authoritative prediction, сервер сохраняет решения damage/AI/gameplay.

**Остаётся:** Зависимость TASK-0099 не завершена; нужна повторная полная browser/network матрица на окончательном gameplay: 2 минуты на профиль RTT0/50/100/150+jitter/loss, 5/16с разрыв, slow reader/bandwidth cap/hidden tab/stall. Старые 40-секундные ARM probes и key-to-local-step не заменяют input-to-visible и окончательную приёмку.

**Статус `blocked`:** частично реализовано, продолжение и приёмка зависят от перечисленных незавершённых этапов; это не пустой черновик и не готовый релиз.

Архитектурное уточнение: запрет online solver ниже относится к первоначальному server-only варианту. С 2026-10-18 выбран и реализован non-authoritative client prediction/reconciliation, см. [план](../knowledge/multiplayer-server-plan.md) и [проверки prediction](../knowledge/multiplayer-client-prediction.md). Authority, AI, damage и игровые транзакции остаются серверными. Первоначальный no-go TASK-0096 нельзя автоматически применять к текущему клиенту; его отрицательные измерения сохранены как история, а итоговые budgets всё ещё требуют проверки. Не менять стек и не удалять prediction ради выполнения устаревшего текста.

Обновление после QA0097, 2026-10-23: общий offline/hosted core `src/simulation/{game-world,vehicle-runtime}.js` принят, включая police/wanted/arrest/repair/props causality. Room adapters — `tools/multiplayer-spike/{server,deploy/server}.js`, клиент — `src/multiplayer/{game,room-client,frame-codec,snapshot-buffer,prediction,prediction-world}.js`; прежний `world.js` сохраняется для research harness. Не повторять перенос core; текущие остатки этой задачи сохраняются. [Контракт core](../knowledge/multiplayer-shared-core.md). Автопроверки: `node tools/verify.js --full` и соответствующие `tools/multiplayer-spike/tests/*`; не восстанавливать удалённый Telegram verifier.

Прежние пустые отметки критериев означают отсутствие полной приёмки, а не отсутствие всей реализации. Исторические артефакты 18–19 октября перечислены в общей карте; чтение этих отчётов не считается новым запуском тестов или новой QA-приёмкой.

## 1. Цель и запрос пользователя

Сделать online движение и камеру пригодными для езды при реальных задержках, сохранив всю физику и AI на сервере. Получить измеримый latency/jitter report вместо обещания «без лагов».

Исходный запрос: «внедрение мультиплеера … на карте … 3 игрока … физику … на сервер … логику AI машин тоже … хороший движок для гейм сервера». Первоначальная постановка подготовлена 2026-10-14; фактический прогресс указан в актуальной сверке выше. Конкретные gameplay rules, budgets и стек — предложения автора из [плана](../knowledge/multiplayer-server-plan.md), обязательного контекста данного задания.

## 2. Исторический проверенный контекст (2026-10-14–16)

2026-10-14, HEAD b6c0763be369bc49cb2cc6f39eb03ed58f0a0afd, main. ESM/Three.js0.180.0/cannon-es0.20.0/Vite7.1.9, физика120Hz; серверного framework в package.json нет. Исследован рабочий код, а не только документация. Уже имеются чужие staged/unstaged/untracked изменения, включая src/traffic.js, src/traffic-ai.js, src/city-boundary.js, package.json, AGENTS.md и task tooling. Не откатывать/не коммитить их; переснять git status перед реализацией. Полный перечень изменяемых файлов текущей сессии не является whitelist будущего исполнителя.

| Файл / символ | Проверенное назначение | Точка работы |
| --- | --- | --- |
| src/main.js / startGame, fixed-step callback | Браузерный цикл и gameplay | Разделение offline/online |
| src/vehicle.js / CarSimulation, STEP, prepare/postStep | cannon-es; STEP=1/120, допускает общий world | Shared server physics |
| src/traffic.js / createVehicleRuntime, stepWorld, TRAFFIC_PHYSICS_ZONE | AI/physical-logical NPC вместе с THREE и одним player | Headless core и union LOD |
| src/traffic-ai.js, traffic-planner.js, traffic-junction.js | Маршруты и управление NPC | Сохранить реальные правила AI |
| src/city-generator.js / createCityPlan; city-layout.js / cityLayoutSignature | Seed-based карта | Server seed/config/version |
| src/city-scene.js / createCityScene; street-prop-physics.js / StreetPropPhysics | Рендер/коллайдеры и prop gameplay | Data-only геометрия и multi-player attribution |
| src/police-pursuit.js / createPolicePursuit | По умолчанию targetId='player' | Общий pool с несколькими целями |
| src/wanted-system.js, arrest-system.js, repair-pickups.js | Сейчас вызываются main для одного игрока | Индивидуальное состояние/общие pickups |
| src/start-screen.js, driving-input.js, joystick.js, game-loop.js | Старт, ввод, local timing | UI/input adapters |
| package.json; tests/*.test.js | npm test/build/dev | Проверки существующего поведения |

При зависимостях таблица описывает baseline до серии; после done зависимости обязательно проверить фактические новые пути/API и обновить задание. Прочитать принятый docs/knowledge/multiplayer-server-adr.md, когда он появится; отсутствующий ADR блокирует этапы после0096.

Контекст TASK-0096 (2026-10-16): изолированный tools/multiplayer-spike и ADR сохранены, core0.18.18/ws-transport0.18.4/SDK0.18.5/Schema5.0.39. Реальная kernel netem loss1% матрица и optimized Node22.23.3 soak теперь выполнены, основной исследовательский результат прошёл независимую QA; см. актуальный статус/отчёт TASK-0096 и docs/knowledge/multiplayer/2026-10-16. Production core/полный gameplay ещё не перенесены. ADR сохраняет no-go: browser p95 при RTT100/loss1 выше200мс, measured cadence ниже nominal; короткие patch30/60 пробы тоже не прошли latency. Сохранять draft до закрытия архитектурного gate, а не только смены статуса0096. Следующий вариант в ADR — unreliable authoritative transport; online client solver без отдельного решения не вводить.

## 3. Область изменений

src/network/snapshot-buffer.js, src/network/room-client.js, actor presenter, main camera/effects interpolation, tests/multiplayer-smoothing.test.js, tools/network-test/** и артефакты. Сервер меняется только ради timing diagnostics/full resync/backpressure, без смены physics и gameplay.

Сохранить offline single-player, visual defaults и текущие модели/управление; не трогать game-template и соседние оптимизационные задачи. Возможные равноценные имена файлов допускаются с обновлением документации и зависимых заданий, без расширения поведения.

## 4. Требуемое поведение

Оценивать server clock с monotonic samples, хранить bounded buffer (не более2с/60 snapshots на actor) с roundId/tick/generation. Remote interpolation старт100мс, adaptive50–150мс; position lerp/quaternion slerp, wheel steering/spin/pose согласованы. Local actor использует latest state и bounded velocity extrapolation≤100мс, cosmetic immediate steering допустим; онлайн cannon solver, локальные collision/damage/AI запрещены. Камера следует тому же presentation chassis, не сырому последнему snapshot.

После respawn/round/generation/full resync сбросить history без длинного полёта через карту. Старые/out-of-order states/events не откатывают эпоху, events deduplicated. После100мс extrapolation freeze, после500мс без state показать network warning; reconnect state не интерполировать с умершей машиной. Local input seq/ack diagnostics корректно отражают server consumption, а не подтверждение receipt как применение physics.

Матрица: RTT0/50/100/150мс, jitter±20мс, loss1%, временный разрыв5с/16с, bandwidth cap и slow reader. Для WebSocket/TCP packet loss эмулируется на сетевом уровне/прокси с retransmission/HOL, нельзя тестировать пропуск application messages как эквивалент. Если proxy недоступен, required scenarios blocked с причиной, не подменять synthetic test реальной приёмкой.

Предлагаемые критерии: RTT100/jitter20/loss1%, p95 input-to-visible-response≤200мс (зафиксировать измерение от input timestamp до движения presentation), smooth correction p95≤0.5м, без непредусмотренного jump>2м на свободной езде; teleport, impact и server respawn анализируются отдельно. Интерполируемые remote машины не идут назад по старому tick. При RTT150 нет растущего lag/buffer, однако отклик измерить без обещания такого же качества как LAN. Если серверный-only подход не выдержал, записать blocker и отдельное предложение prediction/reconciliation для согласования, не внедрять локальную физику молча.

## 5. План для исполнителя

1. Сверить actual wire timing/DTO и baseline latency после done0099.
2. Реализовать bounded snapshot buffer, clock estimate, actor/camera interpolation и reset epochs.
3. Добавить local bounded extrapolation и connection quality states, диагностические metrics.
4. Прогнать synthetic buffer tests и реальную network impairment matrix с 3 clients.
5. Сохранить raw time series/video, определить pass/blocker по measured thresholds; описать tradeoffs.

## 6. Критерии готовности

- [ ] Buffer/clock correction ограничены, старые ticks/rounds не откатывают машину; respawn/late join не рисуют пролёт.
- [ ] При RTT100 выполнены заявленные latency/correction thresholds или задача честно blocked с доказательствами.
- [ ] Loss/jitter/slow client не накапливают историю и очередь, freeze/reconnect согласованы с authority.
- [ ] Online не исполняет физический solver или AI; steering/camera/wheels не расходятся по presentation time.
- [ ] Обязательные проверки ниже выполнены и записаны фактически; ограничения и невыполненные пункты перечислены.
- [ ] Отчёт заполнен; после разработки статус ready-for-qa и INDEX синхронизированы. done разрешён только независимому QA.

## 7. Проверки

### Автоматические

Рабочая директория — корень CarWars, кроме явно указанного prefix.

npm test и npm run build; node --test tests/multiplayer-smoothing.test.js. Fake-clock tests: reorder/duplicate/large gap/quaternion antipodes/adaptive buffer cap/clock correction/reset/backwards timestamp; события не повторяются. Дополнительно реализовать tools/network-test documented runner, точную команду и требования proxy записать в README и отчёт.

Во время подготовки тесты приложения не запускались: код не менялся. Новые commands/files выше являются требованиями к исполнителю, не утверждением об их существовании сейчас. Для существующих suite failures отделить baseline failures от регрессии, не исправлять соседние проблемы без необходимости. npm/pnpm доступны; не переустанавливать зависимости без причины.

### Ручные

Обязательно 3 online clients с default102 NPC, 2мин управления на профиль network matrix, прямой участок/поворот/занос/столкновение. Записать input-to-visible latency и corrections отдельно от server authority. Проверить hidden tab, server stall200мс, loss/reconnect5с/16с, slow reader, отсутствие растущего camera lag. На RTT150 дать явную оценку управляемости с видео и измерениями.

QA повторяет обязательные сценарии независимо; артефакт исполнителя помогает воспроизводимости, не заменяет приёмку. Недоступная обязательная проверка явно блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Факты baseline — раздел2. Авторские решения — общий план: 1–3 игрока, max seat3, shared civilian/police world, personal wanted/respawn, shared pickups/props, no online browser solver, server120Hz. Будущий ADR может уточнить измеренные budgets/DTO; значимое изменение authority/физики или game rules согласовать и обновить зависимые задачи.

Предположение: MVP без аккаунтов и persistence, LAN/self-host сначала; публичный deploy и выбор платного сервера не входят. Домены/credentials не нужны для подготовки локального комплекта. При отсутствии done зависимости/ADR оставить draft или blocked с причиной; не начинать реализацию на недоказанном интерфейсе. Конфликт с актуальными чужими правками, несовместимость server physics или невозможный performance/latency budget требует конкретного воспроизведения/вариантов решения, а не молчаливого обхода. Не снижать NPC count и не удалять gameplay для фиктивного pass.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0100-multiplayer-smoothing-and-network-resilience.md в CarWars. Прочитай AGENTS.md, задание целиком и docs/knowledge/multiplayer-server-plan.md; после TASK-0096 также принятый ADR. Проверь актуальный код, локальные изменения и done зависимостей. Для draft сначала сверить результат зависимостей и перевести задачу в ready. Внеси изменения только в указанных границах, проведи автоматические и обязательные ручные проверки и заполни отчёт. Передай ready-for-qa, синхронизируй INDEX.md; done ставит независимый QA. При блокере запиши воспроизведение и необходимое решение. Не включай чужие изменения в commit/push; учитывай исключения AGENTS.md для CLI executor/QA.
```

## 10. Отчёт исполнителя

### Сверка и возобновление, 2026-10-23

- Результат: Уже реализованы SnapshotBuffer, ClientPrediction/PredictionWorld, input history, ack/replay, nearby collisions, bounded replay и streamed static colliders. Документирован переход к non-authoritative prediction, сервер сохраняет решения damage/AI/gameplay.
- Оставшиеся требования/блокеры: Зависимость TASK-0099 не завершена; нужна повторная полная browser/network матрица на окончательном gameplay: 2 минуты на профиль RTT0/50/100/150+jitter/loss, 5/16с разрыв, slow reader/bandwidth cap/hidden tab/stall. Старые 40-секундные ARM probes и key-to-local-step не заменяют input-to-visible и окончательную приёмку.
- Проверено сейчас: чтение перечисленных исходников, тестов и сохранённых отчётов; статусы синхронизированы с INDEX. Это не полная игровая приёмка.
- Изменённые файлы: эта задача, INDEX и общая карта выпуска. Реализация следующего подэтапа и его собственные проверки отражаются в TASK-0110.
- Исторические проверки: см. ссылки общей карты; не объявлены повторёнными сегодня.
- Итоговый статус: `blocked`, 2026-10-23. `done` только после выполнения остатка и независимого QA.

## 11. Отчёт QA

Не проводилась.

## Рекомендация модели исполнителя

Предпочтительно **gpt-6.1-sol, high**. Сложные временные зависимости и диагностика сетевого движения: gpt-6.1-sol, high. Это качественная оценка соотношения затрат и качества по доступному списку моделей и риску задачи, без утверждений о точных тарифах. Для этой серверной серии экономичная модель без запаса на архитектуру и проверки не рекомендуется.
