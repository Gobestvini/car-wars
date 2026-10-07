# Каталог визуальных семейств

TASK-0051, 2026-10-07. Статус: подготовка; runtime-проверки записываются в отчёт задачи.

| ID / источник | Варианты и назначение | Технический контракт | Владелец |
| --- | --- | --- | --- |
| player-sedan / public/models/sedan.glb | Игрок, healthy → deformation → detached wheels | body и четыре wheel-*, +Z нос, кузов около 4.45 м; непрозрачный кузов/стекло, независимые wheel pivots | loadCar и существующий retry cleanup |
| player-colormap / public/models/Textures/colormap.png | Исходный atlas Kenney | Сохранить UV; цветная текстура sRGB, линейная фильтрация и mipmaps | Материалы модели |
| civilian / src/traffic.js | Четыре+ приглушённых кузова, два верха | Общая geometry/material, прежние collision role и габариты; opaque | Vehicle runtime dispose |
| police / src/traffic.js | Светлый кузов, тёмная ливрея, красно-синий маяк | Общие материалы, bounded emissive, без отдельных источников света | Vehicle runtime dispose |
| buildings / src/city-scene.js | Три семьи, три района, landmarks tower/hall/clock | Footprints/высоты физического тела неизменны; instance colors и общая геометрия; все детали участвуют в fade | City dispose / BuildingOcclusion |
| roads / src/city-scene.js | Асфальт, тротуар, спавн и граница | Opaque общие материалы, раздельные глубины слоёв, прежние colliders | City dispose |
| markings / src/road-markings.js | Dashes и stop lines | Instancing, прежние координаты при ширине 12/15/30 м | City dispose |
| signals / src/city-scene.js, src/signal-glow.js | red/yellow/green/off | Текущие сигналы TASK-0050, общий ограниченный beam draw, low/high sample limit | City dispose |
| damage-fx / src/car-damage-effects.js | healthy, grey/dark smoke, fire, explosion | Существующие ограниченные пулы, camera-facing alpha, terminal burst однократный, reset | CarDamageEffects |
| tracks / src/tire-tracks.js | Контактный hard skid, старение | Существующий кольцевой буфер, без новых текстур | TireTracks |
| ui / index.html, src/style.css | speed, settings, joystick, loading/error/retry | System font, локальный SVG gear, цели ≥44 CSS px, safe areas | DOM lifecycle |

## Происхождение

Игрок и его atlas: Kenney Car Kit 3.1, CC0, свидетельство [LICENSE](../../public/models/LICENSE.txt), исходный автор Kenney. Ассет остаётся производным от существующей модели; изменения материала/цвета фиксируются в коммите TASK-0051. Лицензию не удалять.

Процедурные формы и SVG: авторство проекта, создано при TASK-0051; внешних приобретённых/generated моделей нет. К ним применяется лицензия репозитория, если она определена владельцем; новую стороннюю лицензию не придумывать. Новые PNG проверки — кадры собственной игровой сцены, не runtime-ассеты.

При добавлении файла записать path, размер, texture dimensions/format/color space/filtering/mipmaps, scale/pivot, LOD, source URL/tool/version, лицензию и историю правок. Для геометрии записать triangles/material slots и collision role. Production статус выдаётся после технической проверки и просмотра с настоящей камерой. Placeholder нельзя считать готовым лишь потому, что он импортируется.
