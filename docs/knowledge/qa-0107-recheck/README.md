# Повторная независимая приёмка TASK-0107

Проверено 2026-10-19: HEAD `8c7a77462f4a694313baa5a4fefa54ac993f6aa1` + замороженный diff после исправления FOV. Исторический провал FOV=38 online / 50 offline сохранён в `../qa-0107-0108/`. Эта папка содержит новый успешный прогон; исходники и постоянные тесты QA не менял.

Проблема → причина → рабочий способ: одинаковые position/target скрывали различие экранного масштаба → offline resize задавал FOV=50, отличный от initializer 38 → проверять effective FOV и экранную проекцию после окончания loading, на одинаковой отображаемой позе/скорости/масштабе. Исправленный код разделяет FOLLOW_CAMERA_FOV=50 между режимами. Ограничение: коэффициенты и данная композиция относятся к CarWars; это не универсальная настройка камеры.

Подтверждение: 20/20 профильных тестов, 394/394 полного набора + production build 1.74 с; 6/6 контролируемых пар при 0/110 км/ч × 3 viewport, `compositionMismatches=[]`. Позиции/цели, FOV=50 и проекция 4.4-метрового кузова совпадают. Просмотрены все 12 paired PNG и 4 occlusion PNG. Проверены три клиента, контакт, управление, respawn, reconnect, новая комната, high/low, touch и resize, console/pageerror ошибок нет.

- `checked-source-hashes.json` — одинаковые SHA-256 до/после проверки.
- `verify-receipt.json` — итоговая квитанция текущего diff, не исторический full.
- `composition/composition-report.json` и `paired-*.png` — фактические позиции, цели, FOV, проекции и шесть пар игровых кадров без loading overlay; `occlusion-*.png` — blur/прозрачность/тени high/low.
- `lifecycle/after.json` и PNG — независимый повтор `tests/multiplayer-camera-browser.cjs`.
- `controls-check.cjs`, `controls-report.json` — дополнительный QA-прогон W→торможение S→reverse, A/D и границ resize 699/700 и 499/500. Доступ к network добавлен только в перехваченную dev-response; код игры не изменялся.

Среда: Windows Edge headless WebGL, DPR=1, локальные Vite и hosted server 2577. Mobile viewport и touch являются эмуляцией, физический телефон не проверялся. Контролируемые composition hooks фиксируют позу, они не измеряют задержку сети или input-to-display. Публичный сервер не изменялся. Итоговый QA-отчёт и решение находятся в `../../tasks/TASK-0107-multiplayer-camera-placement.md`, раздел 11.
