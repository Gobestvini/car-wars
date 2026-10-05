# Источники и границы исследования

Дата проверки: 2026-10-05. Только первичные материалы автора и его опубликованный код. Ссылки с временем указывают на раздел; его содержание изучалось по субтитрам, не по кадрам видео.

| Источник | Что проверено | Ограничение |
| --- | --- | --- |
| [Портфолио и Behind the scenes](https://bruno-simon.com/) | Публичное описание технологий и ссылка на репозиторий | Не пройдены все игровые области |
| [Three.js Journey](https://threejs-journey.com/) | Два курса, публичный каталог 87 уроков | Не весь учебный контент |
| [WebGPU & TSL](https://threejs-journey.com/webgpu-tsl) | Публичное описание отдельного курса | Закрытые уроки не читались |
| [Physics](https://threejs-journey.com/lessons/physics) | Доступное начало | Остальная часть закрыта |
| [Code structuring](https://threejs-journey.com/lessons/code-structuring-for-bigger-projects) | Доступное начало | Остальная часть закрыта |
| [Performance tips](https://threejs-journey.com/lessons/performance-tips) | Доступное начало, измерения | Не все советы полного урока |
| [Intro and loading progress](https://threejs-journey.com/lessons/intro-and-loading-progress) | Доступное начало | Остальная часть закрыта |
| [Devlog 1](https://www.youtube.com/watch?v=OBZtVz6IM18) | Субтитры технических разделов 30–1028с | Изображение не просмотрено |
| [Devlog 3](https://www.youtube.com/watch?v=5i_-p4ET2JE) | Субтитры разделов 1–299с | Остальная часть и изображение не изучены |
| [Devlog 10](https://www.youtube.com/watch?v=Uc3Ujdh8Ba4) | Субтитры разделов 285–975с | Начало и изображение не изучены |
| [Devlog 13](https://www.youtube.com/watch?v=EhZwt9P4GP4) | Субтитры 6–1407с | Изображение не просмотрено |
| [Каталог YouTube](https://www.youtube.com/@BrunoSimon/videos) | Videos, Live, Shorts; публичные метаданные | Приватные, удалённые и unlisted ролики не покрыты |
| [Case study 2019, автор Bruno Simon](https://medium.com/@bruno_simon/bruno-simon-portfolio-case-study-960402cc259b) | Доступное описание старой версии | Не смешивать старые matcap/Cannon решения с новой TSL/Rapier версией |

## Код портфолио

[Репозиторий folio-2025](https://github.com/brunosimon/folio-2025), MIT. Проверена версия `41046b57eeed8d156d9c3fd7fa259900baef7816`; SHA совпал с `/commits/main` при проверке. Мы изучали архитектуру, не переносили исходники целиком. Исходные файлы Bruno не добавлены в приложение; новые модули написаны для CarWars.

Прочитаны README, лицензия и следующие файлы в `sources/Game/`: `Ticker.js`, `Viewport.js`, `Time.js`, `Quality.js`, `View.js`, `Rendering.js`, `Monitoring.js`, `Player.js`, `Tracks.js`, `ResourcesLoader.js`, `Inputs/Nipple.js`, `Physics/Physics.js`, `Physics/PhysicsVehicle.js`, `World/VisualVehicle.js`.

Ссылки на ключевые файлы: [Ticker](https://github.com/brunosimon/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Ticker.js), [View](https://github.com/brunosimon/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/View.js), [Tracks](https://github.com/brunosimon/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Tracks.js), [PhysicsVehicle](https://github.com/brunosimon/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Physics/PhysicsVehicle.js), [Quality](https://github.com/brunosimon/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Quality.js).

Кэш исследования в `tools/bruno-research` исключён из Git и production. В базе опубликованы метаданные, ссылки, наши выводы и статусы; полные тексты уроков и субтитров не распространяются.
