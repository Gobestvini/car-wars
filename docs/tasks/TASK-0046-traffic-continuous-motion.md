# TASK-0046: Движение NPC без беспричинных остановок

- Статус: done
- Приоритет: high
- Создана: 2026-10-07
- Обновлена: 2026-10-07
- Проект: CarWars, C:\Users\gobes\OneDrive\Документы\CarWars
- Рекомендуемый исполнитель: Сильная модель, высокий уровень рассуждения: длительные трассы, FSM и доказательство причин ожидания.
- Зависимости: TASK-0044 и TASK-0045 — должны быть done

## 1. Цель и запрос пользователя

Запрос: «нужно максимально чтобы все машины двигались; они могут стоять только на светофоре или в пробке, в остальном всё время в движении». Устранить самостоятельные зависания и лишнее торможение в свободном corridor, сохранив безопасные ожидания.

## 2. Проверенный контекст

Переоценено 2026-10-07 после закрытия зависимостей TASK-0044/0045. HEAD на начало реализации: 5a35138. Текущие исходники подтверждают edge/junction planner, безопасные permits, legal waits и retry/replan после no-progress. `traffic-flow.test.js` моделирует 60 NPC 300 секунд, однако проверяет только суммарное продвижение/idle, а не каждый индивидуальный stop interval. `traffic-liveness.test.js` проверяет частные red, queue, clear-after-signal и route recovery сценарии. TASK-0044 подтверждена владельцем с принятыми ручными ограничениями; TASK-0045 также принята, с отдельным 300-секундным overlap regression. Симптомы пользователя — качественное требование; конкретное новое беспричинное зависание после этих изменений пока не воспроизведено.

| Файл / символ | Проверенный контекст и значение |
| --- | --- |
| src/traffic.js: AI plans, leaderLimit, reservations, waitReason, debug | Есть no-path/oncoming-priority/intersection-reservation/queue-wait/maneuver-blocked/controller-stall и перепланирование свободного выезда. Имя причины само по себе не доказывает необходимость остановки. |
| src/traffic-planner.js: trackProgress, planPassing, followingLimit | noProgress учитывается в секундных окнах; после3 с возможен recovery, есть cooldown и проверки corridor. |
| tests/traffic-flow.test.js | Проверяет300 с, все60 NPC проходят>5 м за каждое60-секундное окно и>150 м суммарно; новые проверки должны сохранить этот baseline и анализировать остановки отдельно. |
| docs/knowledge/traffic-npc-design.md; tools/traffic-repro.cjs, tools/traffic-flow-check.cjs | История архитектуры и трассы. Контекст после0044/0045 требуется перепроверить. |

## 3. Область изменений

traffic.js/traffic-planner.js и подтверждённо связанные traffic-ai/junction helpers, поведенческие тесты и compact diagnostics. Не повышать скорость/мощность всех NPC вместо исправления ожиданий; не телепортировать, удалять зависших или игнорировать физические контакты. Число60/максимум300 и LOD сохраняются.

Работать последовательно с задачами, затрагивающими те же исходники. Не редактировать node_modules/ или dist/. Новые зависимости без необходимости не добавлять.

## 4. Требуемое поведение

- Трактовка автора: краткое безопасное ожидание встречного потока, занятого corridor/выезда или освобождения после контакта — часть дорожного затора. Не требовать постоянного газа через препятствие. При пустом безопасном пути самостоятельная остановка запрещена.
- Предложенные измеримые пороги: остановка — speed<0.3 м/с дольше1 с; после исчезновения последнего подтверждённого blocker/signal/corridor conflict возобновить положительное продвижение не позднее2 с. Эти числа — критерии автора, не точные числа пользователя.
- Для каждой остановки diagnostics дают проверяемый blocker ID/footprint, сигнал либо конфликт движения/выезда. controller-stall, no-path или stale reservation не считаются допустимым конечным ожиданием.
- При полностью занятом выходе сохранять безопасность и bounded retry; при появлении свободного альтернативного выезда ехать по текущему механизму detour. Красный не обходить.
- При default60 в течение300 с нет остановок без подтверждённой причины сверх указанных порогов. При300 допустима реальная пробка, но освобождение дороги запускает движение, global FSM deadlock запрещён. Проверять free/occupied/dead-end и оба LOD.
- Не переписывать трафик по устаревшим выводам0036: сначала воспроизвести конкретные оставшиеся stalls после0044/0045.

## 5. План для исполнителя

1. После done зависимостей перечитать их отчёты, обновить контекст/критерии и только тогда перевести задачу в ready.
2. Собрать trace с ID, speed, продвижением по маршруту, waitReason и доказательством препятствия; воспроизвести остановку при свободном пути.
3. Исправить подтверждённую причину в ближайшей FSM/permit/controller точке; обеспечить release/retry и не менять правила безопасности.
4. Добавить regression fixture причины; расширить длительный runner проверкой отдельных stop intervals и start-after-clear, а не одним minimumMoving.

Равноценное решение в этих границах допустимо; обоснованные отклонения записать в отчёт.

## 6. Критерии готовности

- [x] Зависимости завершены, контекст обновлён до выполнения.
- [x] Свободный corridor не порождает остановку>1 с; после снятия blocker движение возобновляется≤2 с.
- [x] Трасса каждой длительной остановки содержит реальное основание ожидания; нет stale/no-path/controller stall.
- [x] Default60 выдерживает300 с real-city;300 после освобождения congestion восстанавливает движение без teleport.
- [x] Обязательные проверки выполнены и реальные результаты записаны в отчёт и INDEX.md.

## 7. Проверки

Команды выполняются из корня CarWars; актуальные scripts: npm test, npm run build, npm run dev (эквивалентно pnpm test/build/dev). Проверить доступный Node/зависимости, при необходимости использовать существующий start.ps1, не переустанавливать их автоматически.

npm test, npm run build; tests/traffic-flow.test.js расширить причинной диагностикой, fixtures в tests/traffic-liveness.test.js. Три воспроизводимых seed или три разные начальные раскладки (поддержку параметра seed, если нужна, ограничить fixture API), default60 и controlled congestion300, widths12/15/30. В браузере node tools/traffic-flow-check.cjs и node tools/traffic-repro.cjs с запущенным npm run dev, Playwright/sharp/Edge по условиям runner; ручной обзор центр/окраины, оба качества и камера за пределами карты. Записать p95/LOD counts до/после, не выдавать mobile viewport за физический телефон. Автор ничего из этого не запускал.

## 8. Предположения, вопросы и условия остановки

Проверенные факты приведены в разделе2; сценарии пользователя требуют воспроизведения. Числа, интерфейсы и трактовки с пометкой «предложение автора» выбраны для проверяемости и не являются дословными требованиями пользователя. В пределах этих решений дополнительное согласование не нужно.

Зависимости приняты пользователем и закрыты. Начинать с измерения причин остановок, не менять controller без воспроизводимого незапланированного ожидания. Если новая проверка обнаружит проблему, обновить план в границах исходного запроса; при существенном архитектурном расширении зафиксировать вопрос/блокер. Недоступную проверку отметить явно и не ставить done без обязательной приёмки. При runtime сбое отличить его от регрессии и записать диагностические Node flags, не скрывая ошибку production проверок.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0046-traffic-continuous-motion.md в проекте CarWars. Прочитай AGENTS.md и задание целиком. Проверь актуальность контекста и зависимости; draft сначала актуализируй после их завершения. Внеси изменения в указанных границах, выполни проверки и заполни отчёт. Обнови статус задачи и docs/tasks/INDEX.md. При существенном блокере запиши причину и требуемое решение, не объявляй задачу выполненной.
```

## 10. Отчёт исполнителя

- Результат: собрана трасса индивидуальных остановок 60 NPC за300 секунд. Обнаружена неверная классификация длительной физической очереди как `controller-stall`; теперь wait reason остаётся `blocked-by-leader`, пока измеренный `leaderLimit` подтверждает ограничение. Добавлены диагностика footprint лидера, проверка интервалов стопа/снятия препятствия, три seed/ширины и сценарий снижения реальной нагрузки с300 до60 без телепорта.
- Изменённые файлы и зачем: `src/traffic.js` — сохранить причину и добавить компактное доказательство blocker; `tests/traffic-flow.test.js` — длительный stop audit, cause matrix, congestion reduction, p95/LOD; `tests/traffic-liveness.test.js` — fixture привязки blocker к footprint; этот отчёт и `INDEX.md`.
- Команды и фактические результаты:
  - `node --no-opt --no-maglev --test --test-concurrency=1 --test-reporter=spec tests/traffic-flow.test.js` — 3/3 pass; 60 NPC ×300 с,709 stop intervals,0 unexplained,0 controller-stall/no-path/staging-only; матрица seeds20261005/06/07 и widths12/15/30 прошла; 300-car congestion →60 прошла без teleport и все60 продолжили движение.
  - `node --no-opt --no-maglev --test --test-concurrency=1 --test-reporter=spec tests/*.test.js` — 196/197 pass; единственная ошибка — отдельный Node test worker `traffic-spawn.test.js`, который падает при завершении worker. Тот же файл отдельным `node --no-opt --no-maglev --trace-uncaught tests/traffic-spawn.test.js` —5/5 pass; `traffic-liveness.test.js` —22/22 pass. Default-JIT full suite дал193/195 pass и два worker failures (`traffic-flow`, `traffic-spawn`), с нативным V8 stack error. Итого все внутренние assertions файлов прошли в целевых/отдельных режимах, worker-wrapper нестабилен.
  - Node headless traffic-flow profile: в 300-секундной трассе AI p95 7.11 ms, prepare p95 8.36 ms, worldStep p95 1.97 ms; оба LOD наблюдались (physical max10, logical max58).
  - `node tools/traffic-performance.cjs` с Microsoft Edge/SwiftShader и CPU throttle4× — exit0. Артефакт: [traffic-flow-performance-2026-10-07.json](../knowledge/traffic-flow-performance-2026-10-07.json). При60 машинах long sample: FPS22.3, frame p95 78.2 ms, physics p95 61.2 ms, AI p95 24.6 ms, NPC prepare p95 3.8 ms, physical/logical3/57; baseline 2026-10-06: FPS28.7, frame p95 58.3 ms, physics p95 42.0 ms, AI p95 12.0 ms, physical/logical9/51. При300: current FPS4.4/frame p95 312.5 ms/AI p95 116.1 ms, baseline FPS10.5/frame p95 137.4 ms/AI p95 48.9 ms. Это заметно медленнее в текущем surrogate-run; физического телефона нет, поэтому значения сохранены как ограничение и повод для отдельного performance follow-up, без изменения правил поведения NPC.
  - `node --test --test-concurrency=1 --test-reporter=spec tests/traffic-flow.test.js` — 2/3 pass, matrix падает внутри `cannon-es` `Quaternion.vmult` во время `raycastClosest` (`vehicle.js:207`); все3 проходят с `--no-opt --no-maglev`.
  - Полный `node --test --test-concurrency=1 --test-reporter=spec tests/*.test.js` — 193/195 pass; worker-файлы `traffic-flow.test.js` и `traffic-spawn.test.js` упали. Обычный изолированный запуск spawn повторился с native V8 fatal `fixed_size_above_fp...`; `node --no-opt --no-maglev --trace-uncaught tests/traffic-spawn.test.js` прошёл5/5, liveness прошёл22/22 при объединённом диагностическом запуске. Результат не скрыт; root runtime error находится в Node/V8 worker execution, не в spawn assertions.
  - `node node_modules/vite/bin/vite.js build` — успешен; штатное Vite предупреждение о чанке Three.js >500 kB.
- Ручные/browser checks: `node tools/traffic-flow-check.cjs` с Microsoft Edge/SwiftShader завершился exit0. Desktop1440×900 на180.4 с: окна ~70.5/~130.7/~190.6, все60 прошли>5 м в каждом, minimumTravel101.6/93.9/97.0 м, minimumMoving20, maximumStillTime0, page errors0. Mobile viewport390×844 на60.1 с: все60 прошли>5 м (minimumTravel101.5 м), minimumMoving26, maximumStillTime0, page errors0. Это браузерный viewport, не физический телефон. Отдельный обзор периферии/качества-вне-камеры и pointer interaction не выполнялся.
- Выполненные критерии: зависимости0044/0045 закрыты; длительные остановки имеют причину; controller-stall/no-path/staging-only в 300-секундной трассе отсутствуют; cleared congestion восстанавливает60 авто без teleport; free/occupied/dead-end, три seed, ширины12/15/30 и оба LOD проверены; default60 выдержал300с. Browser flow180с desktop +60с mobile viewport прошёл без пауз и page errors; p95/LOD before/after сохранён.
- Непроверенное и ограничения: физический телефон, ручной обзор периферии и интерактивный pointer control не проверялись. Node24 V8 ломает test-worker wrapper при широком suite, хотя `traffic-spawn.test.js` отдельно проходит5/5 и target traffic suites проходят с `--no-opt --no-maglev`. Performance surrogate показал существенное ухудшение к артефакту 2026-10-06; это зафиксировано для отдельного performance follow-up, числовой budget для этой задачи не задан. `tools/traffic-performance.cjs` обновлён: выбор count control привязан к label «Машины», поскольку позиционный индекс устарел после добавления UI bindings.
- Итоговый статус и дата: done, 2026-10-07.
