# Car Stars — English final screens

[Open the updated Figma section](https://www.figma.com/design/NllQADLKwk6RK8pMTurKiN?node-id=6-57).

All six existing 390×844 screens were revised in place:

| Frame | ID |
| --- | --- |
| 01 Menu — Racer | 5:248 |
| 02 Menu — City | 5:281 |
| 03 Gameplay — Racer | 5:314 |
| 04 Gameplay — City | 5:362 |
| 05 Victory | 5:404 |
| 06 Busted | 5:446 |

Both menus now place CHOOSE YOUR SIDE above bottom RACER / CITY cards with action descriptions. Selection uses the expanded scene, gold or blue card color, border and depth. Written selection badges were removed. PLAY has one centered editable word and no triangle. All visible screen and presentation copy is English.

The concept-style logo, illustration-only scenes and dimensional shells from the previous pass remain. New transparent English VICTORY! and BUSTED! headings and a tire/skid brake icon were generated from the references; gear, pause, clock, beacon and steering symbols were also revised. UI copy, counters, patrol markers and routes remain native editable layers. The city still has three patrols.

## Verification

- Inspected the complete final section export, `overview.png` (1306×1944). Both role states, English copy, label-only PLAY, six reward stars (four earned), control icons, results and bottom actions are visible.
- Victory values 02:14 and 24% render fully after widening the native right-aligned values to84px and using auto-height.
- Inspected eight navigation destinations in Figma's Prototype panel: both role switches, both PLAY buttons and four result actions. Existing shell IDs and destinations were preserved. This verifies configured reactions; a complete live prototype playthrough was not performed.
- Verified dimensions, SHA256 hashes and alpha extrema for all eight foundation assets and three new assets. `manifest.json` contains exact prompts, references and normalized asset metadata; `asset-verification.json` records new asset checks.
- `figma-proof.jpg` is a screenshot of the actual edited Figma section with editor context.
- Figma MCP was unavailable due to its Starter quota. Editing and inspection were completed through the signed-in browser editor; no game runtime files were changed by this design request.

`design-brief.md` and `copy.json` preserve the requested layout and English strings. Previous dimensional artwork is in [2026-10-08/v2](../2026-10-08/v2/README.md).
