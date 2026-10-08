# Каталог визуальных семейств

TASK-0051, 2026-10-07. Статус: интегрировано; WebGL-проверки записаны в отчёт задачи. Физическое мобильное устройство не проверено.

| ID / источник | Варианты и назначение | Технический контракт | Владелец |
| --- | --- | --- | --- |
| player-sedan / public/models/sedan.glb | Игрок, healthy → deformation → detached wheels | body и четыре wheel-*, +Z нос, кузов около 4.45 м; непрозрачный кузов/стекло, независимые wheel pivots | loadCar и существующий retry cleanup |
| player-colormap / public/models/Textures/colormap.png | Исходный atlas Kenney | Сохранить UV; цветная текстура sRGB, линейная фильтрация и mipmaps | Материалы модели |
| civilian / src/vehicle-visuals.js | Четыре+ приглушённых кузова, два верха | Общая geometry/material, прежние collision role и габариты; opaque | Vehicle runtime dispose |
| police / src/vehicle-visuals.js | Светлый кузов, тёмная ливрея, красно-синий маяк | Общие материалы, bounded emissive, без отдельных источников света | Vehicle runtime dispose |
| buildings / src/city-scene.js | Три семьи, три района, landmarks tower/hall/clock | Footprints/высоты физического тела неизменны; instance colors и общая геометрия; все детали участвуют в fade | City dispose / BuildingOcclusion |
| roads / src/city-scene.js | Асфальт, тротуар, спавн и граница | Opaque общие материалы, раздельные глубины слоёв, прежние colliders | City dispose |
| markings / src/road-markings.js | Dashes и stop lines | Instancing, прежние координаты при ширине 12/15/30 м | City dispose |
| signals / src/city-scene.js, src/signal-glow.js | red/yellow/green/off | Текущие сигналы TASK-0050, общий ограниченный beam draw, low/high sample limit | City dispose |
| street-trees / src/tree-placement.js, src/city-trees.js | До 96 деревьев, три оттенка кроны/ствола | Seeded placement, 5-sided CylinderGeometry + IcosahedronGeometry detail 0; две shared InstancedMesh batches; декоративные, без коллизий | City dispose; скрытие только крон, перекрывающих игрока |
| miniature-blur / src/miniature-blur.js | Верхняя и нижняя полосы размытия, резкий центр по всей ширине | RGBA16F scene/depth target с MSAA2 low / MSAA4 high там, где GPU поддерживает; два single-sample blur targets и три fullscreen passes, 3 CSS px low / 5 CSS px high | Renderer lifecycle, resize/quality reuse, pagehide dispose; MSAA downgrade сохраняет blur, HDR fallback использует direct render |
| damage-fx / src/car-damage-effects.js | healthy, grey/dark smoke, fire, explosion | Существующие ограниченные пулы, camera-facing alpha, terminal burst однократный, reset | CarDamageEffects |
| tracks / src/tire-tracks.js | Контактный hard skid, старение | Существующий кольцевой буфер, без новых текстур | TireTracks |
| ui / index.html, src/style.css | speed, settings, joystick, loading/error/retry | System font, локальный SVG gear, цели ≥44 CSS px, safe areas | DOM lifecycle |

## Происхождение

Игрок и его atlas: Kenney Car Kit 3.1, CC0, свидетельство [LICENSE](../../public/models/LICENSE.txt), исходный автор Kenney. Ассет остаётся производным от существующей модели; изменения материала/цвета фиксируются в коммите TASK-0051. Лицензию не удалять.

Процедурные формы и SVG: авторство проекта, создано при TASK-0051; внешних приобретённых/generated моделей нет. К ним применяется лицензия репозитория, если она определена владельцем; новую стороннюю лицензию не придумывать. Новые PNG проверки — кадры собственной игровой сцены, не runtime-ассеты.

При добавлении файла записать path, размер, texture dimensions/format/color space/filtering/mipmaps, scale/pivot, LOD, source URL/tool/version, лицензию и историю правок. Для геометрии записать triangles/material slots и collision role. Production статус выдаётся после технической проверки и просмотра с настоящей камерой. Placeholder нельзя считать готовым лишь потому, что он импортируется.

## Изменения 2026-10-07

`src/art-direction.js` — финальные palette/light/quality tokens; `src/city-art.js` — instanced plinth/cornice/three roof families и optional roof plant. `src/vehicle-visuals.js` — vertex-color merged geometry транспорта, шесть цветов/два верха и полицейская ливрея. Материалы sRGB swatches конвертируются Three.Color в linear, atlas сохраняет GLTF color-space; новых raster текстур, UV-каналов и файлов модели нет.

Игрок: shader remap только тёплых образцов исходного atlas в #FFC34A, стекло/фонари остаются прежними; topology/UV/pivots/deformation неизменны. Трафик: по одному material slot в объединённом кузове, у полиции дополнительные два общих emissive material slots; габариты ≤2.02×3.88 м. Никаких новых collision proxies. Размер дополнительных runtime ассетов: 0 bytes; текстурная GPU-память сверх baseline: 0 MiB.

Проверены shape/determinism/fade/ownership и WebGL compile, width12/15/30, directional stop lines, повреждения/однократный взрыв/reset/retry и quality. См. verification/features и verification/budget. Телефонная плавность остаётся непроверенной, production acceptance отмечена в задаче как review.

Поправки по просмотру: вентиляция размещается только на плоских кровлях, нижняя грань совпадает с верхом крыши. Fade запускается перекрытием автомобиля для камеры, без отдельного proximity fade. Все поверхности прозрачного дома используют одинаковые запечённые вершины с общим depth prepass, чтобы alpha применялась один раз к наружной оболочке. При смене quality depth geometry пересобирается без скрытой вентиляции; при restore/dispose все временные геометрии освобождаются. См. verification/building-fade.

Уточнение по скриншоту: синий цоколь исключён из fade, сохраняет непрозрачный instance и обозначает габарит препятствия в low/high без дополнительных draw calls. Геометрия цоколя — открытый периметр с двусторонними боками, без сплошной верхней площадки. Лучи проверки заканчиваются на ближней поверхности ориентированного объёма кузова; точки лежат внутри кузова, а не в пустых углах bounding footprint, и следуют roll/pitch/yaw машины. См. verification/building-boundary.

## Изменения 2026-10-08

TASK-0056 после коррекции по отзыву пользователя: до 320 процедурных деревьев, четыре instanced batches и два общих MeshStandard материала, без новых моделей/текстур и физических тел. Кроны — IcosahedronGeometry detail 0, DodecahedronGeometry detail 0 и шестигранный ConeGeometry; ствол — пятигранный CylinderGeometry. Кроны нормализованы по высоте, имеют разные объёмы/повороты/оттенки, ствол проникает внутрь каждой кроны, корень стоит на поверхности тротуара. Default seed даёт 13 880 геометрических треугольников на 320 деревьев (без теневого прохода). Посадки используют отдельный seeded hash и spatial hash, не меняющий план дорог/зданий. Процедурная геометрия — код проекта на Three.js 0.180, внешних источников нет.

TASK-0057: screen-space blur поверх linear RGBA16F сцены. Исправлены пропущенные вызовы ACES/sRGB в финальном composite и повторное умножение viewport на DPR; яркость/палитра не менялись. Параметр ×0–2 доступен в панели графики и сохранённых дефолтах. [Статичные кадры и отчёт GPU-регрессии](verification/miniature-blur/README.md) сохранены; телефонный профиль не проверен.

TASK-0059: MSAA включено непосредственно в RGBA16F scene target (2 samples low / 4 high при поддержке), а композит-маска заменена на функцию только от вертикальной координаты. GPU fixture Chrome/WebGL2: 4 samples повысили долю промежуточных пикселей вдоль диагонали с 4.17% до 13.54%; строковая маска показала одинаковое изменение слева, по центру и справа, средняя полоса осталась без изменений. Цветовая регрессия 18/18 сочетаний — max delta 0; ресурсы после 10 циклов стабильны: 33 geometries / 3 textures / 19 programs. Телефон и длительный маршрут не проверены; см. задачу.

Позднее уточнение TASK-0056: деревья полностью декоративные и сохраняют видимость при проезде машины сквозь них. Удалено покадровое скрытие деревьев по camera-to-car rays; matrices стволов/крон статичны, физические тела и коллайдеры не создаются. Building fade продолжает работать отдельно.
