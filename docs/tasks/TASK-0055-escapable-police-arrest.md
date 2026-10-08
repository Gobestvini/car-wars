# TASK-0055: Арест с таймером, анимацией и возможностью вырваться

- Статус: in-progress
- Приоритет: high
- Создана: 2026-10-08
- Обновлена: 2026-10-08
- Проект: CarWars, C:\Users\gobes\OneDrive\Документы\CarWars
- Рекомендуемый исполнитель: сильная модель, высокий уровень рассуждения; FSM удержания/побега, физическое окружение, HUD и reset.
- Зависимости: FSM/API TASK-0054 реализованы и отражены в отчёте, но задача0054 остаётся in-progress из-за неполной браузерной приёмки. Код ареста добавлен совместимо с её фактическим API; конечный статус этой задачи также остаётся in-progress до физического браузерного сценария.

## 1. Цель и запрос пользователя

Запрос: «Добавить систему ареста: когда копы остановили машину и находятся рядом с ней, начинается арест; на него нужно какое-то время, и будет визуальная анимация этого с таймером, но пока идёт этот таймер, игрок может вырваться из него».

При подтверждённом розыске остановка рядом с полицией запускает countdown. До окончания player полностью управляет автомобилем и может уехать: попытка отменяется, звёзды/chase сохраняются. Истечение времени даёт однократный результат «Арестован» и способ начать заново. Сейчас arrest/countdown отсутствуют.

Длительности, радиусы, анимация и экран завершения ниже — решения автора, пользователь точных значений/последствий не задал.

## 2. Проверенный контекст

Проверено по исходникам2026-10-08, HEAD `e6be22d821788caaaa89eede4507819d44b32459`, main. Чужие изменения: AGENTS.md, docs/knowledge/traffic-flow-2026-10-06.json, неотслеживаемая .agents/skills/find-skills/; сохранить, не коммитить. TASK-0054 ещё не реализована, её API обязательно сверить после зависимости. Стек: Three.js/cannon-es, fixed step1/120с, node:test/Vite.

| Файл / символ | Проверено / ожидаемая интеграция |
| --- | --- |
| src/police-pursuit.js: update/diagnostics | targetStoppedTime при speed<.5м/с; maintain-block после контакта, target-held после2с. AI label не доказывает фактическое удержание рядом. |
| src/police-pursuit.js: corridorBlocked | Коридор через static obstacles с padding; пригоден для исключения копа за домом. |
| src/traffic.js: states/stepWorld/role dispatch | Настоящие position/speed/simulation/body полиции, несколько actors в одном World, physicalOnly. |
| src/main.js: frame/reset/rebuildCity/getInput/setCameraMode | Fixed ticks, input и reset; free camera ставит brake1, может создавать ложную остановку. |
| src/main.js: carLab.police/telemetry | Read-only диагностика actors и player. |
| src/car-damage.js: damageState; src/vehicle.js: damage | damage1 означает destroyed; арест не должен давать второй результат вместо уничтожения. |
| src/wanted-system.js из TASK-0054 | Будущий level/reset; файл пока отсутствует, имена/API должны быть подтверждены после реализации. |
| index.html/src/style.css | HUD speedometer/settings/loading/touch-marker без countdown/result. |

## 3. Область изменений

Новые src/arrest-system.js/tests/arrest-system.test.js; допустим src/arrest-hud.js. Интеграция main.js/index.html/style.css, узкие совместимые изменения police-pursuit.js/traffic.js при необходимости. Переиспользовать wanted API, не дублировать нарушения.

Не добавлять пеших копов, выход из машины, тюрьму, штрафы, persistence, QTE/кнопку побега, новые textures/3D assets/постобработку. Сохранить физическое управление, civilian FSM, общий World/safe spawn/damage/settings. Анимация — лёгкий DOM/SVG progress с локальным soft pulse.

## 4. Требуемое поведение

### 4.1. Параметры и FSM

API-ориентир: `createArrestSystem(config)` с `update(dt,{wantedLevel,player,police,obstacles,enabled})`, `snapshot()`, `reset()`. Snapshot: state idle/holding/arresting/arrested, progress0–1, remainingSeconds, nearbyPoliceIds, причина прерывания. Completion event ровно один при переходе в arrested. Имена согласовать с final API0054.

Авторские дефолты: stoppedSpeed .5м/с, stoppedHold2с, startRadius6м между центрами XZ, breakSpeed1.5м/с, breakRadius8м, arrestDuration5с. Именованный конфиг с единицами, без новых UI-твиков.

Подходящий коп: существующий физический role police, targetId player, не removed/pending/logical, speed≤2м/с, прямой коридор без дома/static obstacle. Для старта distance≤6м, для активной попытки≤8м. Civilian/старый contact/AI label не заменяют настоящего копа.

### 4.2. Запуск, время и побег

- level≥1, player speed<.5м/с и хотя бы один подходящий коп≤6м непрерывно2с → holding → arresting. В holding показывать короткий индикатор удержания; основной countdown начинается после него и длится5с.
- Collision не обязателен: полиция могла остановить блокированием без удара. Maintain-block/target-held недостаточно — сверять позу/скорость/коридор.
- Один timer на player. Два копа не ускоряют/не дублируют FSM. Замена копа сохраняет progress лишь при непрерывных истинных условиях; потеря всех подходящих сбрасывает попытку.
- До completion keyboard/touch работают полностью. Не записывать velocity/position, не выключать collision и не вводить artificial brake в getInput. Копы удерживают через обычную физику. Допустима локальная low-speed hold коррекция controller, если он бесконечно выталкивает остановленного player; без новой физики или гарантированного удержания скриптом.
- В holding нарушение исходных условий сбрасывает2с счётчик. В arresting отменять немедленно при player speed≥1.5м/с, отсутствии подходящего копа≤8м, перекрытии коридора, снятии wanted или enabled=false. Между .5 и1.5 сохранять countdown (hysteresis против jitter). Нажатие газа само по себе не побег, нужно настоящее движение/потеря удержания.
- Отмена → progress0/remaining5; HUD скрыть или кратко «Вы вырвались», обычный chase продолжается, level сохраняется. Новый захват требует полных2+5с, старый progress не копится.
- Countdown считается выполненными fixed ticks; render может интерполировать, но не завершать. Hidden/loading пауза. Free camera отменяет незавершённую попытку и выключает новые; возврат follow требует нового полного hold.
- При damage≥1 отменить попытку, сохранить существующее destroyed поведение до reset. Приоритет одного tick: destruction/reset/escape проверить до deadline. Выезд в последнем tick отменяет арест, completion не выдаётся.
- policeCount0/удаление последнего подходящего actor/reset/rebuildCity/factory reset чистят попытку/references/HUD. Quality switch не сбрасывает/не дублирует. Non-finite/отрицательный dt не продвигает; нет target — нет stale timer.

### 4.3. Анимация и завершение

В arresting компактная плашка «Арест», progress и remainingSeconds с округлением вверх (допустимо .1с), подсказка «Уезжайте, чтобы вырваться». Предложение автора — нижний HUD над зоной жеста, pointer-events:none, без world-space кольца/постобработки. Не закрывать stars/speed/settings/touch-marker на390×844/1440×900. Soft pulse около1с, reduced-motion — статичный progress; aria-live сообщает переходы, не каждый кадр.

После пяти непрерывных секунд один раз arrested: «Арестован», кнопка «Начать заново». Только после completion отключить player drive input (throttle0/brake1), police intent idle/hold, чтобы не таранить экран результата. Не телепортировать кузов и не переписывать его скорость ради стоп-кадра. R и кнопка вызывают существующий общий reset: штатное восстановление машины/позиции/damage, очистка wanted/arrest/HUD, police idle по0054. Сам completion не запускает automatic restart. Дальнейшие ticks и settings/quality не дублируют/не закрывают результат случайно.

## 5. План для исполнителя

1. После done0054 сверить final API, фактический idle/chase gate/reset и актуальность контекста; перевести задачу в ready. Не интегрировать заглушку вместо зависимости.
2. Написать чистую FSM/fixtures; актуальные poses/speeds/role/targetId поступают снаружи. Проверка corridor — helper/инъекция предиката, а не ownership World внутри FSM.
3. Обновлять после единственного stepWorld и wanted update, с указанным приоритетом destruction/escape. Никаких setInterval/второго physics loop.
4. Подключить input gate только после completion, глобальную фазу police adapter, HUD/countdown/result/reset. Добавить read-only carLab.arrest() для trace. Listeners/hooks создаются один раз.
5. Проверить настоящее физическое удержание/выезд, регрессии и visual matrix; заполнить отчёт/INDEX.

## 6. Критерии готовности

- [ ] При level0, далёком/движущемся копе/копе за стеной и движущемся player арест не начинается.
- [ ] Подтверждённый level + остановка у копа →2с hold +5с countdown с анимацией/таймером.
- [ ] Реальный выезд до deadline отменяет попытку; звёзды/chase сохранены, повтор требует полного времени.
- [ ] Keyboard/touch доступны весь countdown, без velocity override/teleport/artificial brake.
- [ ] Two police не ускоряют FSM; lifecycle/pause/free camera/destruction соблюдены.
- [ ] Completion однократный; R/«Начать заново» очищает состояние и возвращает playable сцену.
- [ ] Проверки выполнены, реальный escape продемонстрирован, отчёт/INDEX обновлены.

## 7. Проверки

Из корня: `node --test tests/arrest-system.test.js tests/wanted-system.test.js tests/traffic-violations.test.js tests/police-pursuit.test.js`, `node --test tests/game-loop.test.js tests/vehicle.test.js tests/traffic-physics.test.js tests/traffic-liveness.test.js`, `npm test`, `npm run build`. Ожидаются pass/build; уже известные failures отделять от новых и документировать, не выдавать за pass.

Новые fixtures: level0/pending warning, speed/distance границы/hysteresis, police за стеной/другой target/moving; непрерывный2с hold/5с timer/разный dt, два копа/смена удерживающего, proximity/corridor loss, газ без фактического побега, успешный physical escape, progress reset/new attempt, completion once, escape в последнем tick, destroyed priority, pause/free camera/reset/rebuild/remove/count0. Интеграция: input не ограничен до completion, world.step один.

Через `npm run dev`:1440×900 и390×844, low/high, keyboard/touch. Получить звезду реальными нарушениями, дать копам остановить машину, увидеть countdown и выехать до нуля. Повторить удержание до completion/restart; проверить two police/count0/копа за домом/hidden15с/free camera/reset/rebuild/quality/destroyed. Если используется fixture, отделить его результат от обычной игры; один прямой вызов FSM не доказывает physical escape. Сохранить видео/trace в docs/art/verification/arrest/, проверить console/WebGL errors. Mobile viewport не физический телефон. Нет обязательной визуальной проверки — записать limitation, не ставить done.

## 8. Предположения, вопросы и условия остановки

Hold2с/timer5с/radius6–8м, экран результата с ручным restart и отсутствие пеших копов — выбор автора. Существенных нерешённых продуктовых вопросов в этих границах нет. Draft обусловлен невыполненной0054, а не необходимостью повторного согласования чисел.

После зависимости сверить контракт, при несовместимости актуализировать до выполнения. Если policy не позволяет выехать физически, собрать trace и исправлять только локальную hold policy в пределах задачи, не ослаблять physics/collision player. Новая архитектура/персонажи/экономика требуют отдельного решения. Прежние статусы/остаточную приёмку не закрывать автоматически.

## 9. Сообщение для передачи модели

```text
После завершения TASK-0054 выполни docs/tasks/TASK-0055-escapable-police-arrest.md в CarWars. Прочитай AGENTS.md, задание и отчёт зависимости; проверь актуальность API, затем обнови готовность задачи. Реализуй арест с анимацией/таймером и физической возможностью вырваться до completion. Проведи проверки, заполни отчёт и обнови статусы задачи и INDEX.md. При незавершённой зависимости не начинай реализацию. Коммить только свои изменения и отправь текущую ветку согласно AGENTS.md.
```

## 10. Отчёт исполнителя

- Результат: добавлена чистая FSM ареста, подключены проверка физической полиции/дистанции/скорости/коридора, countdown HUD и completion/restart.
- Изменённые файлы и зачем: `src/arrest-system.js` и `tests/arrest-system.test.js` — фиксированная FSM/escape; `src/main.js` — физические poses, occlusion, input gate только после completion, police idle после arrest, `carLab.arrest()`; `index.html`, `src/style.css` — прогресс, таймер, restart и reduced-motion pulse.
- Команды и фактические результаты: 5/5 FSM tests прошли; сопряжённые wanted/violations/police tests прошли; последняя полная серия `node --test` — 270/270 pass, Vite build прошёл.
- Ручные проверки: в браузере показан игровой HUD, одна speeding-звезда перешла в warning; countdown/escape/completion в физической сцене не были воспроизведены.
- Выполненные критерии: уровень≥1, неподвижный игрок, назначенная физическая полиция≤6м и чистый коридор нужны для2с hold; затем5с countdown; скорость≥1.5м/с/потеря полиции/коридора отменяет попытку; FSM unit tests проверяют физический escape входом и одноразовый completion.
- Непроверенное, блокеры и отклонения от плана: требуется подтвердить настоящий останов/побег полицейского в игре, finish/restart, destruction и camera pause, full 1440×900/390×844 matrix, touch/high/low и сохранить артефакт. Проверка FSM не заменяет демонстрацию реального физического escape.
- Итоговый статус и дата: in-progress, 2026-10-08.
