# TASK-0035: Безопасный спавн NPC и очередь при нехватке места

- Статус: done
- Приоритет: high
- Создана: 2026-10-06
- Обновлена: 2026-10-06
- Проект: CarWars, C:/Users/gobes/OneDrive/Документы/CarWars
- Рекомендуемый исполнитель: Сильная модель, высокий уровень рассуждения: occupancy, очереди и согласование reset/LOD.
- Зависимости: нет; исправляет текущую TASK-0027 на review; используется reference note TASK-0034, её завершение не блокирует insertion checks

## 1. Цель и запрос пользователя

Запрос: боты могут спавниться друг в друга. После старта, увеличения count, reset и rebuild новый NPC появляется только в свободном дорожном footprint с безопасными передним/задним gap. Если места нет, число явно остаётся pending с причиной, без наложений.

## 2. Проверенный контекст

Проверено по рабочему дереву 2026-10-06: Three.js 0.180.0, cannon-es 0.20.0, Tweakpane 4.0.5, Vite 7.1.9, node:test. Git HEAD: c4546816659b200cf3e6f30f9e57b440e9639a43. Дерево грязное: main.js, traffic.js, city-generator.js и другие файлы изменены; city-scene.js, settings.js, traffic-ai.js, traffic-signals.js, ряд тестов/tools и задачи0013–0029 untracked. Описание относится к рабочему дереву, не чистому HEAD. При подготовке тесты приложения и воспроизведение багов не запускались; симптомы даны пользователем, факты ниже проверены чтением кода. Сохранять существующие локальные изменения.

| Файл / символ | Проверенный факт |
| --- | --- |
| src/traffic.js / add | Детерминированный выбор edge и t=0.30/0.50/0.70, без occupancy/bounds/player проверки до создания CarSimulation/body. |
| src/traffic.js / applyCount | Синхронный while add до requestedCount; pendingCount затем очищается независимо от вместимости. |
| src/traffic.js / reset, setRoadNetwork | Reset возвращает исходные точки; смена сети пересоздаёт состояние, нужна единая safe insertion policy. |
| src/traffic.js / updateLod, buildOccupancy | Логические NPC входят в sensing, activation clearance проверяет только физических и игрока; overlap logical также важен. |
| src/vehicle.js / CarSimulation body | Кузов содержит boxes half0.87/0.27/2.08 и cabin shape; учитывать действительный yaw/footprint, не расстояние центров вместо всех границ. |

## 3. Область изменений

traffic.js, допустим src/traffic-spawn.js/common occupancy helper, relevant tests/tools. Изменять settings.js только read-only actual/pending reason при необходимости. Не менять default/count limit60/300, размеры дорог, controller повседневного движения и физику игрока. Сохранять загрузку/retry, speedometer, обычное управление/пончики и штатный Tweakpane. Не редактировать node_modules/dist вручную и не откатывать чужие изменения. Внести отчёт и статус в этот файл и INDEX.

## 4. Требуемое поведение

- Использовать actual occupied footprints всех NPC logical/physical и player, статические препятствия, road bounds и intersection/no-spawn зон. Перед созданием тела резервировать candidate на fixed-step boundary; следующие candidates текущего batch учитывают предыдущие.
- Safety test учитывает ориентированный кузов плюс именованный minimum gap и скорость лидера/следующего NPC, чтобы не появляться прямо в тормозном пути. Начальное предложение автора:2 м bumper gap, уточнить по автомобильным размерам/скорости; не применять этот зазор как universal центр distance.
- Детерминированный bounded поиск по directed edges/lane slots с seed/ID, без infinite loop. Увеличение count не пересчитывает существующие позиции и не возвращает живые машины на spawn.
- Если места нет: desired/active/pendingCount и insertionReason доступны; отложенные заявки пробуются ограниченной квотой на AI/fixed boundary, не каждый кадр полнымN². Не уменьшать requestedCount молча.
- Снижение count удаляет excess и отменяет pending; reset/rebuild планируют безопасное размещение заново; dispose очищает queue/reservations/resources. Результат deterministic при одинаковом seed/input.
- При logical→physical использовать общую проверку footprint; нельзя добавлять тело внутри другого logical/physical NPC. Нельзя лечить overlap телепортацией живой машины или выключением collisions.
- Совместимость status(): count=active total, bodies=physical, logical/visible отдельно; pending boolean пока есть неисполненные заявки, requestedCount сохраняет выбор. Обновить browser assumptions, а не отключать checks.

## 5. План для исполнителя

1. Воспроизвести коллизии count6→60→300 и reset; добавить fixture на занятый candidate.
2. Выделить candidate footprint/safety и allocation queue, переиспользовать существующую spatial occupancy.
3. Подключить add/count/reset/rebuild/activation к единой проверке; ограничить квоту retry.
4. Выполнить tests на невозможность размещения, retry после освобождения, cancellation и ресурсы.

## 6. Критерии готовности

- [ ] Первичная загрузка/увеличение/reset/rebuild не создают intersecting footprints среди NPC, игрока и статических объектов.
- [ ] При занятой сети сохранён requestedCount, активное число и причина ожидания видны; освобождение места позволяет вставку.
- [ ] Снижение/reset/dispose корректно очищают очередь, число/ID/маршруты существующих машин не скачут при добавлении.
- [ ] Logical→physical не создаёт overlap; повторные count/rebuild не дают утечек и бесконечных retry.

## 7. Проверки

### Автоматические

`pnpm test`; `pnpm build`; `node tools/traffic-check.cjs`; `node tools/city-resize-check.cjs`; `node tools/traffic-performance.cjs` для проверки стоимости queue. Новые tests seeded pairwise OBB separation для6/60/300 наwidth12/15/30, blocked insertion/retry/cancel, player/static obstacle, logical occupancy и mode activation. При нехватке вместимости ожидается pending, а не обязанность сразу active300.

Команды выполнять из корня CarWars, против существующего dev-server или `pnpm dev`. Browser tools используют `CARWARS_BASE_URL` и при необходимости `PLAYWRIGHT_MODULE` для установленного Playwright; не устанавливать зависимости только ради запуска проверок. Ожидается отсутствие ошибок, результаты записать в отчёт. Если обязательная проверка недоступна, оставить соответствующий критерий открытым и статус review.

### Ручные

/#debug: 0→6→60→300→0 десять раз, reset и rebuild width12/15/30, free-camera обзор spawn slots. Поставить player в candidate lane: машина не появляется внутри; после отъезда заявка выполняется. Сохранённый профиль с count300 загружается теми же безопасными правилами.

## 8. Предположения, вопросы и условия остановки

Это самостоятельное исправление вставки, не замена всего AI. Safe insertion queue взята как подход из reference note; не требуется runtime SUMO. Контакты позже движения не являются ошибкой спавна: тест фиксирует момент insertion, а затем отдельно передаёт controller collisions в TASK-0036.

Перед правками перечитать актуальный код и задание. Новейший запрос пользователя имеет приоритет; при расхождении записать его. Незавершённые обязательные зависимости не допускают ready. Невыполненные обязательные проверки означают review, а не done.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0035-safe-npc-spawn.md в CarWars. Прочитай AGENTS.md, docs/tasks/README.md и задание целиком. Проверь актуальность кода и зависимости, сохрани локальные изменения. Выполни изменения в указанной области, проведи перечисленные проверки, заполни отчёт и обнови статус задачи и INDEX.md. Не объявляй done при открытых критериях; запиши конкретное ограничение.
```

## 10. Отчёт исполнителя

- Результат: Добавлены направленные слоты вставки и SAT-проверка footprint по кузову, игроку, другим logical/physical NPC и статическим зданиям. Count сохраняет желаемое число, добавляет до4 машин на AI tick и повторяет bounded поиск; очередь отменяется при уменьшении. Reset использует тот же allocator и сохраняет идентификаторы; rebuild в игре обновляет сетку/здания и затем выполняет reset. LOD activation использует ту же footprint-проверку.
- Изменённые файлы и зачем: `src/traffic-spawn.js` — константы слотов, oriented SAT и скоростной following gap; `src/traffic.js` — allocator, occupancy, pending queue, препятствия, reset и LOD; `src/main.js` — передача footprints зданий/road plan; `src/settings.js` — readonly actual/pending; `tests/traffic-spawn.test.js` — gap/obstacle/deterministic capacity; `tests/traffic-physics.test.js` — queue retry/cancel, count lifecycle, reset IDs/footprints; browser tools — ожидание завершения очереди перед smoke checks.
- Команды и фактические результаты: `pnpm test` — 102/102 passed; `pnpm build` — passed, Vite сообщил обычное предупреждение о vendor chunk >500 kB. Целевые traffic/reset/spawn tests — 12/12 passed. `node tools/traffic-check.cjs`, `node tools/city-resize-check.cjs`, `node tools/traffic-performance.cjs` — недоступны: отсутствует пакет `playwright`, `PLAYWRIGHT_MODULE` не задан.
- Ручные проверки: Изолированная вкладка подтвердила отображение «Машины», «Активно», «Очередь». Интерактивный count/rebuild/performance smoke не завершён из-за ограничений browser bridge. Пользователь сообщил, что машины спавнятся нормально, и явно принял TASK-0035; это закрывает ручную приёмку поведения спавна.
- Выполненные критерии: Детеминированная capacity allocation без footprint конфликтов для 6/60/300 NPC на ширине12/15/30; тесты блокировки/очистки/повтора/отмены; reset сохраняет ID и безопасные интервалы при10 повторах; LOD-to-physical проверен тестом; лимиты очереди конечны.
- Непроверенное, блокеры и отклонения от плана: Автоматический браузерный resize/reset/performance benchmark не запускался из-за отсутствия Playwright runtime. Поведение insertion/reset покрыто unit-тестами на трёх ширинах и принято пользователем; performance profiling следует перепроверить отдельно при доступном browser runtime.
- Итоговый статус и дата: done по явной приёмке пользователя, 2026-10-06.

