# Карта проекта

| Путь | Назначение |
| --- | --- |
| src/main.js | Canvas, RAF, resize, visibility, пауза/reset, HMR dispose |
| src/loop.js / createStepper | Шаг 1/60 с, максимум 8 шагов кадра, dropped time, alpha |
| src/input.js / createInput | Клавиатура event.code, blur/reset/dispose |
| src/scene.js / createScene | Пустая точка расширения: update/render/reset/snapshot/dispose |
| index.html, src/style.css | Доступные кнопки и адаптивная пустая сцена |
| tests/loop.test.js, tests/input.test.js | Частоты кадров, stalls, ввод и очистка |
| tools/telegram/knowledge.js | Память, актуальность хэшей, ограничение контекста |
| tools/telegram/verify.js | Тесты/сборка, логи, квитанция проверки |
| tools/telegram/economy.js | Инструкции экономии, JSONL usage, учёт кэша |
| tools/browser-check.cjs | Desktop/mobile layout, pause/reset, ввод, ошибки |

Рабочая директория всех команд — корень шаблона. `pnpm dev`, `pnpm test`, `pnpm build`, `pnpm check:full`, `pnpm context -- "тема"`.

Порядок: ввод → fixed update → render(alpha). При добавлении движения храни previous/current и интерполируй только графику. Обновляй карту при изменении владельцев подсистем; не записывай каждый внутренний helper.
