# TASK-0110: Общий серверный ремонт в мультиплеере

- Статус: done
- Приоритет: high
- Создана: 2026-10-23
- Обновлена: 2026-10-23
- Проект: CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; серверные транзакции, late join и reconciliation
- Зависимости: TASK-0096 — done; действующий hosted preview

## 1. Цель и запрос пользователя

После сверки сетевой серии перейти к следующему незавершённому этапу. Это ограниченный подэтап TASK-0097: перенести существующий repair gameplay на сервер. Сейчас аптечки есть только offline; после изменения повреждённые online машины подбирают общие аптечки, и все клиенты видят один результат. Ремонт не считается завершением всей 0097 или готовностью сетевого релиза.

## 2. Проверенный контекст

2026-10-23, HEAD `5416e88`. `SpikeWorld` уже обслуживает общий physics/AI/props мир; `HostedDrivingRoom` рассылает authoritative binary frames. `RepairPickupManager` и `CarSimulation.repair()` существуют offline. `RepairPickupVisuals` можно использовать повторно. В рабочем дереве есть чужие staged/unstaged изменения; исходные world/deploy-server/online client и visual файлы этой задачи до начала были чистыми. `hosted-room.test.js`, `package.json`, инструменты/правила и соседний traffic/city код изменены до этого запроса — не включать их в свой коммит.

## 3. Область изменений

`tools/multiplayer-spike/world.js`, `deploy/server.js`, `src/multiplayer/room-client.js`, `game.js`; новые `tests/multiplayer-repair.test.js`, `tools/multiplayer-spike/tests/hosted-repair.test.js`, `tests/multiplayer-repair-browser.cjs`; отчёты `docs/knowledge/multiplayer/2026-10-23-repair/`. Обновление статусов/остатков серии 0096–0105, INDEX, ADR и общей карты выпуска относится к этому запросу. Существующие offline repair, физику, карту и протокол движения сохранить. Не внедрять police/arrest/city mode в этот подэтап.

## 4. Требуемое поведение

Один `RepairPickupManager` на серверный мир; существующие count/radius/height/damage правила без новых числовых defaults. Сервер после общего physics step проверяет swept segment каждой машины. Очерёдность победителя: server tick, затем лексикографический playerId, независимо от порядка join. Только connected eligible игрок (damage>0 или detached wheel) потребляет pickup один раз. NPC, здоровая машина, машина высоко над дорогой и клиентские сообщения не ремонтируют/не расходуют pickup.

Ремонт использует `CarSimulation.repair()`, удаляет detached bodies и authoritative dents, сохраняет pose/speed/generation/мир/другие машины. Отдельный repairRevision позволяет presentation сбросить deformation/effects даже при новых повреждениях между двумя кадрами. Pickup остаётся consumed после личного respawn, leave/reconnect и late join; новая комната создаёт новый набор. DTO полное и ограничено числом аптечек/трёх игроков, сообщения шлются только при изменении. Состояние авторитетно: prediction не собирает аптечки при replay. Binary motion codec совместим с текущей версией.

Клиент отображает существующие аптечки по серверному DTO, очищает их ресурсы при смене карты/комнаты/leave. Старые revisions не восстанавливают consumed pickup; late join/reconnect получают полный state. Новая feature требует обновления серверной и клиентской сборок; публичная выкладка не входит в этот шаг.

## 5. План для исполнителя

1. Сверить actual repair/vehicle APIs и границы authoritative step.
2. Подключить shared manager и transaction order, затем полное gameplay DTO/dirty revision.
3. Подключить client replica и существующие visuals, deformation reset и cleanup.
4. Проверить гонку двух игроков, detached wheel, сохранение движения, late join/reconnect и отрицательные случаи.
5. Заполнить отчёт и передать независимому QA.

## 6. Критерии готовности

- [x] Серверная гонка за аптечку ремонтирует ровно одного eligible игрока по tick/playerId; отрицательные случаи не расходуют аптечку.
- [x] Реальные detached wheel bodies/dents/damage восстановлены; pose/speed/generation, другие машины/seed/props сохранены.
- [x] Три настоящие SDK-сессии согласны о pickup/repairRevision, late join/reconnect/respawn сохраняют consumed; forged repair ничего не меняет.
- [x] Три WebGL клиента видят аптечки, исчезновение и восстановленный кузов/колесо; portrait/touch viewport, low/high и смена комнаты проверены без console/pageerror.
- [x] Целевые тесты, full verifier/build и проверка согласованности статусов пройдены; записаны ограничения. После разработки ready-for-qa, done только по отдельному QA.

## 7. Проверки

Из корня: `node --test tests/multiplayer-repair.test.js tools/multiplayer-spike/tests/hosted-repair.test.js`; релевантные prediction/snapshot/destruction regression suites; `node tools/verify.js --full`. Проверять фактические результаты, не подменять unavailable full проверку целевым набором.

Обязательная браузерная приёмка: `node tests/multiplayer-repair-browser.cjs` с доступным Playwright (путь через PLAYWRIGHT_MODULE), локальным hosted server и Vite, server endpoint из env. Harness может только оператором установить начальные poses/damage/колесо и затем дать настоящие server physics steps; public protocol не получает setter. Три изолированных контекста, 1440×900 high и 390×844 low (эмуляция touch), поздний вход, reconnect и новая комната, screenshots и сравнение authoritative/presentation state. Проверить rendered аптечку и восстановленный кузов, а не только JSON. Физический телефон не требуется для этой feature, его performance не утверждать.

## 8. Предположения, вопросы и условия остановки

Подэтап разрешён текущим запросом и действующей preview основой, не требует завершения parent 0097; собственная зависимость — принятое исследование 0096. DTO распространяется отдельным reliable gameplay сообщением, binary motion сохраняется. Нет внешнего платного сервиса/аккаунтов/деплоя. Полный перенос core, полиция/wanted/arrest и итоговая сетевая матрица остаются открытыми требованиями основной серии.

## 9. Сообщение для передачи модели

Выполни docs/tasks/TASK-0110-multiplayer-shared-repair.md. Прочитай AGENTS.md, задачу и multiplayer-release-readiness.md; сохрани чужие правки. Проверь server transaction/DTO/client visual/cleanup сценарии. Заполни раздел 10, выставь ready-for-qa и синхронизируй INDEX. Независимый QA заполняет раздел 11 и принимает либо возвращает задачу; не закрывай parent 0097 автоматически.

## 10. Отчёт исполнителя

2026-10-23, рабочий diff поверх `5416e88`.

- Результат: один server-owned RepairPickupManager на комнату, стабильный порядок tick/playerId, восстановление damage/wheels/dents без teleport/смены generation; shared gameplay DTO с dirty revision, полный welcome/late join/reconnect и read-only client visuals. Новые сетевые команды ремонта не добавлены.
- Изменения: world/deploy room, online room-client/game, две Node suites и воспроизводимый browser harness. Архитектурная сверка задач 0096–0105/INDEX/ADR и [общая карта](../knowledge/multiplayer-release-readiness.md) описывают реальные остатки; принятые QA 0107–0109 сохранены. Чужие источники/инструменты/удаления не изменялись.
- Автоматические проверки: новые Node+SDK **6/6**; prediction/snapshot/destruction и hosted regressions **22/22**; spike/hosted room/version/repair **8/8**. Последний набор включает ожидаемый отказ старой presentation version и expired reconnect token, это проверенные отрицательные сценарии.
- Финальный `node tools/verify.js --full`: **407/407**, production build успешно; Node `v24.19.0`, receipt ok=true, fingerprint `0df871c0d72085c35e11a04bf9655c4bbb98c13d64f47befc618c2b72cf20f93`, at `2026-10-23T12:39:32.684Z`. Предыдущие два full запуска тоже завершили тесты/сборку, но их квитанции отклонены из-за правок browser harness во время прогона; для передачи используется только последний стабильный результат.
- Браузер: `tests/multiplayer-repair-browser.cjs` успешно, три отдельные Edge/WebGL сессии, 102 NPC; high 1440×900, low 390×844/touch emulation, late join 844×390. Damage 0.8/651 деформированных троек/оторванное колесо → damage0/deformation0/четыре attached wheels; pickup instance determinant1→0. Late join/reconnect/new room/leave cleanup прошли; console/pageerror=[]; четыре PNG просмотрены. Артефакты и ограничения harness: [README](../knowledge/multiplayer/2026-10-23-repair/README.md), [raw JSON](../knowledge/multiplayer/2026-10-23-repair/browser-report.json), [хэши](../knowledge/multiplayer/2026-10-23-repair/source-hashes.json).
- Документация: все статусы 0096–0110 сверены с INDEX; ссылки новых документов разрешаются. 0096 восстановлена по существующему QA, 0097 in-progress, 0098–0101 blocked с остатками, 0102–0105 draft. Это не новая приёмка полной серии.
- Ограничения: operator fixture задаёт исходное повреждение/позу и начальную точку проезда, результат идёт через настоящий solver/SDK; viewport touch эмулирован, физический телефон/WAN не проверены. Серверная публичная выкладка не выполнялась. Police/wanted/arrest/core/refactor и итоговый сетевой релиз остаются открытыми.
- Выполнены критерии раздела 6 по проверкам исполнителя; независимая приёмка отдельным QA ещё требуется. Итог: `ready-for-qa`, 2026-10-23.

## 11. Отчёт QA

### Независимая приёмка 2026-10-23

**Решение: done.** Проверен рабочий diff поверх HEAD `5416e88`: world/deploy room, room-client/game, новые Node/SDK/browser сценарии и сверка серии 0096–0105/ADR/карты выпуска. Все критерии раздела 6 подтверждены. QA не менял исходники или тесты исполнителя, не принимал parent 0097 и не переоткрывал исторические QA 0107–0109. Статусы меняются queue CLI; commit/push выполняет ведущий.

| Критерий раздела 6 | Независимое подтверждение |
| --- | --- |
| Однозначная серверная транзакция и отрицательные случаи | Node/SDK 6/6: оба порядка join, один winner и один расход; healthy/disconnected/airborne не потребляют. Собственные fixtures дополнительно подтвердили NPC exclusion, detached-only при damage=0, приоритет более раннего tick и swept crossing с обоими концами вне радиуса. |
| Восстановление реального состояния и сохранение мира | Detached body удалён из world, колёса attached, damage/dents сброшены, generation/signature/pose/speed/другая машина сохранены; repair вызывает существующий CarSimulation.repair(), не reset. Изучена сохранность props/seed и отсутствие repair в prediction/replay. Дополнительный browser fixture добавил новые damage/dent до следующей отправки frame: старые dents сброшены по repairRevision, новая единственная вмятина сохранена у обоих renderer. |
| Реальные SDK, late join/reconnect/respawn/forgery | SDK suite повторена: три сессии согласны о consumed/repairRevision; fake repair отклонён; reconnect identity и personal respawn не восстанавливают pickup. Отдельно подтверждены явный leave/rejoin существующей комнаты и отсутствие повторных gameplay broadcast без изменения revision. DTO bounded 12 pickups/3 players, full state в welcome, устаревшие revisions не принимаются. |
| Три WebGL клиента, визуал и ресурсы | Основной browser harness прошёл независимо: 1440×900 high, 390×844 low/touch, late observer 844×390; четыре PNG просмотрены. Аптечка видна до и отсутствует после, geometry deformation >0→0, detached→attached, repairRevision=1. Late join/reconnect/leave cleanup/new room прошли, console/pageerror=[]. Новый мир даёт available pickups. Регрессия смены комнаты/карты подтверждена hosted-room suite; disposer геометрии/materials изучен. |
| Проверки, статусы и честные ограничения | Node/SDK 6/6, regression 24/24, пять дополнительных fixtures и два browser-прогона прошли. matchingReceipt() подтвердил актуальную полную квитанцию 407/407 + build. Все 15 статусов 0096–0110 совпали с INDEX; 20 ссылок новой карты/задачи разрешились. Сверка code/исторических отчётов подтверждает частичность 0097–0101 и draft 0102–0105. |

Команды и артефакты:

- `node --test tests/multiplayer-repair.test.js tools/multiplayer-spike/tests/hosted-repair.test.js` → **6/6**, exit0, 7.106с.
- `node --test tests/multiplayer-prediction.test.js tests/multiplayer-snapshot.test.js tests/multiplayer-destruction.test.js tools/multiplayer-spike/tests/hosted-prediction.test.js tools/multiplayer-spike/tests/hosted-destruction.test.js tools/multiplayer-spike/tests/hosted-room.test.js tools/multiplayer-spike/tests/hosted-prop-version.test.js` → **24/24**, exit0, 7.907с; version rejection ожидаем assertion.
- Полный verifier повторно не запускался: `matchingReceipt(process.cwd())` вернул действующую квитанцию Node `v24.19.0`, tests/build=0, at `2026-10-23T12:39:32.684Z`, fingerprint `0df871c0d72085c35e11a04bf9655c4bbb98c13d64f47befc618c2b72cf20f93`. Журналы дополнительно просмотрены: 407 pass/0 fail, Vite build 1.70с, обычное предупреждение large chunk. `tools/telegram/verify.js` удалён в чужом diff; использован действующий root verifier/matchingReceipt согласно актуальной задаче. Новые QA-артефакты внутри docs не меняют fingerprint.
- `node tests/multiplayer-repair-browser.cjs` с доступным Playwright и `ARTIFACT_DIR=docs/knowledge/qa-0110` → passed, errors=[]. `node docs/knowledge/qa-0110/extra-check.mjs` → 5 passed. Дополнительный `redamage-browser.cjs` с отдельным ARTIFACT_DIR → passed, errors=[]. [Артефакты, методика и пределы](../knowledge/qa-0110/README.md), [аудит/хэши/квитанция](../knowledge/qa-0110/audit.json), [основной raw browser](../knowledge/qa-0110/browser-report.json), [повторное повреждение](../knowledge/qa-0110/redamage/browser-report.json).

Ограничения: operator fixtures задают начальные poses/damage/колесо; основной подбор идёт через реальные server physics/SDK. Повторное повреждение задано оператором перед serialization для проверки revision, не симулирует новое столкновение. Touch viewport эмулирован, физический телефон/WAN/production deployment не проверены. Не измерены release latency/capacity/полный police gameplay. Дефектов в области 0110 не выявлено; завершён только общий серверный ремонт и аудит текущей серии.

## Рекомендация модели исполнителя

Предпочтительно **gpt-6.1-sol, high**: достаточно для ограниченного server/client среза с транзакциями, recovery и проверкой ресурсов; качественная оценка по сложности без утверждений о тарифах.
