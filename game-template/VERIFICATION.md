# Проверки шаблона

7 октября 2026. Проверяется каркас шаблона, а не будущая игра.

- `pnpm install --frozen-lockfile`: успешно, esbuild postinstall разрешён конфигурацией workspace.
- `pnpm check:full`: 34/34 node:test, production build успешно.
- `pnpm check` сразу после полного прогона: использована квитанция неизменённых входов.
- `tools/browser-check.cjs`: Edge headless, desktop 1280×900 и mobile viewport 390×844; пауза/resume/reset, blur ввода, отсутствие horizontal overflow, JS/console/HTTP ошибок. Это desktop surrogate, не физический телефон.
- Четыре локальных SKILL.md прошли bundled quick_validate.py; для Windows использован UTF-8 mode.
- `pnpm context -- "шаг времени"`: пустая память читается без ошибок; старые записи не перенесены.
- `pnpm telegram:check`: токен не настроен; listener/Telegram API/Codex модели не запускались.
- Автоматические тесты подтверждают ограничение fingerprint папкой шаблона, инвалидацию pnpm manifests, отказ runner во вложенном checkout. Транспорт Telegram и модели проверяются fixtures, не реальными аккаунтами.

- `tools/create-project.ps1`: создан независимый временный smoke-game с git init; frozen install и все 34 теста/сборка прошли из собственного корня. Исходные секреты, логи, зависимости и worktree не скопированы.
- Production preview в Edge headless: pause/reset/resume работают, window.gameDebug отсутствует.
- Скриншот mobile viewport просмотрен: подписи и кнопки помещаются, сцена соответствует пустому каркасу.

CI workflow подготовлен, удалённый GitHub Actions запуск здесь ещё не наблюдался. Производительность на телефоне, игровое ощущение и процент экономии токенов не измерены.

## Дополнение базы знаний, 8 октября 2026

- `pnpm check:full`: 34/34 node:test, production build успешно.
- Проверка UTF-8 и локальных Markdown-ссылок: 13 документов, 33 ссылки, все цели существуют.
- `tools/create-project.ps1`: создан независимый временный `knowledge-smoke`. Все 9 файлов `docs/knowledge` побайтно совпадают с шаблоном; AGENTS и обновлённый `game-quality` также совпадают. SHA-память новой игры пуста.
- `git diff --check` для изменённых файлов шаблона: ошибок whitespace нет.

Изменены документы и инструкции навыка. Сборка и тесты подтверждают прежний Canvas-каркас; Three.js renderer и приведённые инженерные рекомендации не реализованы этим дополнением и требуют проверки при применении. Новые browser/device сценарии для этого дополнения не запускались.
