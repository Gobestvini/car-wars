# Следы поверх разметки — TASK-0074

2026-10-10. Desktop Edge, SwiftShader, DPR 1; 1440×900 и 390×844, low/high. Это WebGL-проверка, не измерение телефона.

`before/` и `after/` — одинаковые камеры и прежняя палитра до/после исправления слоя краски. В `final/` расширенная матрица после TASK-0075/0076: штрихи и стоп-линии двух направлений. Имена `dash`/`dashX` — источник player; `stop`/`stopX` — police. Детерминированные контактные сигналы колёс проходят через настоящий `TireTracks.updateVehicles`, sampler и production scene; это изолированная rendering fixture, а не запись AI-погони.

Подтверждённая причина: верх штриха был y=0.0375, стоп-линии y=0.045, след — y=0.009. Теперь краска — горизонтальная плоскость y=0.006 над дорогой y=0.005; след остаётся y=0.009. Геометрический порядок дополняется смещениями depth units −1/−2. Обычный depthTest сохранён, разметка получает тени. Уменьшение краски до двух треугольников вместо объёмного блока убрало 8320 треугольников из первоначальной fixture без добавления draw calls.

В исходном кадре пиксель разметки с включённым/выключенным следом одинаков: RGB 234/230/219. После исправления: 145/156/144 против 234/230/219. Финальные проверки включают тень, реальный кузов поверх следа, intensity 0→1, rebuild и capacity=6000. В тени след затемняет краску; под непрозрачным кузовом пиксель с/без следа одинаков. Результаты и точные позы — `*/report.json`.

Повтор:

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node tools/city-visual-check.cjs final markings
node --test tests/tire-tracks.test.js tests/road-surface.test.js tests/road-markings.test.js
```

Игра должна работать на http://127.0.0.1:5173/. Порог заноса, lifetime, физика, sampler тротуаров и правила источников не менялись. Существующие тесты сохраняют переход на поднятый тротуар, непрерывные секции, интенсивность, reset и ограниченный буфер.

Независимый QA выявил вырез на верхней кромке бордюра. Доработка в `src/track-surface.js` делит смешанные по высоте секции по границе sampled surfaces и добавляет соединение по вертикальной грани; flat sections остаются одним quad. Интерполируются UV, birth и fade, включая terminal cap. Все части используют тот же bounded ring и один draw call; группа записывается только при наличии безопасных slots. Bias factor=-1, units=-2 согласован с slope bias существующей окантовки; depthTest сохранён. `surface-rework/` содержит 16 pixel-checked сцен прямого/обратного/косого/rounded перехода для player/police, обоих viewport и quality. `rework/` повторяет полную матрицу разметки, shadow/body occlusion/reset/intensity. Первичные QA-артефакты с дефектом сохранены отдельно.

```powershell
node --test tests/track-surface.test.js tests/tire-tracks.test.js tests/road-surface.test.js tests/road-markings.test.js
node tools/tire-track-surface-check.cjs surface-rework
```
