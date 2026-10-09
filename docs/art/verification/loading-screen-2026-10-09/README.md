# Loading screen verification — 2026-10-09

## Art revision 2

Replaced the active illustration with `background-v2.webp` after user feedback.
Checked the generated full-resolution source and the actual 390×844 loading UI:
visible street trees have sidewalk soil beds, the raised left roof garden was
removed, rear tire smoke is restrained, tire trails stay behind the car, and
the foreground road is clean. Runtime image decodes at 887px wide and uses the
new versioned URL for both art and ambient background. Screenshot:
`loading-v2-390x844.jpg`. Source is retained as `background-v2.png`; exact prompts
are in the manifest. Runtime WebP is 173,002 bytes (smaller than v1).
`npm run build` and `git diff --check` passed. No gameplay/controller changes;
the full physics suite was not rerun for this asset-only revision. Temporary
held-resource QA tab/proxy closed, viewport reset, normal game tab refreshed.

Art generated first with built-in ImageGen and visually inspected, then imported
as a 196,190-byte WebP. Source PNG, brief and exact prompt are retained in
`docs/art/concepts/2026-10-09/loading/` and `public/ui/loading/manifest.json`.
Native logo/text/progress were added over the illustration in the running game.

## Browser checks

- Normal launch at `http://127.0.0.1:5188/`: loading overlay appears, reaches Ready
  to race / 100%, fades into the side-selection menu, and releases menu interaction.
- Controlled local proxy at port 5190 held only the sedan model response pending.
  The real loader stayed at Loading cars / 12%; menu remained inert. This was a
  genuine pending resource, not a mocked percentage or an artificial game timer.
- 390×844: source art decoded at 887px wide; no document overflow. Native text and
  gold progress clearly readable. Screenshot: `loading-390x844.jpg`.
- 844×390: logo left, progress/status right; all controls inside the viewport.
  Screenshot: `loading-844x390.jpg`.
- Controlled proxy then returned HTTP 503. The loader displayed the English
  failure message and RETRY, retained the overlay, and stopped normal progress.
  Screenshot: `loading-error-390x844.jpg`.
- Proxy restored the normal response; clicking RETRY successfully loaded the
  model, compiled shaders, opened the menu and enabled PLAY. Clicking PLAY
  entered the game with the speed HUD visible.
- Temporary QA tab/proxy closed; viewport override reset. Normal game tab retained.
- Reduced-motion path and fatal WebGL state implemented; not separately emulated
  in the browser. Controller tests cover fatal state and disabled lab bypass.

## Checks

- `node --test tests/loading-screen.test.js`: 4/4 passed. Covers monotonic/clamped
  progress, menu blocking until dismissal, failure cancelling dismissal, late
  progress ignored after failure, retry resetting state, fatal non-retryable
  error, and direct lab entry bypass.
- `npm test`: 281 tests, 280 passed, 1 pre-existing failure at
  `tests/settings-defaults.test.js:81`: blur focus actual 58 vs expected 68.
  Settings defaults and that test were not modified.
- `npm run build`: passed (existing Three.js chunk-size warning).
- `git diff --check`: passed on this change.

Progress reflects weighted resource/preparation milestones rather than an exact
total byte percentage: car resource transfer, scene compilation, post-processing,
and menu image/font readiness. 100% is reached only after all preparation completes.
The only fixed delays are short bar/fade transitions (320ms + 450ms); reduced
motion removes them. The loader does not delay subsequent already-prepared races.
