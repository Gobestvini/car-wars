# TASK-0078 — свежая доводка света и материалов

2026-10-11. Эталон: `docs/art/concepts/2026-10-08/02-gameplay-thief.png`. Новые before/after настоящей игры находятся в `before/app/` и `after/app/`; история №76 сохранена. `comparison.json` подтверждает идентичные viewport/quality/blur/camera/target/car/seed/props во всех 36 парах. Триптих и семь `crop-*.png` только кадрируют/масштабируют PNG, без коррекции цвета. Reference/game crops семантические и независимые; игровые before/after crops строго одинаковые. Координаты записаны в JSON. Геометрия мокапа отличается.

Основной ракурс camera[-28,60,-116], target[-73,0,-68]; near camera[-57,23,-86]. Игрок[-78,.96,-65],yaw-.4,120 фиксированных шагов с тормозом. Основные кадры traffic0/police0; крупные планы обеих сторон всех ролей добавляют2NPC/1police через безопасный seeded runtime. Тестовый browser context использует собственный persisted profile; пользовательский localStorage не затрагивается. Cold/live использует настоящие defaults.

| Область | Исходное расхождение | Изменение / результат | Остаточная разница |
| --- | --- | --- | --- |
| Фасады | Крупная видимая стена оливково-серая, прежний sun освещает обратную сторону сравнительного ракурса | Sun[24,38,-20],4.1,fill1.6,тёплый ground bounce #c9b4a0,exposure1.2; жёлтая семья #ffe0a0,персиковая #f6bda0. Видимые грани кремовые и различимы | Нет геометрических фасок/швов концепта |
| Тротуар | Серо-кремовый | #f5dfbb и тёплый bounce, светлая тёплая поверхность с читаемой боковой гранью | Нет плиточного рисунка |
| Крыша | Почти равномерная синяя заливка | #096ee8,roughness.48,metalness0; более явная освещённая плоскость диэлектрической крыши | Крупные плоские поверхности, другая геометрия |
| Дорога | Почти однородный холодный цвет | #52698d,roughness.88; холодный асфальт сохраняется, направления теней дают читаемый объём | Существующая vertex variation слабая; текстуры не добавлены |
| Зелень | Мутные грани в тени | Геометрия/палитра сохранены, sun/fill разделяет светлые и тёмные грани | Есть прежние конические кроны |
| Машины | Преимущественно матовая краска | Player roughness.42,NPC/police.48; atlas стекла/резины/металла и сигнальные цвета сохранены; close-ups обеих сторон всех ролей | Нет environment map; блик зависит от прямого солнца |
| Свет/тень | Тёмный видимый фасад при яркой крыше | Солнце со стороны видимых стен; тёплый bounce; существующий shadow coverage проходит regression | PCF512/1024, отдельные прежние self-shadow полосы; AO/контактные тени не добавлены |

Промежуточный offset[-24,38,-10] отклонён после просмотра: стена оставалась тёмной, крыша чрезмерно голубой. Финальное направление выбрано по освещению видимых граней. Camera defaults/геометрия/физика/blur сохранены. Pipeline не менялся; `gpu-color-report.json` содержит color/frequency WebGL regression.

Матрица1440×900/390×844,DPR1,low/high,blur0/1,follow/free,near и close-ups. Десять quality/blur/rebuild циклов после прогрева:52geometries,5/12textures,33programs (включая дополнительные3машины), без монотонного роста. При изменении солнца меняются shadow caster counts; полная стоимость всех сцен в comparison.json. Подбор не добавил meshes/materials/passes. Среда Edge headless/SwiftShader desktop, не телефон.

Live automation проверяет cold defaults, W1.5секунды, follow/free и reset. Это не доказательство полного проезда перекрёстка: независимому QA требуется отдельный обязательный сценарий. Художественный результат оценивается просмотром PNG, не HEX/сборкой.

Повтор (Vite5173):

```powershell
$env:PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:ART_REVIEW_ROOT='docs/art/verification/mockup-light-materials-followup'
node tools/city-app-check.cjs after
& 'C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' tools/build-mockup-followup.py
```

Before снят до правок; повтор before на финальном коде историческую палитру не воспроизводит. Для QA использовать новый phase label, не перезаписывать before/after.
