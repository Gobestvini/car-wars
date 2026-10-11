# TASK-0077: интервалы кадров — проверка 2026-10-11

Исправлен подтверждённый локальный дефект ранних callbacks: разрешён допуск до1мс (6% интервала), при этом deadline продолжает двигаться по исходной сетке. При stall число пропущенных слотов округляется с EPS1e-9, чтобы погрешность floating point не оставляла deadline на том же timestamp. Один вызов не запускает пачку рендеров. STEP1/120, elapsed, catch-up и интерполяция сохранены.

До исправления новый минутный fixture60Гц с чередованием±0,4мс принял2273/3600 callbacks; после —3600/3600, интервалы15,87–17,47мс. Seeded jitter, независимая фаза,30/59,94/60/60,06/120/144/165Гц, stall/reset/invalid timestamp проходят. Это синтетическое доказательство свойства ограничителя, а не измерение дисплея пользователя. На144/165Гц остаётся естественное квантование выбранными callbacks; обещания одинакового16,67мс нет.

## Живое сравнение

Microsoft Edge155.0.4283.45 headless, Windows, ANGLE/D3D11, NVIDIA GeForce RTX4080,1440×900,DPR1, CPU throttle1. Seed20261005, roadWidth15, spawn(-75,.96,-50),yaw0. Прогрев10сек, затем60сек повторяющегося W/D-ввода; после10сек test-only hook включает wanted и damage.55 для нагрузки преследования/дыма. Измерения игры из принятого frame, независимый внешний rAF-наблюдатель отдельно. Старый limiter подставлен из1bc8c94 только в тестовый HTTP-ответ; исходники не откатывались. Каждый набор снят один раз: статистической гарантии ускорения нет.

| Сценарий | Старый / новый rendered | Старый / новый p95 интервала,мс | p99,мс | CPU p95,мс | GPU p95,мс |
| --- | --- | --- | --- | --- | --- |
| low,0civilian,1police,blur0 |3573 /3589|20,6 /20,7|35,6 /34,2|10,6 /10,5|2,50 /3,68|
| high,60civilian,1police,blur0 |3569 /3585|20,7 /17,6|37,5 /34,6|6,1 /6,4|3,17 /2,89|

GPU данные получены EXT_disjoint_timer_query_webgl2, валидные недизъюнктные результаты; CPU render submission отдельно в JSON. Показатели не доказывают отсутствие GPU/CPU пиков. Внешних rAF было12683–13661 за прогон, игровых кадров3573–3589: считать внешний rAF как FPS игры было бы ошибкой. Headless callbacks не устанавливают аппаратную частоту монитора. Ни экран пользователя, ни физический телефон не проверены; high-refresh cadence проверен синтетически.

Исходные rows, GPU samples, настройки и независимые rAF timestamps: [старый limiter](frame-pacing/legacy-observed/), [новый](frame-pacing/after/). [Первое before](frame-pacing/before/) сохранено дополнительно; там ещё нет внешнего наблюдателя, поэтому основное сравнение использует legacy-observed. Код времениGPU относится к диагностикам0079 и не означает приёмку этапа оптимизации.

## Окно диагностики и паузы

`carLab.performance().frameIntervals`: mean/p50/p95/p99/max вмс; sampleCount, durationMs, over25, over33_34, over50. Кольцевой буфер600интервалов, сортировка только при редком обновлении debug HUD или явном чтении API. Обычный UI скрывает debug HUD. Первый кадр после hidden/loading/menu/reset не образует интервал с предыдущим окном. Фактическое появление пикселей на дисплее этим не измеряется.

[regression.json](frame-pacing/regression.json): follow/free, пять секунд hidden и loading, возврат из меню и W→reset. Принятые render counters и pose не менялись во время пауз, droppedSeconds не выросли, новое окно не содержит паузу. Hidden/loading здесь включены контролируемыми getters и событиями в настоящей игре; это проверяет интеграцию ветвей приложения, не OS/browser suspension. UI меню запускается настоящими кнопками.

Повтор:

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SCENE_PROFILE_CASES='desktop-low-empty,desktop-high-60'
$env:SCENE_PROFILE_REPEATS='1'
$env:SCENE_PROFILE_OUT='docs/knowledge/frame-pacing/after-recheck'
node tools/scene-performance.cjs
# Для старого limiter добавить FRAME_PACING_LEGACY=1 и отдельный OUT.
node docs/knowledge/frame-pacing/check.cjs
node --test tests/game-loop.test.js tests/frame-intervals.test.js tests/scene-profile.test.js
```

Локальный дефект воспроизведён и устранён. Остающиеся p99пики требуют профиля сцены0079–0082; изменение качества, физики либо лимита не использовано. Полная плавность на неизвестном устройстве пользователя не доказана.
