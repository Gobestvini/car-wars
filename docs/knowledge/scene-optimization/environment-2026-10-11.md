# Среда проверок и ограничения — 2026-10-11

CarWars поверх HEAD b440275 с незакоммиченными диагностическими изменениями77/79. Исходники каждого browser run идентифицируются sourceHash в JSON; Git HEAD сам по себе не описывает рабочее дерево. Windows, Intel Core i9-13900KF, NVIDIA RTX4080, Edge155.0.4283.45/ANGLE D3D11. Mobile viewport не является физическим телефоном. Внешние headless rAF не подтверждают физическую частоту дисплея; физическая60Гц/реальный OS hidden для77 не проверены.

## Фактические отказы

- Независимые QA77 full/serial/jitless прогоны Node24 и несколько root прогонов завершались native exit2147483651 или3221225477 в разных файлах, без JS assertion. QA-логи находятся в соседнем frame-pacing. Сборка и целевые тесты диагностических модулей проходят.
- Root текущий обычный full suite:279/280, только новый agent-knowledge assertion, без native; последующий full: отдельный agent-knowledge assertion и native traffic-spawn. Отдельный traffic-spawn также упал.
- Проверена временная portable копия [официального Node22.23.3](https://nodejs.org/dist/v22.23.3/), SHA256 zip `2B0FF57B049CDA1BBCEA2240EEC20467018713C1EFE1F7360C2681859B90ED71`. Никакие зависимости проекта не переустанавливались. Обычный, direct, jitless и no-lazy traffic-spawn также падали native; jitless журнал содержит `Check failed: maybe_code.has_value()`. Это наблюдение, а не диагноз причины.
- Default-affinity Edge baseline не завершился: первый low прогон прошёл60сек, но renderer упал при экспорте профиля (`baseline/collector-error.json`, slow telemetry сохранена). Строковый JSON export сохранил полный low run (`baseline-v2/desktop-low-empty-1.json`), затем следующий mobile-low-60 renderer упал ещё до старта измерения (`baseline-v2/collector-error.json`). Успешный одиночный run не заменяет матрицу/три повтора.

## Изолированная affinity процесса

У временного Node процесса менялась ProcessorAffinity, системные настройки не менялись. Traffic-spawn прошёл5/5 с mask1 и mask15. Полный Node24 verify с mask15 всё ещё получил native street-prop-placement; с mask1 native отказов не было:280/281, единственный agent-knowledge assertion. Журналы `full-affinity1-tests.log`/`full-affinity15-tests.log` и отдельные node22-traffic-spawn*.log. Ограничение только процесса не доказывает причину исходных падений.

WebGL collector поддерживает **описание** `SCENE_PROFILE_CPU_AFFINITY`, а не самовольно меняет affinity. Launcher назначает её временно Node процессу; collector через CDP/PowerShell читает actual mask каждого принадлежащего ему браузерного процесса и проверяет наследование до измерения. Такой профиль отделён от default-affinity и не выдаётся за производительность обычного запуска или телефона. Все сравниваемые стадии обязаны иметь одинаковую среду/маску. Одновременно с timing runs не запускаются root tests/build/другие измерительные браузеры.

Промежуточные baseline-affinity1 и baseline-affinity1-v2 остановлены исполнителем при аудите input fixture, а не из-за новой native ошибки: первоначальный hook подменял getInput и не сохранял guard ареста. Они не являются итоговым baseline. В окончательном collector тестовый маршрут задаёт pointer coordinates, а getInput/joystickVector/directionalInput выполняются как в игре. Smoke pointer-final-smoke low/high300/lifecycle прошёл; actual live process masks1 подтверждены. Завершившиеся между CDP и OS snapshot служебные процессы отмечаются present=false, ошибки доступа не скрываются. Итоговая серия выполняется отдельно в baseline-stable; до завершения всех повторов её нельзя считать принятой.

## Отдельный исходный отказ автоматизации

Параллельная чужая миграция удалила tools/telegram/verify.js и добавила tools/verify.js/tests/agent-knowledge.test.js. Root использовал новый существующий путь. Assertion в tests/agent-knowledge.test.js:56 ожидает reused=true после изменения только Markdown, получает false. Fixture игнорирует `.check-*`, а новый receipt называется `.checks.json`; он попадает в fingerprint. Текущий корневой .gitignore также не покрывает новый receipt. Это отдельная проблема миграции; её реализация/чужой staging здесь не изменялись. Общий suite не объявляется успешным.

Обновление после завершения основной серии: baseline-stable содержит18/18 полноценных raw reports, все без ошибок/overwritten/duplicate IDs. Результаты отдельно сведены в baseline-summary.json и baseline-2026-10-11.md. Изначальные отказы выше сохранены как история, а не актуальное состояние этих завершённых runs. Параллельная миграция уже исправила fixture ignore на `.checks.json`/`.check-logs/` и добавила эти пути в корневой .gitignore; исполнителем77–82 эта часть не менялась. Полный suite после этого изменения нужно повторить. Финальное QA-решение79 пока не получено; baseline не является выполнением оптимизаций80–82.
