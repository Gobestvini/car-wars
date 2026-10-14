# TASK-0096: Проверить серверную архитектуру мультиплеера на трёх игроков

- Статус: ready
- Приоритет: high
- Создана: 2026-10-14
- Обновлена: 2026-10-14
- Проект: CarWars; C:\Users\gobes\OneDrive\Документы\CarWars; github.com/Gobestvini/car-wars
- Рекомендуемый исполнитель: gpt-6.1-sol, high; Архитектурный риск, реальная серверная физика, сравнение стеков и интерпретация измерений требуют gpt-6.1-sol с high.
- Зависимости: нет

## 1. Цель и запрос пользователя

Выбрать и доказать выполнимость архитектуры до переноса production-кода. Пользователь просит мультиплеер до трёх игроков, серверную физику и AI и изучение готового игрового сервера. Результат: ADR, запускаемый изолированный spike и измерения; игровая реализация остаётся прежней.

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

Разрешены docs/knowledge/multiplayer-server-adr.md, tools/multiplayer-spike/**, tests/multiplayer-spike*.test.js и артефакты docs/knowledge/multiplayer/**. Зависимости прототипа изолировать в его package.json/lockfile, не менять production src/** и корневые dependencies. Допустимо импортировать текущую чистую физику и data-only map. Не строить альтернативные полные игры на нескольких движках.

Сохранить offline single-player, visual defaults и текущие модели/управление; не трогать game-template и соседние оптимизационные задачи. Возможные равноценные имена файлов допускаются с обновлением документации и зависимых заданий, без расширения поведения.

## 4. Требуемое поведение

Предварительный выбор Node.js + Colyseus + cannon-es проверить, а не объявить доказанным. Сравнить Colyseus, Nakama, geckos.io и raw WebSocket по переносу существующего ESM-кода, lifecycle, протоколу, транспорту, лицензии, поддержке self-host и цене интеграции. Проверить официальную документацию и реальные совместимые package версии; выводы автора отделить от результатов эксперимента.

Прототип запускает в Node без DOM/WebGL общий cannon world с тремя CarSimulation, реальными коллизиями городской карты и репрезентативным AI. Не использовать пустую плоскость/три куба как доказательство переноса города или нагрузки 102 NPC. Если текущий traffic runtime мешает, выделить временный data-only harness внутри spike с реальными planner/controller и задокументировать, какие production пути ещё не доказаны. Это основание ограничить вывод, а не выдавать toy benchmark за performance игры.

Два-три SDK-клиента получают snapshots, отправляют ввод; 4-й join отвергается. Проверить запуск выбранного server/SDK/Schema без несовместимых major versions. Зафиксировать wire DTO/частоты/ack/limits, полный поздний join, reconnect grace и сериализацию map signature. Измерить варианты 120 Hz physics +20 Hz snapshots, scheduler60/AI10, 3+102 NPC и стресс300; сравнить baseline offline cost. Измерить RTT0/50/100/150 мс, jitter20 мс, потерю1% через реальный прокси, а не выкидывание сообщений из TCP как аналог сетевых потерь. Указать, где были headless measurements, где живой браузер.

ADR фиксирует решение go/no-go, server capacity, число полиции/global cap согласно existing intensity, необходимость interest management/worker, версия транспорта и схемы, единый snapshot contract и latency strategy без online browser solver. Если budgets плана не достигнуты, требуется воспроизводимый blocker/варианты и draft зависимых задач. Не переписывать physics engine для обхода проваленного измерения без отдельного решения.

## 5. План для исполнителя

1. Сверить исходники из раздела 2 и снять baseline одного мира: world.step только один на substep.
2. Составить короткую сравнительную таблицу со ссылками на первичные источники; выбрать минимальный spike основного кандидата.
3. Создать изолированный harness с repeatable seed, scripted controls, map colliders и метриками simulation/network/GC/debt.
4. Проверить capacity/reconnect/invalid input и измерить latency и server costs. Сохранить сырые JSON и инструкции запуска.
5. Оформить ADR со всеми обязательными решениями плана. Сверить downstream задачи и обновить их контекст; оставить draft до независимого QA этого этапа.

## 6. Критерии готовности

- [ ] ADR содержит сравнение минимум четырёх вариантов, реальные версии/лицензии и обоснованный go/no-go.
- [ ] Node-прототип запускается без browser globals; три машины и map collisions работают, четвёртая сессия отказана.
- [ ] Измерены реальные simulation/serialization/wire costs и input-to-response; непокрытые production пути названы.
- [ ] Определены DTO, global police cap, timing, recovery, latency strategy и воспроизводимый способ следующих проверок.
- [ ] Обязательные проверки ниже выполнены и записаны фактически; ограничения и невыполненные пункты перечислены.
- [ ] Отчёт заполнен; после разработки статус ready-for-qa и INDEX синхронизированы. done разрешён только независимому QA.

## 7. Проверки

### Автоматические

Рабочая директория — корень CarWars, кроме явно указанного prefix.

Из корня: npm test и npm run build для регрессий, результаты не приписывать прототипу. Добавить в изолированный package.json spike scripts test и benchmark, выполнить npm --prefix tools/multiplayer-spike test и npm --prefix tools/multiplayer-spike run benchmark; записать seed/hardware/config/длительность. Эти новые команды требуется реализовать в данной задаче.

Во время подготовки тесты приложения не запускались: код не менялся. Новые commands/files выше являются требованиями к исполнителю, не утверждением об их существовании сейчас. Для существующих suite failures отделить baseline failures от регрессии, не исправлять соседние проблемы без необходимости. npm/pnpm доступны; не переустанавливать зависимости без причины.

### Ручные

Обязательно: три реальных SDK-клиента, из них минимум один браузер, одновременно управляют разными машинами; full-room error четвёртому. Наблюдать столкновение и стабильный map signature; latency capture в браузере на RTT100 мс. Если harness не интегрирован с визуальной игрой, это явно записать; полноценная поездка будет проверяться в0099/0100.

QA повторяет обязательные сценарии независимо; артефакт исполнителя помогает воспроизводимости, не заменяет приёмку. Недоступная обязательная проверка явно блокирует приёмку.

## 8. Предположения, вопросы и условия остановки

Факты baseline — раздел2. Авторские решения — общий план: 1–3 игрока, max seat3, shared civilian/police world, personal wanted/respawn, shared pickups/props, no online browser solver, server120Hz. Будущий ADR может уточнить измеренные budgets/DTO; значимое изменение authority/физики или game rules согласовать и обновить зависимые задачи.

Предположение: MVP без аккаунтов и persistence, LAN/self-host сначала; публичный deploy и выбор платного сервера не входят. Домены/credentials не нужны для подготовки локального комплекта. При отсутствии done зависимости/ADR оставить draft или blocked с причиной; не начинать реализацию на недоказанном интерфейсе. Конфликт с актуальными чужими правками, несовместимость server physics или невозможный performance/latency budget требует конкретного воспроизведения/вариантов решения, а не молчаливого обхода. Не снижать NPC count и не удалять gameplay для фиктивного pass.

## 9. Сообщение для передачи модели

```text
Выполни docs/tasks/TASK-0096-multiplayer-architecture-spike.md в CarWars. Прочитай AGENTS.md, задание целиком и docs/knowledge/multiplayer-server-plan.md; после TASK-0096 также принятый ADR. Проверь актуальный код, локальные изменения и done зависимостей. Для draft сначала сверить результат зависимостей и перевести задачу в ready. Внеси изменения только в указанных границах, проведи автоматические и обязательные ручные проверки и заполни отчёт. Передай ready-for-qa, синхронизируй INDEX.md; done ставит независимый QA. При блокере запиши воспроизведение и необходимое решение. Не включай чужие изменения в commit/push; учитывай исключения AGENTS.md для CLI executor/QA.
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

Предпочтительно **gpt-6.1-sol, high**. Архитектурный риск, реальная серверная физика, сравнение стеков и интерпретация измерений требуют gpt-6.1-sol с high. Это качественная оценка соотношения затрат и качества по доступному списку моделей и риску задачи, без утверждений о точных тарифах. Для этой серверной серии экономичная модель без запаса на архитектуру и проверки не рекомендуется.
