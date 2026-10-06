# TASK-0034: Исследование устойчивого NPC-трафика и план исправления зависаний

- Статус: done
- Приоритет: high
- Создана: 2026-10-06
- Обновлена: 2026-10-06
- Проект: CarWars, C:/Users/gobes/OneDrive/Документы/CarWars
- Рекомендуемый исполнитель: Сильная модель, высокий уровень рассуждения: воспроизведение, сравнение моделей и ограниченный архитектурный выбор.
- Зависимости: нет; читать отчёты TASK-0024/0027/0028 на review, их done не требуется

## 1. Цель и запрос пользователя

Пользователь просит изучить доступные источники по городскому NPC-трафику и записать лучшие подходящие механики/фичи в задачу. Результат: проверенная для текущего проекта записка с воспроизведениями и конкретным планом внедрения безопасного следования/перекрёстков/recovery, достаточным для TASK-0036.

## 2. Проверенный контекст

Проверено по рабочему дереву 2026-10-06: Three.js 0.180.0, cannon-es 0.20.0, Tweakpane 4.0.5, Vite 7.1.9, node:test. Git HEAD: c4546816659b200cf3e6f30f9e57b440e9639a43. Дерево грязное: main.js, traffic.js, city-generator.js и другие файлы изменены; city-scene.js, settings.js, traffic-ai.js, traffic-signals.js, ряд тестов/tools и задачи0013–0029 untracked. Описание относится к рабочему дереву, не чистому HEAD. При подготовке тесты приложения и воспроизведение багов не запускались; симптомы даны пользователем, факты ниже проверены чтением кода. Сохранять существующие локальные изменения.

| Файл / символ | Проверенный факт |
| --- | --- |
| src/traffic.js / add, applyCount, reset | Spawn без проверки occupancy; count увеличивается по новой requestedCount-схеме без перепланирования старых slot positions. |
| src/traffic.js / updateControllers, leaderSpeedLimit, passingOffset | Есть10Hz sensing и простая leader speed bound; манёвр оценивает статические позиции, заканчивается по blocker change или8с. |
| src/traffic.js / reservations | ID-приоритет, entered при distance<6; release на достижении node; exit occupancy явно не проверяется. |
| src/traffic.js / noProgressTime, stuck-recovery | noProgressTime растёт только с leader.blocker; без него застрявший/сошедший с пути NPC не набирает таймер; replan recovery допускается только при отсутствии leader. |
| src/traffic.js / stepLogical, updateLod | Logical интегратор по yaw/control без физконтактов; близкая активация запрещена при distance<5.2, требуется согласованное состояние и предотвращение прохода сквозь occupied footprints. |
| docs/knowledge/traffic-npc-reference.md | Первичное исследование автора с источниками, ограничениями и механиками для оценки. |

## 3. Область изменений

Документация, диагностические воспроизведения/tools/tests без изменения production AI. Разрешено создать docs/knowledge/traffic-npc-design.md и tools/traffic-repro.cjs; уточнить TASK-0036, не удаляя её структуру/отчёт. Не внедрять SUMO/CARLA как внешние runtime сервисы и не устанавливать большие движки ради исследования. Сохранять загрузку/retry, speedometer, обычное управление/пончики и штатный Tweakpane. Не редактировать node_modules/dist вручную и не откатывать чужие изменения. Внести отчёт и статус в этот файл и INDEX.

## 4. Требуемое поведение

- Разделить spawn overlap, logical overlap, physical contact, signal queue, blocking exit, reservation starvation, lost path и controller stall. Для каждого подтвердить/опровергнуть предположение воспроизводимым seed/state/time trace.
- Изучить источники из reference note и их применимость. Обязательные кандидаты: безопасная insertion queue, bounded car-following IDM/ACC-style, path-relative progress/lookahead, прогноз swept vehicle footprint, lane-change safety с cooldown, FIFO/aging приоритет и keep-clear outbound check.
- Выбрать минимальный достаточный набор для устранения пользовательских багов. Механики с объяснением «что исправляет, где внедрить, inputs/outputs, стоимость, как проверять»; не добавлять поворотники/пешеходов/агрессивные стили ради списка features.
- Единый snapshot для logical/physical NPC перед decisions; договориться о lane coordinate/progress, bumper gaps, signal stop-plane и lifecycle reservations. Физический control переводит target motion в steer/throttle/brake, не переставляет тела.
- Обосновать FSM normal/queue/signal/yield/maneuver/recovery и отделить законную остановку от тупика. Для освобождения настоящего тупика предложить безопасный уступающий манёвр с устойчивым приоритетом; запрет телепортации/удаления/отключения контактов как лечения.
- Нужны конкретные параметры в м/с/сек, failure policy при отсутствии safe corridor, сложность по N, взаимодействие с60/300 и общим world. Заранее решить, нужен ли полный MOBIL или достаточно corridor gate; не копировать highway параметры для города.
- Обновить scope/plan/tests TASK-0036 по выводу; после исследования она остаётся draft, пока TASK-0035 не done и контекст не перепроверен.

## 5. План для исполнителя

1. Прочитать reference note, весь traffic.js/traffic-ai.js/signals и отчёты24/27/28; подтвердить актуальность кода.
2. Снять исходные traces для6/60/300, смены count, reset, logical↔physical и перекрёстка.
3. Сравнить исходную схему и кандидатов в таблице, выбрать interfaces/параметры без production patch.
4. Записать ADR/сценарии приёмки и актуализировать TASK-0036, заполнить отчёт.

## 6. Критерии готовности

- [x] Для overlap и необъяснимой остановки есть воспроизведение или явно записана невозможность/условия получения, без выдачи code suspicion за runtime факт.
- [x] Первичные источники с датой доступа и механизмами связаны с конкретными кодовыми проблемами.
- [x] Выбран ограниченный план/interfaces/FSM и тесты для logical/physical без телепортаций.
- [x] TASK-0036 уточнена с согласованными критериями и зависимостями; исследование не меняет production поведение.

## 7. Проверки

### Автоматические

Для документационного результата сборка/unit сами по себе не нужны. Если добавлен repro tool, `node tools/traffic-repro.cjs` против dev-server; собрать trace с IDs/state/reason/route/progress/position/mode/signal/reservation. `pnpm test` нужен только при добавлении исполняемых regression fixtures. Browser errors должны отсутствовать или быть записаны как воспроизведение.

Команды выполнять из корня CarWars, против существующего dev-server или `pnpm dev`. Browser tools используют `CARWARS_BASE_URL` и при необходимости `PLAYWRIGHT_MODULE` для установленного Playwright; не устанавливать зависимости только ради запуска проверок. Ожидается отсутствие ошибок, результаты записать в отчёт. Если обязательная проверка недоступна, оставить соответствующий критерий открытым и статус review.

### Ручные

Наблюдать пользовательские сценарии: сразу после старта/увеличенияcount/reset, два столкнувшихся NPC, законная red очередь, green с забитым выходом, NPC после толчка с полосы, возврат из logical LOD. Диагностику и наблюдение синхронизировать по simulation time.

## 8. Предположения, вопросы и условия остановки

Reference note — начальный отбор автора, не окончательная архитектура и не доказательство лучшего алгоритма. Исследование необходимо, поскольку текущие дефекты затрагивают связанный AI/LOD/lifecycle. Если требуется смена библиотеки/сервиса или полноценная перестройка road network, оформить конкретное решение/границы, не начинать такую миграцию молча.

Перед правками перечитать актуальный код и задание. Новейший запрос пользователя имеет приоритет; при расхождении записать его. Незавершённые обязательные зависимости не допускают ready. Невыполненные обязательные проверки означают review, а не done.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0034-npc-traffic-research.md в CarWars. Прочитай AGENTS.md, docs/tasks/README.md и задание целиком. Проверь актуальность кода и зависимости, сохрани локальные изменения. Выполни изменения в указанной области, проведи перечисленные проверки, заполни отчёт и обнови статус задачи и INDEX.md. Не объявляй done при открытых критериях; запиши конкретное ограничение.
```

## 10. Отчёт исполнителя

- Результат: подтверждено воспроизводимое пересечение NPC footprint при увеличении count до300 и после reset. Долгий необъяснимый stall в текущем seed/time trace не воспроизведён: сигнал/очередь имеют explicit wait reason; кратковременный нулевой velocity сразу после reset наступает при simTime0 до первого decision tick. Кодовая причина неполного stall timer зафиксирована отдельно от runtime фактов. Подготовлен ADR для исправлений35/36.
- Изменённые файлы и зачем: `docs/knowledge/traffic-npc-design.md` содержит findings, ограничения, ADR, интерфейсы, параметры и regression matrix; `tools/traffic-repro.cjs` воспроизводимо прогоняет count6/60/300/reset, проверяет oriented footprint SAT и сохраняет snapshots; `docs/knowledge/traffic-repro-2026-10-06.json` — фактический browser trace; `src/traffic.js` — только read-only diagnostics для signal/wait/reservation age, без изменения AI поведения; `src/main.js` — diagnostic simulation clock; `docs/tasks/TASK-0036-npc-traffic-liveness.md` актуализирована по ADR, остаётся draft до TASK-0035.
- Команды и фактические результаты: `node tools/traffic-repro.cjs` против Vite Edge+SwiftShader — pass, page errors0. Первый count300 snapshot t=6.72с нашёл4 пересекающиеся oriented footprints (npc-01/66,02/65,04/74,05/80), повтор t=8.34с те же4; reset t=0 также4. count60 t=4.98 и count6 t=5.20/6.61 — ноль overlaps. Browser runner сохраняет routes, state/reason, progress, position/heading/speed, LOD mode, signal, reservation age; JSON trace около1.08 MB.
- Ручные проверки: сценарии изменения количества/reset выполнены в изолированном Chromium на1280×800; 60 после5с имел24 автомобиля со скоростью<0.3м/с, все ожидания имели signal/yield reason. На300 после1.62с было60 таких состояний (signal/yield), необъяснимых near-zero —0. Сразу после reset все300 stationary в simTime0/following; через0.97с 54 уже стоят на красный, необъяснимых near-zero —0.
- Выполненные критерии: spawn overlap подтверждён сразу после requested count300 и после reset; отсутствие persistent unexplained stall записано с временными границами/условиями, не объявлено отсутствием code-дефекта; пять первичных источников проверены и связаны с реализацией; ADR ограничивает архитектуру и regression tests TASK-0036.
- Непроверенное, блокеры и отклонения от плана: trace подтвердил spatial overlap, но не провёл контролируемую пару уже контактирующих NPC по всем направлениям; это проверка TASK-0036. Долгий stall не воспроизведён существующим seed за~10с runtime; для него TASK-0036 обязана иметь displacement/off-route deterministic fixture. В production AI поведение не менялось.
- Итоговый статус и дата: done, 2026-10-06.

