# TASK-0104: Играть за город: общий обзор и перетаскивание карточек

- Статус: draft
- Приоритет: high
- Создана: 2026-10-16
- Обновлена: 2026-10-16
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Сетевая интеграция, геометрия камеры/picking и устойчивый pointer lifecycle сложнее обычной локальной UI правки.
- Зависимости: TASK-0103 — требуется done

## 1. Цель и запрос пользователя

Включить существующую кнопку city и дать четвёртому игроку полноценный интерфейс режиссёра города: вся карта сверху,5 карт, drag/touch placement и server-owned120 с HUD. Трое гонщиков сохраняют привычную камеру и управление.

Исходный запрос: второй режим «за город», подключение к серверу с 3 гонщиками; за 2 минуты поймать игроков, размещать police перетаскиванием карточек, высокий обзор всей карты, полное перекрытие любого конца дороги и дополнительные подходящие способности. Конкретное правило «поймать всех 3 / один выжил — победа команды racers»,4 connections, costs/TTL/cooldowns и пять карт — решения автора для согласованного MVP.

Обязательный самостоятельный контекст: [дизайн режима](../knowledge/city-hunt-mode-design.md), [серверный ADR](../knowledge/multiplayer-server-adr.md), отчёт QA TASK-0096. Задание понятно без истории чата при наличии репозитория и этих документов.

## 2. Проверенный контекст

Проверено 2026-10-16, HEAD 3598b662375a613f822e011b46a8e92555a12a9c, main. Исследовано текущее рабочее дерево. Уже есть чужие staged/unstaged/untracked изменения, включая src/traffic.js, src/traffic-ai.js, src/city-boundary.js, package.json, AGENTS.md, инструменты задач и документы. Не откатывать и не включать их в свой коммит; перед реализацией повторить git status. Стек: Three.js 0.180.0, cannon-es 0.20.0, Vite 7.1.9; npm test/build/dev существуют.

| Файл / символ | Наблюдение в текущем коде | Зачем исполнителю |
| --- | --- | --- |
| src/start-screen.js / createStartScreen | City disabled, coming-soon | Включение реальной роли |
| src/main.js / startGame, PerspectiveCamera, newRound | Follow camera/fog и локальный игровой цикл | Режимы и presentation |
| src/arrest-system.js / createArrestSystem | Цель literal player, 2+5 с, damage 1 отменяет арест | Захват отдельного гонщика без иммунитета |
| src/traffic.js / createVehicleRuntime, registerRole, requestSpawn, cancelSpawn | Общий NPC runtime, singleton player | Спавн и мир с несколькими гонщиками |
| src/vehicle-spawn.js / findSafeSpawnPose | Exact/nearest-safe, pending | Ограниченное ожидание спавна |
| src/police-pursuit.js / createPolicePursuit | Физические steering/throttle controls | Цели полиции |
| src/traffic-signals.js / createTrafficSignals | Фазы вычисляются от времени | Временный all-red override |
| src/city-generator.js / createCityPlan, src/city-layout.js / containsCityPoint | Нерегулярная seed-based карта | IDs, граница, камера и размещение |
| src/vehicle.js / CarSimulation, STEP | 120 Hz, cannon, общий world | Серверная физика |
| tools/multiplayer-spike/server.js / DrivingSpikeRoom | maxClients 3, body на каждую сессию | Нельзя использовать как готовый сервер 3+1 |

Production server/ и src/network/ сейчас отсутствуют. Новые пути из раздела 3 — ожидаемый результат TASK-0097–0101 или данного этапа; они ещё не существуют. TASK-0096 blocked после QA, TASK-0097–0101 draft. Поэтому эта задача draft. После done зависимостей сверить фактические интерфейсы, файлы и команды, исправить устаревшие точки входа и только затем переводить в ready. Не обходить блокеры независимого QA прототипа.

## 3. Область изменений

src/start-screen.js/start-screen.css, src/main.js, src/style.css, index.html и multiplayer client после 0099; новые src/city-director-camera.js, city-card-ui.js, city-card-targeting.js, city-effect-visuals.js (или равноценные modules); tests/city-director-camera.test.js, city-card-input.test.js, city-mode-client.test.js, browser harness в tools/city-hunt/**. Карточки/маркеры выполнить HTML/CSS/SVG/существующими assets; новые raster art, переработка всей графики, новая UI framework и server rules не входят.

Сохранять offline/free-drive поведение и лимит трёх гонщиков, текущую физику, управление и визуальные defaults. Область задачи — конкретный этап второго режима. Равноценные новые имена файлов допускаются с синхронизацией документации, контрактов и следующих задач.

## 4. Требуемое поведение

Прочитать полный docs/knowledge/city-hunt-mode-design.md. UI использует actual protocol0102/0103, не локальную симуляцию матча.

1. Включить city action только для city-hunt rooms: create/join, роли city1/racer3, ready/loading/countdown/active/finished и ошибки role-full/version/offline. Existing city button убрать из coming-soon flow только после подключения настоящего backend. Invite соединяет с нужным mode, не увеличивает free-drive maxPlayers. Cancel/retry/leave/reconnect не создают второй loop/listeners.
2. Отдельная OrthographicCamera near top-down80°, initial fit всей нерегулярной карты/границы с 10% margin и учётом tray/HUD/height. far/near/fog/draw distance/LOD позволяют увидеть дальние участки; city-only miniature blur off. Zoom≤2×/bounded pan, «Весь город», refit resize/orientation. Racers follow/DPR/quality прежние; high camera city не включает all-NPC physics.
3. Панель 5 постоянных карт с ценой, cooldown, pending, active limit, energy/regen и server error. Карта по drag даёт ghost actual snap green/red и предупреждение/причину. Endpoint targeting не позиция случайной крыши: selectable overlay поверх домов, ray из clientRect в road data/surface; roadblock выбирает конец конкретной дороги, red intersection, intercept racer marker. Близкие 44px targets требуют chooser/zoom, не молчаливой другой дороги. Карта/drop UI не отправляет готовый collider/выдуманную стоимость.
4. Pointer capture, single send на pointerup; pointercancel/Escape/blur/off-map/leave/resize/orientation очищают unsent ghost. Touch drag не панорамирует карту тем же пальцем; ordinary tray scroll доступен. Клик/Enter на card затем click/Enter target — доступный fallback. Состояние accepted server command не отменяется удалением ghost. Network pending/result/timeout/reconnect отражает authority, не оптимистический фактический расход.
5. HUD:120 с по server deadline, captured0/3–3/3, separate active/captured/forfeit racer markers, energy/reserved/cooldowns, winner/reason/reconnect. В finished отключить cards и показать rematch readiness. Captured racer spectates, R/rejoin не revive. Все 4 клиента показывают telegraph1.5 с, active/expire effects и spike warning; события не повторяются после full state. City видит всех racers; карта разведки не нужна.
6. Портрет 390×844, desktop1440×900, DPR1/1.75,low/high; tray не скрывает selectable city area, текст/targets читаются. Full snapshot предоставляет реальные remaining times при возвращении вкладки, клиент не завершает матч локально. Сетевой browser branch не исполняет CANNON/AI.

## 5. План для исполнителя

1. Проверить accepted room/protocol/effect state после done0103; не использовать поля из старого spike как окончательный wire contract.
2. Подключить role-aware menu/room client и isolated city input; сохранить racer flow.
3. Реализовать camera fit/viewport area/picking/overlays и устойчивые target IDs.
4. Создать tray drag+fallback, server-result presentation и authoritative round HUD.
5. Пройти 4-context browser matrix, touch/cancel/reconnect/low-high и записать screenshots/real observations, передать ready-for-qa.

## 6. Критерии готовности

- [ ] Изменение coming-soon позволяет city подключиться четвёртой сессией; гонщики и free-drive работают как прежде.
- [ ] Весь фактический город виден при initial/fit на обоих viewport, все endpoint targets достижимы; fog/far/blur не скрывают дальний край.
- [ ] Drag/touch/fallback каждой из 5 карт делает ровно 1 разрешённый server action, cancel/offmap не делает ни одного.
- [ ] HUD/telegraph/expense/capture/spectate/reconnect/finished согласованы у 4 клиентов, без локального solver/AI и leaks.
- [ ] Обязательные проверки ниже выполнены; фактические результаты и ограничения записаны.
- [ ] Отчёт заполнен; исполнитель передал ready-for-qa и синхронизировал INDEX. done ставит только независимый QA.

## 7. Проверки

### Автоматические

npm test; npm run build; node --test tests/city-director-camera.test.js tests/city-card-input.test.js tests/city-mode-client.test.js. Проверить projection8 AABB corners в свободный viewport, aspect ratios390/844 и 1440/900, DPR1/1.75/panel offset, endpoint unprojection identity, duplicate pointerup, pointercancel, old async generation, authoritative energy rejected command. Добавить документированную команду tools/city-hunt browser harness с 4 isolated contexts; тест читает реальный server state/events, screenshots сами по себе не доказывают gameplay.

Рабочая директория — корень CarWars. При подготовке документа игровые тесты и сборка не запускались, код не менялся. Новые test files/runners — требования к реализации, сейчас их нет. Команды сервера сверить после done зависимостей: будущий npm run server:start сейчас не существует. Для финальной квитанции использовать актуальный tools/verify.js, если он остаётся применим; старые удалённые Telegram tools не восстанавливать.

### Ручные

Обязательно 4 browser contexts, один city и 3racers; actual server. В 1440×900 и 390×844 low/high показать whole city, zoom/fit, выбрать оба конца дорог укаждого края. Разместить каждую карту mouse/touch/fallback; cancel Escape, pointercancel, blur, rotate, drop над tray/вне canvas, rejected occupied target. Проверить racers joystick/follow, capture→spectate, server deadline после hidden tab, reconnectcity с pending, rematch10 циклов и console/WebGL errors. Физический touch-device проверить если доступен; viewport-only не выдавать за device test.

Независимый QA повторяет обязательные сценарии самостоятельно. Тесты, сборка, screenshot и реальное устройство — разные виды подтверждения. Недоступный обязательный сценарий блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Проверенные факты — раздел 2 и контекст дизайна. Предложения автора: city-hunt-v1, пять карт, экономика энергии, командные условия победы, grace 15 с, safety и TTL. Это исходный детерминированный MVP; баланс матчами не проверен. Использовать принятую мультиплеерную основу и описанный контракт, не выбирать весь стек заново.

Невыполненная зависимость не допускает ready. Если core/server/protocol после TASK-0097–0101 расходится с дизайном, записать расхождение и обновить задание до разработки. Изменения требований 120 с, 3+1 и серверной authority согласовать. Не уменьшать число гонщиков/NPC и не переводить всех NPC в физическую симуляцию из-за камеры города. Локальный fake backend не заменяет сервер. Публичный хостинг, аккаунты, монетизация, случайная колода и туман войны не входят.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0104-city-director-camera-and-card-ui.md в CarWars. Прочитай AGENTS.md, задание целиком, docs/knowledge/city-hunt-mode-design.md и актуальный multiplayer ADR. Задача draft: проверь done зависимостей, сверь реальные core/room/protocol и обнови контекст; только после этого переведи ready. Реализуй указанный этап, сохрани offline/free-drive, выполни автоматические и обязательные ручные проверки, заполни раздел 10. После разработки передай ready-for-qa и синхронизируй INDEX; done ставит независимый QA с собственным разделом 11. Недоступные обязательные проверки укажи как блокер. Не откатывай и не коммить чужие изменения; соблюдай исключения AGENTS.md для CLI-вызовов.
```

## 10. Отчёт исполнителя

- Результат: Не выполнялась.
- Изменённые файлы и зачем: —
- Команды и фактические результаты: —
- Ручные проверки: —
- Выполненные критерии: —
- Непроверенное, блокеры и отклонения от плана: —
- Итоговый статус и дата: —

## 11. Отчёт QA

Не проводилась.

## Рекомендация модели исполнителя

Предпочтительно **gpt-6.1-sol, high**. Сетевая интеграция, геометрия камеры/picking и устойчивый pointer lifecycle сложнее обычной локальной UI правки. Это качественная оценка по доступному списку моделей и сложности, без утверждений о точных тарифах. Возможностей модели достаточно при готовой мультиплеерной основе, явном контракте и перечисленных проверках.
