# Источники и границы базы

Составлено 8 октября 2026. База содержит наши краткие выводы, рекомендации и ссылки; полные уроки, субтитры и чужие исходники не перенесены.

## Опыт CarWars

Исходники сверены с CarWars, commit `e6be22d821788caaaa89eede4507819d44b32459`. [Репозиторий на этой ревизии](https://github.com/Gobestvini/car-wars/tree/e6be22d821788caaaa89eede4507819d44b32459). Использованы `three@0.180.0` и `cannon-es@0.20.0` из package.json. Таблица описывает прочитанный контекст, а не повторное прохождение всех старых проверок.

| Материал исходного проекта | Переносимый вывод | Статус |
| --- | --- | --- |
| `src/game-loop.js`, цикл `src/main.js` | Fixed update, interpolation, камера, разделение метрик | Наблюдение по коду; конкретный timestep не переносится |
| `src/traffic.js`, `src/vehicle-spawn.js`, `docs/knowledge/police-pursuit-design.md` | Один мир/runtime, роли, occupancy, safe spawn, cleanup | Архитектурный вывод; ADR содержит проектный контракт, его детали требуют сверки с реализацией |
| `src/tire-tracks.js` | Ограниченное хранение, грязные диапазоны, fade в шейдере | Наблюдение по коду; число сегментов и время fade не универсальны |
| `src/signal-glow.js`, `src/building-occlusion.js` | Прозрачные эффекты, instancing, видимые slots, стоимость pixels | Инженерный вывод по реализации; не benchmark новой игры |
| `docs/knowledge/playbook.md`, `application.md`, `sources.md` | Цикл, ввод, camera, quality, ресурсы и provenance | Ранее накопленная база; результаты её тестов относятся к той ревизии |
| Отчёты `TASK-0046`, `TASK-0050`, `TASK-0051` | Причины ожидания NPC, раздельная проверка прогресса, визуальная приёмка | Уроки из отчётов; прошедшие отдельные assertions не подменяют полный suite |

Контент, механики, старые задачи, измерения и SHA-память исходной игры не копируются. Рекомендации по generation IDs, версионированию настроек и формату решений — развитие общих правил, а не утверждение, что всё это уже реализовано в CarWars или шаблоне.

## Первичная документация Three.js

Справочник API и нужные разделы проверены 8 октября 2026. Онлайн-страницы развиваются; для реализации используй установленную версию. Руководства `r180` закреплены на версии CarWars.

| Источник | Что использовано |
| --- | --- |
| [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) | WebGL2, resize/DPR, info, предварительная компиляция |
| [Material](https://threejs.org/docs/pages/Material.html) | Depth/прозрачность, onBeforeCompile, customProgramCacheKey |
| [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) | Матрицы/цвета, needsUpdate и bounding volumes |
| [BufferAttribute](https://threejs.org/docs/pages/BufferAttribute.html) | Usage и диапазоны в компонентах массива |
| [Texture](https://threejs.org/docs/pages/Texture.html) | Color space и свойства текстур |
| [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) | Загрузка и подключение декодеров |
| [DirectionalLightShadow](https://threejs.org/docs/pages/DirectionalLightShadow.html) | Ограничения охвата shadow camera |
| [Color management, r180](https://github.com/mrdoob/three.js/blob/r180/manual/en/color-management.html) | Линейный цвет, sRGB, карты данных и выходные преобразования |
| [Transparency, r180](https://github.com/mrdoob/three.js/blob/r180/manual/en/transparency.html) | Ограничения порядка отрисовки |
| [Cleanup, r180](https://github.com/mrdoob/three.js/blob/r180/manual/en/cleanup.html) | Явное освобождение WebGL-ресурсов |

Чтение этих страниц не означает проверку всех примеров на GPU. Сборка шаблона проверяет Canvas-каркас; новый Three.js renderer, материалы и шейдеры потребуют своего браузерного сценария.

## Предшествующее исследование Bruno Simon

В базе CarWars от 5 октября 2026 были изучены 16 файлов [folio-2025, закреплённая ревизия](https://github.com/brunosimon/folio-2025/tree/41046b57eeed8d156d9c3fd7fa259900baef7816), открытые начала четырёх уроков [Three.js Journey](https://threejs-journey.com/) и технические разделы субтитров Devlog 1/3/10/13. Это ранее зафиксированная степень изучения; весь курс и кадры всех видео не изучались. Fixed step, собственный пул следов и конкретные quality-параметры CarWars — наши решения, а не настройки, приписанные автору. Нового просмотра этих материалов при дополнении шаблона не было.

Новые исследования и их применение записывай в [RESEARCH](../RESEARCH.md). Факт в источнике, инженерное решение и подтверждённый результат проверки должны оставаться различимыми.
