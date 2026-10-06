# TASK-0036: Устойчивое движение NPC без беспричинных зависаний

- Статус: in-progress
- Приоритет: high
- Создана: 2026-10-06
- Обновлена: 2026-10-06
- Проект: CarWars, C:/Users/gobes/OneDrive/Документы/CarWars
- Рекомендуемый исполнитель: Сильная модель, высокий уровень рассуждения: связанные traffic rules, FSM, физика и logical LOD.
- Зависимости: TASK-0034 и TASK-0035 — должны быть done; TASK-0033 — stop-plane реализована и должна использоваться как единый контракт

## 1. Цель и запрос пользователя

Запрос: боты останавливаются и ничего не делают. После исследования и safe spawn исправить причину остановок: допустимые очереди продолжают движение после разрешения, тупики с доступным безопасным выходом разрешаются; при полностью закрытом пути NPC ждёт с понятной причиной и повторной оценкой.

## 2. Проверенный контекст

Проверено по рабочему дереву 2026-10-06: Three.js 0.180.0, cannon-es 0.20.0, Tweakpane 4.0.5, Vite 7.1.9, node:test. Git HEAD: c4546816659b200cf3e6f30f9e57b440e9639a43. Дерево грязное: main.js, traffic.js, city-generator.js и другие файлы изменены; city-scene.js, settings.js, traffic-ai.js, traffic-signals.js, ряд тестов/tools и задачи0013–0029 untracked. Описание относится к рабочему дереву, не чистому HEAD. При подготовке тесты приложения и воспроизведение багов не запускались; симптомы даны пользователем, факты ниже проверены чтением кода. Сохранять существующие локальные изменения.

| Файл / символ | Проверенный факт |
| --- | --- |
| src/traffic.js / updateControllers, reservations, replanAtNearest | Выбор route, progress, signal, reservation и манёвра связан в одном проходе по states. |
| src/traffic.js / noProgressTime, stuck-recovery | Без leader timer обнуляется; с постоянным leader replan recovery не запускается; недостаточно просто увеличить steering/throttle. |
| src/traffic.js / passingOffset | Static corridor check, нет прогноза времени сближения/проверки всего return path. |
| src/traffic.js / stepLogical, updateLod | Внешний logical control тот же, движения/contacts различаются; правило не должно работать лишь рядом с player. |
| docs/knowledge/traffic-npc-reference.md; TASK-0034 | Начальные рекомендации и обязательный design/trace этап. |
| tests/traffic-ai.test.js, traffic-physics.test.js, traffic.test.js | Existing route/leader/reservation/LOD tests; требуется измерять движение, не только имя state. |

## 3. Область изменений

После ADR34: traffic.js/traffic-ai.js и небольшие helper modules для follow/progress/intersection/maneuver по выбранному плану. Сохранять CarSimulation shared world,60/300,10Hz decisions,STEP=1/120 игрока, signal phases и обычную камеру/UI. Не мигрировать к внешнему симулятору. Сохранять загрузку/retry, speedometer, обычное управление/пончики и штатный Tweakpane. Не редактировать node_modules/dist вручную и не откатывать чужие изменения. Внести отчёт и статус в этот файл и INDEX.

## 4. Требуемое поведение

- Окончательный набор/interfaces/параметры заполняет исследование34; до завершения зависимостей не начинать production patch. Базовые требования ниже обязательны независимо от выбранной car-following модели.
- Применить ADR `docs/knowledge/traffic-npc-design.md`: snapshot→hazards→decision→controls на одном состоянии, общий для logical/physical LOD. Сохранить10Hz решений/STEP=1/120s и spatial hash12м; не выполнять state mutations так, чтобы результат зависел от порядка обхода.
- Продольное следование использует oriented bumper gap и closing speed; стартовые параметры для проверки `s0=2м`, `T=0.8с`, `b=5.5м/с²`, city speed≤8.5м/с. Оставить bounded safe-speed эквивалент; full IDM не обязателен. Красная фаза использует TASK-0033 stop-plane и передний габарит.
- Прогресс мерить вдоль направленного ребра. `noProgressTime` растёт при<0.2м продвижения за1с только вне законного wait reason; после3с сделать path/corridor reevaluation. reason/state различают signal, очередь, junction priority, blocked exit, no path, collision jam и controller stall.
- Junction keep-clear проверяет выходной oriented footprint минимум4.16м+2м до въезда. FIFO/aging использует request time и stable ID tie-break; entered reservation освобождается после заднего bumper выхода; stale owner очищается по удалению/route invalidation, timeout не разрешает второй конфликтный въезд.
- Recovery планирует swept oriented footprint ведущих/задних/встречных участников до3с на полном пути выезда/возврата; `cooldown=2с`, reevaluation без коридора каждые0.5с. Два участника взаимного контакта имеют устойчивый yield priority. Полностью закрытый путь означает объяснимое ожидание без телепортации/удаления/отключения contacts.
- Приёмочные метрики: после green/освобождения лидера начать движение≤3с; после stall≥3с переоценить путь; две контактирующие машины со свободным corridor разъезжаются≤15с. При полностью заблокированном выходе законное ожидание не является liveness fail.
- Reset/count/network/mode переходы очищают stale progress/requests без потери route/ID и скачка позиции. У300 возможна настоящая очередь: не обещать свободное движение каждой машины при полной блокировке сети.
- Опубликовать diagnostics waitingReason/blocker/progressTime/reservation age/maneuver и trace. Не маскировать сложные случаи state='following' при нулевой физической скорости.

## 5. План для исполнителя

1. После done34/35 проверить актуальность helper contracts и прочитать весь research ADR; перевести draft→ready и записать выбранный scope.
2. Воспроизвести исходные trace fixtures и реализовать выбранный follow/progress/junction/recovery по этапам.
3. Прогнать одинаковые ситуации в logical и shared physical mode, displaced car и mutual contact.
4. Выполнить стресс/регрессии и профилирование в одинаковой среде; записать residual настоящий congestion отдельно от bugs.

## 6. Критерии готовности

- [ ] Green/освобождение дороги запускает очередь в утверждённый срок; signal waiting не провоцирует незаконный объезд.
- [ ] NPC после толчка/off-route без лидера восстанавливает progress либо сообщает конкретное отсутствие safe route.
- [ ] Два соприкоснувшихся NPC со свободным corridor выходят за15 с без прыжка/удаления; occupied/oncoming corridor блокирует манёвр.
- [ ] Перекрёсток с забитым выходом не запирается новыми въездами, нет starvation/stale owner или конфликтной entered reservation.
- [ ] Logical и physical mode сохраняют safety/liveness; tests/trace/профиль60/300 записаны.

## 7. Проверки

### Автоматические

`pnpm test`; `pnpm build`; `node tools/traffic-check.cjs`; `node tools/city-resize-check.cjs`; `node tools/traffic-performance.cjs`; `node tools/traffic-repro.cjs`. Добавить deterministic15–60с fixed-step traces для всех критериев: physical contact, red→green, leader clear, blocked outbound, two-way yield, lost route и logical↔physical. Проверять прогресс/footprint/gaps, а не только state. Сравнить performance на6/60/300 до/после с TASK-0027 desktop surrogate baseline при одинаковом seed/environment; реальный телефон нужен только для заявления о мобильном бюджете.

Команды выполнять из корня CarWars, против существующего dev-server или `pnpm dev`. Browser tools используют `CARWARS_BASE_URL` и при необходимости `PLAYWRIGHT_MODULE` для установленного Playwright; не устанавливать зависимости только ради запуска проверок. Ожидается отсутствие ошибок, результаты записать в отчёт. Если обязательная проверка недоступна, оставить соответствующий критерий открытым и статус review.

### Ручные

Desktop/mobile viewport: поездка среди60 NPC, red queues, перекрёсток с blocked exit, collision jam и displaced NPC; свободной камерой проверить logical район. Потом count300 стресс и возврат60, десять reset/rebuild. Настоящий затор имеет причину и реагирует на открытие пути.

## 8. Предположения, вопросы и условия остановки

Draft из-за зависимости от done34/35. Runtime overlaps воспроизведены trace для count300 и переданы safe insertion в TASK-0035. Постоянный необъяснимый stall в зафиксированном scenario не воспроизведён; stall/off-route fixture всё равно обязателен для proof, поскольку code inspection выявил неполный no-progress timer. Эта задача заменяет незавершённую liveness-приёмку24 по новому запросу; предыдущий отчёт сохранить. Полный MOBIL, highway presets и runtime SUMO/CARLA вне scope. Если механика потребует внешнего движка/новой road topology, сначала актуализировать scope отдельным решением.

Перед правками перечитать актуальный код и задание. Новейший запрос пользователя имеет приоритет; при расхождении записать его. Незавершённые обязательные зависимости не допускают ready. Невыполненные обязательные проверки означают review, а не done.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0036-npc-traffic-liveness.md в CarWars. Прочитай AGENTS.md, docs/tasks/README.md и задание целиком. Проверь актуальность кода и зависимости, сохрани локальные изменения. Выполни изменения в указанной области, проведи перечисленные проверки, заполни отчёт и обнови статус задачи и INDEX.md. Не объявляй done при открытых критериях; запиши конкретное ограничение.
```

## 10. Отчёт исполнителя

- Результат: начат аудит и проверена базовая ливнес-регрессия. Попытка добавить edge-progress/bumper-aware braking и rear-clear reservations нарушила два существующих traffic-ai сценария; эти незавершённые правки сняты, текущая реализация оставлена в исходном состоянии. Без полного swept-path/recovery решения работу закрывать нельзя.
- Изменённые файлы и зачем: production-файлы не изменены; диагностический план и границы незакрытой работы зафиксированы в этом отчёте.
- Команды и фактические результаты: после снятия неудачного прототипа `node --test tests/traffic-ai.test.js` — 8/8 pass; изолированный `node --test tests/traffic-spawn.test.js` — 4/4 pass; полный `pnpm test -- --test-concurrency=1` — 103/103 pass. Параллельный прогон может нестабильно завершать worker тяжёлого spawn-файла. `pnpm build` — pass.
- Ручные проверки: не выполнялись.
- Выполненные критерии: регрессионный baseline возвращён; никакого скрытого выключения физики/телепортации не внесено.
- Непроверенное, блокеры и отклонения от плана: все требования liveness, swept return path, FIFO aging, keep-clear, физический взаимный разъезд и логический LOD остаются открытыми. Нужна отдельная итерация с deterministic trace tests перед внедрением AI-контрактов.
- Итоговый статус и дата: in-progress, 2026-10-06.

