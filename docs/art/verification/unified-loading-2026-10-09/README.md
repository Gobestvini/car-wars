# Unified startup loading — 2026-10-09

The illustrated loading screen now owns the entire startup, including the dynamic game-module download, world and controls initialization, car resources, shader compilation, UI image decoding, fonts, and first rendered frame. The menu is released only after this preparation. PLAY and returning from the menu reuse the prepared scene.

Removed the legacy car-loading notice, separate retry button and menu initialization text. Resource failures and Retry stay on the illustrated screen. Once startup completes, the loader cannot reopen during gameplay.

## Verification

- `npm run build`: passed.
- `node --test tests/loading-screen.test.js`: 4/4 passed, including the completed-loader guard.
- `npm test`: 280/281 passed. Existing unrelated failure: `tests/settings-defaults.test.js:81`, blur focus expects 68 but defaults contain 58; these defaults were not changed.
- `git diff --check`: passed for the changed files.
- In-app browser, 390 × 844: a controlled local proxy held the main module download; the illustrated loader stayed at 2%, before game initialization.
- Holding the blue menu-button image kept the same loader at 94% and the menu inert. Returning HTTP 503 showed Retry on that same screen. Restoring the resource and retrying reached the ready menu.
- PLAY entered the rendered race with the loader hidden and no legacy loading elements. Returning to MENU and pressing PLAY again also entered the race without another loader.
- Reset the temporary viewport, removed the proxy tab, and checked the ready menu on the normal development URL.

`game-without-loader.jpg` records the race after PLAY. Browser reliability, damage-effects and UI utility selectors were updated for the unified loader; those utility scripts were not run. Browser checks above used the in-app browser.
