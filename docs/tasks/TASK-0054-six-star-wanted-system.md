# TASK-0054: Шесть звёзд розыска с предупреждениями за нарушения

- Статус: ready
- Приоритет: high
- Создана: 2026-10-08
- Обновлена: 2026-10-08
- Проект: CarWars, C:\Users\gobes\OneDrive\Документы\CarWars
- Рекомендуемый исполнитель: сильная модель, высокий уровень рассуждения; детекторы нарушений, временная FSM, контакты общей физики и HUD.
- Зависимости: нет незавершённых обязательных зависимостей; использовать уже имеющийся police runtime TASK-0048, её остаточную браузерную приёмку не закрывать этой задачей. Выполнять последовательно с другими правками main.js/traffic.js/police-pursuit.js.

## 1. Цель и запрос пользователя

Запрос: «Добавить систему звёзд, их будет всего 6, изначально они все не заполнены и они начинают заполняться за противонарушения как в GTA: сначала мигают — предупреждение; если противонарушение повторяется, то загораются. Противонарушениями считаются проезд на большой скорости, проезд на красный, врезание в другие машины, врезание в копов».

На экране постоянно шесть звёзд. Первое нарушение включает мигание следующей звезды, повторное подтверждает её; следующий уровень тоже проходит предупреждение. Подтверждённый level0–6 используется полицией и будущим арестом TASK-0055. Сейчас wanted/HUD отсутствует, полиция преследует player сразу.

Ниже числовой баланс, правило повторения и связь с полицией — решения автора для самостоятельной реализации. Пользователь задал шесть звёзд, предупреждение и четыре вида нарушений, но не пороги/таймеры.

## 2. Проверенный контекст

Проверено по исходникам 2026-10-08, HEAD `e6be22d821788caaaa89eede4507819d44b32459`, main. Чужие локальные изменения: AGENTS.md, docs/knowledge/traffic-flow-2026-10-06.json и неотслеживаемая .agents/skills/find-skills/; сохранять и не коммитить. Three.js 0.180.0, cannon-es 0.20.0, Tweakpane 4.0.5; node:test, Vite 7.1.9.

| Файл / символ | Факт и точка интеграции |
| --- | --- |
| src/main.js: frame, getInput, reset, rebuildCity | Единственный FixedStepper вызывает traffic.stepWorld(input, STEP). После шага drainImpactEvents передаются деформации; hidden/loading пропускают симуляцию. |
| src/main.js: traffic.registerRole('police'), policeSpawnSpecs | До двух полицейских, controller преследует player без условия wanted. |
| src/traffic.js: states, stepWorld, simulationTime, registerRole | Реестр role/id/simulation.body, общий мир, один world.step. AI clock aiTime обновляется в updateControllers примерно каждые .1 с, reset обнуляет его. |
| src/police-pursuit.js: createPolicePursuit | pursue/intercept/ram/maintain-block/recover, onContact/reset/diagnostics; wanted отсутствует. |
| src/traffic-signals.js: createTrafficSignals.phase | nodeId/fromId/time → controlled/color; uncontrolled возвращает priority. |
| src/city-scene.js: signalApproaches; src/signal-layout.js: getStopLineLayout | Подходы: nodeId/fromId, forward/right, stopX/stopZ, stopLineLength; согласованы с гражданским planner и визуальными сигналами. |
| src/vehicle.js: recordImpact, drainImpactEvents | Damage events имеют otherBodyId, но порог >3 м/с, cooldown по клеткам .65 с и лимит32. Это не готовый поток всех нарушений. |
| index.html / src/style.css | Есть speedometer/settings/loading/touch-marker, звёзд нет. |
| tests/traffic-signals.test.js, tests/signal-layout.test.js, tests/police-pursuit.test.js | Регрессии фаз, геометрии и физического преследования. |

## 3. Область изменений

Новые src/wanted-system.js, src/traffic-violations.js и tests/wanted-system.test.js/tests/traffic-violations.test.js; допустим src/wanted-hud.js. Интеграция main.js/index.html/style.css, узкие совместимые hooks traffic.js/police-pursuit.js при необходимости. Wanted FSM не помещать в гражданский planner.

Сохранить общую физику, damage/deformation, NPC evasions, safe spawn, LOD, светофоры, road width, input и настройки. Не добавлять новые police units на звёзды: count0–2 остаётся независимым. Не реализовывать арест, штрафы, тюрьму, пеших офицеров, оружие, свидетелей или полную экономику GTA.

Новый запрос заменяет постоянное преследование TASK-0048: level0 → police idle без намеренного сближения/тарана, level≥1 → нынешняя policy. Дефолт idle автора — throttle0/brake1 для уже безопасно размещённых actors, без системы патрулирования. Тела/occupancy остаются физическими. Прежние статусы и остаточные проверки TASK-0048/0051 не менять.

## 4. Требуемое поведение

### 4.1. Wanted FSM и HUD

API-ориентир: чистый `createWantedSystem(config)` с `update(dt, violationEvents)`, `snapshot()`, `reset()`. Snapshot: level0–6, pendingStar(null либо level+1), warningRemaining, последний принятый тип. Равноценные имена допустимы; окончательный контракт записать для TASK-0055.

- Начало/reset: level0, pendingStar null, ровно шесть пустых звёзд. Заполненные слева направо; мигает только следующая; остальные пустые.
- Первое принятое событие начинает warning10с. Любое новое принятое нарушение, того же либо другого типа, внутри этого окна подтверждает одну звезду и завершает warning. Подтвердившее событие не запускает сразу warning следующего уровня.
- Следующее событие начинает warning следующей звезды. Без повторения pending истекает и возвращается в empty. На level6 все filled, мигания/седьмой звезды нет.
- Событие ровно на deadline сначала завершает истёкшее предупреждение и затем начинает новое; оно не подтверждает старую звезду. Неизвестные типы/невалидные события игнорировать, отрицательный или non-finite dt не продвигает FSM. Snapshot отдаёт копию, внешняя мутация не меняет level.
- В этой версии подтверждённый уровень автоматически не снижается; очистка через общий reset и будущий завершённый арест. Побег из незавершённого ареста не очищает звёзды.
- Одно физическое событие не считается повторным: максимум одно принятое событие на .5с игрового времени. В одном шаге объединять с приоритетом police-collision → civilian-collision → red-light → speeding; не создавать очередь отложенных штрафов. Дубликаты не продлевают deadline.
- Время FSM/дебаунса — действительно выполненные fixed ticks, без Date/performance.now/setTimeout. Hidden/loading паузы не расходуют warning. В free camera приостановить wanted timers и детекторы; на возврате синхронизировать историю позиций/контактов без ложных событий.
- HUD под speedometer слева, safe-area, без перекрытия settings/touch-marker; DOM/SVG/CSS без текстур, pointer-events:none. Empty/filled/pending различимы на390×844 и1440×900. Soft blink около1с; prefers-reduced-motion — постоянное отличающееся pending состояние. Доступная подпись «Розыск: N из 6», предупреждение отдельно; aria-live только на переходы.

### 4.2. Четыре детектора

Все пороги здесь — предложенные автором константы с единицами, без новых UI-твиков. Учёт нарушений глобальный, без свидетеля/видимости полиции.

**Speeding:** горизонтальная speed>80км/ч непрерывно1с → первое событие. При продолжающемся превышении отдельные события не чаще одного на5с. Speed≤75км/ч сбрасывает накопление/повтор;75–80 — hysteresis. Вращение на месте не speeding.

До первого speeding любое возвращение к speed≤80 прерывает секундное накопление. После активации диапазон75–80 сохраняет активный эпизод, но не выдаёт события: повтор разрешён только при фактическом speed>80 и прошедшем5с cooldown. Это исключает штраф за езду ниже порога при сохранённом hysteresis состоянии.

**Red-light:** передняя граница кузова пересекает стоп-плоскость регулируемого входящего подхода с отрицательной на положительную сторону и внутри его полосы. Использовать последовательные физические позы/сегмент пересечения, heading, длину кузова, forward/right и stopLineLength с допуском .3м. Не выбирать просто ближайший светофор. Проверять `phase(nodeId,fromId,traffic.simulationTime())` общего контроллера: только controlled && red. Yellow/green/priority, стоянка за линией, выезд с перекрёстка и соседняя полоса не штрафуют. Одно событие на crossing; rearm после возвращения перед этой линией минимум на2м. Быстрый проезд между samples не теряется. Начальная загрузка/reset позы за линией не считается пересечением.

**Civilian/police collision:** контакт основного кузова player с body зарегистрированного actor role civilian/police. Закрывающая скорость по нормали≥2м/с и вклад player в сближение по этой нормали≥1м/с. Брать скорости до решения столкновения, не после обнуления solver. Это ограниченное правило автора исключает накрутку от тарана неподвижного игрока копами. Статические дома/земля, оторванные колёса, NPC–NPC не считаются.

Все contact equations пары player/actor объединять в один эпизод. Новый штраф для пары разрешён после отсутствия контакта≥.5с и не раньше1.5с после прошлого. Длительное упирание, несколько точек и damage cells не дают повторных звёзд. Недостаточная скорость не превращает устойчивый контакт в новое событие каждый tick. Проверить знак нормали независимо при обоих порядках bi/bj.

Использовать actor registry/shared world; не сканировать scene на каждом контакте. Damage queue читать ровно один раз как сейчас, не отнимать у CarDeformation. Допустим отдельный наблюдатель контактов либо обход world.contacts после world.step со скоростями до шага. Очищать pair history при remove/reset/rebuild, обновлять bodyId→role lookup после spawn/remove. Collision hooks не меняют damage и гражданское бегство.

### 4.3. Полиция и lifecycle

Подтверждённый level передать в main role adapter либо явный вход controller. Warning при level0 не запускает chase/арест. При level≥1 текущая физическая policy сохраняется, без изменения шин/скорости/count/spawn. При выключении убрать устаревший throttle, при повторном включении очистить stale contact/recovery history; diagnostics явно показывает idle.

При policeCount0 HUD работает, chase не возникает. Reset/rebuildCity/factory reset очищают level/warning/детекторы/историю; localStorage сохраняет только прежние настройки. Загрузка/повторная загрузка модели и quality switch не дублируют слушатели/HUD.

## 5. План для исполнителя

1. Проверить runtime/позы/контакты/фазы и порядок world.step → damage drain. Использовать carLab.signalApproaches/stopLines/trafficClock/telemetry для диагностики.
2. Написать чистые FSM и detectors с сериализуемыми входами/выходами. События: type, actorId/approachId, игровое время и episode ID. DOM и Cannon ownership вне FSM.
3. В fixed tick собрать позы/скорости до шага, сделать существующий stepWorld один раз, затем детектировать события и обновить wanted. Использовать общий trafficSignals, без независимого signal timer.
4. Связать level с police role, добавить read-only carLab.wanted()/последние причины. Не добавлять игровой способ накрутки звёзд; fixtures вызывают чистый API.
5. Сделать HUD/reset/pause lifecycle; выполнить проверки и записать final API для TASK-0055.

## 6. Критерии готовности

- [ ] Ровно6 звёзд: empty → pending → filled при отдельном повторе, warning timeout, cap6 без переполнения.
- [ ] Все четыре нарушения воспроизводятся; контактные дубликаты и неподвижный player под тараном не накручивают level.
- [ ] Red определяется по своей stop-line/phase; green/yellow/priority и ложные crossings исключены.
- [ ] Speeding даёт повторные события с заданным интервалом; нормальная езда не штрафуется.
- [ ] Police idle при level0/chase при level≥1; count0/reset/rebuild/hidden/free camera работают определённо.
- [ ] Shared-world/damage/traffic/input сохранены; проверки выполнены, API/отчёт/INDEX обновлены.

## 7. Проверки

Из корня: `node --test tests/wanted-system.test.js tests/traffic-violations.test.js`, `node --test tests/police-pursuit.test.js tests/traffic-signals.test.js tests/signal-layout.test.js tests/car-damage.test.js tests/car-deformation.test.js`, `npm test`, `npm run build`. Ожидаются pass и сборка. При native V8 crash зафиксировать ошибку; допустим диагностический повтор `node --no-opt --no-maglev --test tests/wanted-system.test.js tests/traffic-violations.test.js`, без изменения production flags. Падающий suite не называть успешным.

Новые tests: FSM timeout/any-type repeat/one-event-one-transition/cap6/reset, время при30/60/120Гц; speeding hysteresis/повтор; red всех4 направлений, widths12/15/30, fast segment, wrong lane, reverse/outgoing, green/yellow/priority; collisions bi/bj, multi-contact, sustained/separation/re-hit, неподвижный player под тараном, NPC–NPC/ground/detached exclusions. Integration: один world.step, полный damage drain, idle/chase/count0, отсутствие stale lookup/listeners после remove/reset/rebuild.

Через `npm run dev`:1440×900 и390×844, low/high, keyboard/touch. Normal drive, speeding warning/repeat, red crossing, удары гражданского/полиции, mixed-type repeat, timeout10с, level6, hidden15с, free camera, R/reset/rebuild/quality/count0. Проверить HUD/reduced-motion/settings/touch и console/WebGL errors; сохранить trace/кадры в docs/art/verification/wanted/. Mobile viewport не выдавать за физический телефон. Недоступную проверку явно записать, не ставить done без обязательной приёмки.

## 8. Предположения, вопросы и условия остановки

Четыре типа,6 звёзд и warning перед подтверждением — требования пользователя. Любой новый тип подтверждает warning; каждая звезда тоже требует warning. Thresholds80/75,1/5/10с,.5с debounce,collision2/1м/с, idle при0 и отсутствие decay — баланс автора. Существенных открытых вопросов в этих границах нет.

Если police runtime исчез/стал несовместим либо светофоры изменились так, что описанная интеграция невозможна, записать причину и необходимое решение, не переписывать соседние подсистемы. Не закрывать прежние статусы автоматически. Недоступные проверки исключают done.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0054-six-star-wanted-system.md в CarWars. Прочитай AGENTS.md и задание целиком, проверь актуальность runtime/сигналов. Реализуй шесть звёзд с предупреждением, четыре детектора нарушений и связь подтверждённого уровня с полицией. Следуй отмеченным решениям автора. Проведи проверки, заполни отчёт/окончательный API и обнови статусы задачи и INDEX.md. Арест пока не реализуй. Коммить только свои изменения и отправь текущую ветку согласно AGENTS.md.
```

## 10. Отчёт исполнителя

- Результат: Не выполнялась.
- Изменённые файлы и зачем: —
- Команды и фактические результаты: —
- Ручные проверки: —
- Выполненные критерии: —
- Окончательный API wanted/reset/diagnostics для TASK-0055: —
- Непроверенное, блокеры и отклонения от плана: —
- Итоговый статус и дата: —
