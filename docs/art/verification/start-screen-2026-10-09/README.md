# Native Car Stars start screen — 2026-10-09

Implemented from the approved menu in Figma file
`NllQADLKwk6RK8pMTurKiN`, using the checked-in individual art layers from
`docs/art/figma/2026-10-09/approved-menu/assets/` and the prior logo/button assets.
Production WebP provenance, sizes and source paths: `public/ui/start/manifest.json`.
Eight illustrations total 734,368 bytes. Fonts are self-hosted with OFL licenses.

## Verified in the actual browser

- 390×844: logo, sculpted side headings, descriptions, icon-free PLAY match the
  approved style. All menu images decode; no document overflow.
- 320×568: controls remain visible; document dimensions equal viewport dimensions.
- 844×390: landscape layout places logo on the left and controls on the right;
  no overflow, PLAY fully inside viewport.
- Racer/City selection works from native role buttons, scene hit regions and
  Home/arrow keyboard navigation. Diagonal reveal, scene scale and title crossfade
  provide selection feedback; no Selected label.
- City displays Coming soon and disables PLAY. Racer enables PLAY once the car
  and shaders finish loading.
- PLAY exits the menu and starts a fresh race. Holding W for 1.2 seconds produced
  a visible 45 km/h HUD reading. MENU returns to selection. Settings opens from
  the menu; Escape closes it and restores focus to the menu gear.
- Browser console: no errors during the exercised flows.
- Menu pauses world updates/rendering and guards gameplay input (code reviewed).
  `?debug`, `#debug`, `?damageTest`, `?play=1` preserve direct lab entry.
- Reduced-motion CSS and immediate launch path implemented; not separately
  emulated in this browser session. Load retry/fatal WebGL states were code
  reviewed, not fault-injected.

## Automated checks

- `npm run build`: passed (existing large Three.js bundle warning).
- `npm test`: 277 tests, 276 passed, 1 failed in the existing
  `tests/settings-defaults.test.js:78` blur-focus persistence test: actual 58,
  expected 68. Neither that test nor `src/settings-defaults.js` was changed.
- `git diff --check` on implementation paths: passed.

Screenshots in this directory were captured from the running application, not
from a design render. Temporary browser viewport overrides were reset afterward.
