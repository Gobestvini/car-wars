# Car Stars: bring all six screens much closer to the concept sketches

Edit the existing selected section `Car Stars · Основные экраны`, ID `6:57`, and its six 390×844 frames **in place**. Keep the screen IDs and prototype links where compatible. Perform the edits; advice alone is not the requested result.

## Asset mapping and editability

- `logo.png`: isolated transparent 3D CAR STARS logo. Use directly; don't re-typeset it.
- `button-gold.png`, `button-blue.png`: isolated transparent blank dimensional button shells. Put separate editable TEXT and vector icons over them.
- `star-gold.png`: dimensional earned star. Make a reusable star component; four earned and two pale silver/unearned in reward/wanted rows.
- `title-victory.png`, `title-defeat.png`: isolated transparent Russian display headings. Use directly.
- `menu-thief.png`, `menu-city.png`: clean illustration-only menu backgrounds, with the correct 70/30 and 30/70 diagonal division and enlarged hero car. No baked UI.
- `01-thief-selected.png` and `04-victory.png`: complete concept references ONLY. **Never place a whole concept UI screenshot into a final screen or flatten an interface.** Every final screen retains native editable copy/counters and semantic UI layers.

Custom logo and sculpted result headlines are intentional artwork layers. Dynamic text, button labels, HUD values, role titles and statistics remain TEXT. Import assets using their uploaded attachment references; don't guess remote URLs or generate substitutes.

## Visual language

Sunny low-poly miniature city; saturated cobalt roofs, peach/yellow facades, cream sidewalks, faceted green trees. Warm cream plates, thick navy edging, broad rounded corners, expressive chunky display letters, glossy upper highlights, visible lower bevels, soft navy cast shadows. Avoid flat dashboard cards, thin letterforms, excessive tracking and minimalist line doodles. Keep bright environment colors; no global dark overlay.

Approximate palette (harmonize to the supplied art): navy `#071C3E`; gold upper `#FFF34D`, lower `#FFC21E`, depth `#D88710`; blue upper `#27C5FF`, lower `#0069FF`, depth `#0049D5`; cream `#FFFCEF` to `#FFF6E2`; coral/red for failure. Use local variables and reusable components. Choose a heavy rounded Cyrillic-compatible font such as Nunito Black or Rubik Black/ExtraBold. All labels must be readable at native scale.

## Menu: frames 5:248 and 5:281

Use the respective clean full menu illustration as a screen-sized scene. Remove the obsolete narrow image polygons/divider so there are no double seams. The selected side takes about 70% of the image; the other side about 30%. Show the large yellow hero car from the clean art. Add the 3D logo centered high, about x63 y22 w264 h145, preserving aspect. Use a compact cream beveled rounded-square settings button at top-right with a real gear silhouette, not a sun symbol.

Put a cream `ВЫБЕРИ СТОРОНУ` capsule below the logo (heavy 16–18px text). The inactive-side capsule belongs higher in the scene, around y220, away from the car.

Remove the current oversized cream Selected role CARD. Instead place a selected badge around y574 h34, a **large cream-white role title on the background itself** around y622 h48 (navy outline and soft extrusion), and a separate cream subtitle capsule around y685 h32. Thief title `УГОНЩИК` 40–44px; subtitle `Уйди от погони`. City title `ПРАВООХРАНИТЕЛЬ` 26–29px, one line within the screen; subtitle `Управляй городом`. Selected badge has a chunky check and `ВЫБРАНО`, gold for thief / blue for city.

Main PLAY at about x18 y734 w354 h86 uses the supplied shell with separately editable heavy `PLAY` text 40–44px and vector triangle, centered as a group. Preserve transparent role hit regions. Changing the role does not start gameplay; PLAY does. Avoid mixing the old flat text/logo with new artwork.

## Victory: frame 5:404

Replace flat outlined heading with the 3D victory title, wide and centered at top with its original ratio. Keep a cream subtitle capsule and current podium/car illustration.

Split the current oversized summary card into two distinct cream beveled cards: reward x24 y406 w342 h190, statistics x24 y608 w342 h82. Reward heading `ЗАРАБОТАНО ЗВЁЗД` 21–23px heavy navy, six separate stars (four gold, two pale silver), huge editable `4 / 6` at 50–56px, then `Награда за заезд`. Reflow carefully, allowing modest dimensional adjustments to avoid clipping.

Statistics: `Время заезда` / `02:14` and `Повреждения` / `24%`, two left/right aligned rows with thin divider. Gold retry about y706 h58 with `ЕЩЁ ЗАЕЗД`; navy-outline cream menu button about y778 h48 with `В ГЛАВНОЕ МЕНЮ`. Labels are large and expressive.

## Defeat: frame 5:446

Use 3D coral defeat title wide at top, cream subtitle `Тебя поймали`, and existing three-car arrest illustration. Cream beveled arrest card about x24 y408 w342 h278. Replace the tiny minimalist shield badge with a prominent vector tire/skid pictogram in coral/navy or another clearly thematic arrest symbol. Headline `АРЕСТОВАН` 34–38px; subtitle `Попробуй другой маршрут`. Two tinted inset statistic strips with proper clock/siren vector icons, editable `01:32` and `4 / 6`. Blue retry shell about y706 h58, editable `ПОПРОБОВАТЬ СНОВА` 19–21px; navy-outline cream menu button below. Echo the concept hierarchy rather than a generic card stack.

## Thief gameplay: frame 5:314

Keep current gameplay illustration. Bevel cream HUD plates with subtle white rims, cream/beige lower edges and soft shadows. Use rounded heavy typography and a navy wanted panel with matching inset rim, dimensional earned stars and pale silver unearned stars. Speed remains 112 km/h, wanted 4/6, car condition 76%.

Joystick: clearly visible translucent outer ring with white outline, dimensional cream thumb and directional vector hints. No opaque circle and no disappearing outer ring. Brake: cream beveled round control with a recognizable tire/skid icon; replace ambiguous line doodle. Do not block the car/action focal point.

## City gameplay: frame 5:362

The role manages THE CITY, not one individual cop. Keep three dispersed patrols, cyan editable routes and a target ring. Bevel cream HUD and the selected-patrol card; polish navy/blue labels and use the blue shell for the command button. Keep readable `ПАТРУЛЬ 02`, `В ПОГОНЕ`, instructions and patrol/time values. Buttons/copy stay separate editable layers.

## Validation

Inspect the full section after editing. Verify six 390×844 frames, no blank images, no opaque hit areas, no clipped/overlapping text, no stretched logo/stars, correct alpha and no complete-UI raster. Check fonts and component connections. Return modified frame/section IDs and report actual changes. Keep previous native editable content whenever possible; do not delete screens or create a flat replacement screenshot board.
