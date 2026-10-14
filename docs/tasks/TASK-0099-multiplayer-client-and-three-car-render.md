# TASK-0099: Подключить онлайн-режим и отображение трёх игроков

- Статус: draft
- Приоритет: high
- Создана: 2026-10-14
- Обновлена: 2026-10-14
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Интеграция крупного main.js, модели и lifecycle: gpt-6.1-sol, high.
- Зависимости: TASK-0097 — требуется done; TASK-0098 — требуется done

## 1. Цель и запрос пользователя

Дать пользователю создать общую карту, подключить ещё двух игроков по ссылке/коду и ездить с общими NPC. Сейчас стартовый экран запускает только локальную игру.

Исходный запрос: «внедрение мультиплеера … на карте … 3 игрока … физику … на сервер … логику AI машин тоже … хороший движок для гейм сервера». Этот файл подготовлен как задание; описанные изменения ещё не выполнялись. Конкретные gameplay rules, budgets и стек — предложения автора из [плана](../knowledge/multiplayer-server-plan.md), обязательного контекста данного задания.

## 2. Проверенный контекст

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

## 3. Область изменений

src/network/room-client.js, src/network/actor-presenter.js, src/main.js, src/start-screen.js, src/start-screen.css, src/style.css, index.html, src/vehicle-visuals.js и существующие effects adapters, tests/multiplayer-client.test.js и browser harness. Не менять серверные правила под предпочтения клиента; оптимизацию latency выполнитьTASK-0100.

Сохранить offline single-player, visual defaults и текущие модели/управление; не трогать game-template и соседние оптимизационные задачи. Возможные равноценные имена файлов допускаются с обновлением документации и зависимых заданий, без расширения поведения.

## 4. Требуемое поведение

Добавить понятные действия «Одиночная игра», «Создать комнату», «Присоединиться» и копирование invite link/code, occupancy1/3–3/3. Состояния idle/connecting/map-loading/playing/reconnecting/full/version-error/offline-error/leaving с cancel/retry; сообщения на языке текущего UI. При full не пересаживать в другую комнату молча. URL server задаётся env/config, reconnect secret не включать в публичную invite ссылку.

Online main не запускает CarSimulation solver, traffic.prepare/stepWorld, wanted/arrest/repair или AI и не newRound локально. Рендер города создаётся по серверному seed/config/signature без local world, actor presenter создаёт модель на entityId/generation. Все три игрока имеют раздельные transforms/wheels/damage/deformation/appearance и различимые метки/цвета; камера/скорость/wanted/arrest принадлежат local player. NPC/полицейские, оторванные колёса, dynamic props и pickups отображаются по authoritative DTO, effects не меняют world.

Keyboard/джойстик создают согласованный input, local heading/speed из state для directionalInput. На blur/hidden/cancel отправить neutral; сервер продолжает работать, возвращение восстанавливает state. Настройки online только visual/camera; power/grip/roadWidth/traffic/police server-owned выключены с объяснением. R/restart — серверный personal respawn, создание новой карты только новая комната. Free camera не останавливает мир, ввод neutral.

Применять full state позднего join/reconnect без повторного воспроизведения всех исторических взрывов; durable destroyed props/колёса восстановлены. Cleanup leave/retry освобождает meshes/pools/events/network listeners и не дублирует loop. Offline workflow не требует работающего game server.

## 5. План для исполнителя

1. После done0097/0098 проверить snapshot DTO и actual presenter API, обновить контекст и ready.
2. Добавить connection controller с cancellation/generation guard и start screen flows.
3. Выделить online presentation branch; offline оставить на core adapter, online authority не запускать.
4. Подключить player/NPC models, effects, per-player HUD, input и respawn command.
5. Пройти три браузера/desktop-mobile-viewports, ошибки join и 10 leave/rejoin; записать browser артефакт.

## 6. Критерии готовности

- [ ] Три браузера видят одну карту, всех игроков/NPC/светофоры и независимое управление; четвёртый видит full.
- [ ] Столкновение игроков/AI, повреждение, repair, props destruction, розыск и арест синхронны по server tick/state.
- [ ] Online не выполняет physics/AI, R одного игрока не меняет карту/остальных; blur не останавливает сервер.
- [ ] UI cancel/error/retry/reconnect работает; offline запускается без сервера, lifecycle не копит машины/listeners.
- [ ] Обязательные проверки ниже выполнены и записаны фактически; ограничения и невыполненные пункты перечислены.
- [ ] Отчёт заполнен; после разработки статус ready-for-qa и INDEX синхронизированы. done разрешён только независимому QA.

## 7. Проверки

### Автоматические

Рабочая директория — корень CarWars, кроме явно указанного prefix.

npm test и npm run build; node --test tests/multiplayer-client.test.js. Добавить проверку online branch без solver/AI ticks и input lifecycle, DTO-to-actor isolation, duplicates eventId. Browser harness три isolated contexts должен сравнивать server snapshot/tick и map signatures, а не только screenshots; точную команду записать в отчёт/README.

Во время подготовки тесты приложения не запускались: код не менялся. Новые commands/files выше являются требованиями к исполнителю, не утверждением об их существовании сейчас. Для существующих suite failures отделить baseline failures от регрессии, не исправлять соседние проблемы без необходимости. npm/pnpm доступны; не переустанавливать зависимости без причины.

### Ручные

Обязательно 3 браузерных контекста, минимум2 независимых устройств/браузеров для LAN smoke, один390×844 с джойстиком. Создать/поделиться/подключить, совместная езда, удар player-player, гонка repair, разрушенные props до late join, индивидуальные арест/respawn, fourth full, menu/free camera/hidden tab, reconnect и10 leave/join циклов. Low/high визуально сохранить.

QA повторяет обязательные сценарии независимо; артефакт исполнителя помогает воспроизводимости, не заменяет приёмку. Недоступная обязательная проверка явно блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Факты baseline — раздел2. Авторские решения — общий план: 1–3 игрока, max seat3, shared civilian/police world, personal wanted/respawn, shared pickups/props, no online browser solver, server120Hz. Будущий ADR может уточнить измеренные budgets/DTO; значимое изменение authority/физики или game rules согласовать и обновить зависимые задачи.

Предположение: MVP без аккаунтов и persistence, LAN/self-host сначала; публичный deploy и выбор платного сервера не входят. Домены/credentials не нужны для подготовки локального комплекта. При отсутствии done зависимости/ADR оставить draft или blocked с причиной; не начинать реализацию на недоказанном интерфейсе. Конфликт с актуальными чужими правками, несовместимость server physics или невозможный performance/latency budget требует конкретного воспроизведения/вариантов решения, а не молчаливого обхода. Не снижать NPC count и не удалять gameplay для фиктивного pass.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0099-multiplayer-client-and-three-car-render.md в CarWars. Прочитай AGENTS.md, задание целиком и docs/knowledge/multiplayer-server-plan.md; после TASK-0096 также принятый ADR. Проверь актуальный код, локальные изменения и done зависимостей. Для draft сначала сверить результат зависимостей и перевести задачу в ready. Внеси изменения только в указанных границах, проведи автоматические и обязательные ручные проверки и заполни отчёт. Передай ready-for-qa, синхронизируй INDEX.md; done ставит независимый QA. При блокере запиши воспроизведение и необходимое решение. Не включай чужие изменения в commit/push; учитывай исключения AGENTS.md для CLI executor/QA.
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

Предпочтительно **gpt-6.1-sol, high**. Интеграция крупного main.js, модели и lifecycle: gpt-6.1-sol, high. Это качественная оценка соотношения затрат и качества по доступному списку моделей и риску задачи, без утверждений о точных тарифах. Для этой серверной серии экономичная модель без запаса на архитектуру и проверки не рекомендуется.
