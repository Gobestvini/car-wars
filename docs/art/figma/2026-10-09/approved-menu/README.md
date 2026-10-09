# Car Stars — approved menu applied to Figma

Updated existing [Figma screens](https://www.figma.com/design/NllQADLKwk6RK8pMTurKiN/Car-Stars?node-id=6-57) on 2026-10-09.

## Applied changes

- Both menu states use the approved `menu-v3` direction: diagonal scene split, sculpted RACER/CITY titles, a small CHOOSE YOUR SIDE heading with gold/cyan accents, and descriptions below both roles.
- Removed the visible cream heading plate and rectangular role cards. Expanded scene, title color and underline express selection; there is no SELECTED label.
- Imported five separate assets, rather than flattening the menu into one screenshot. Scene illustration, role-title artwork, heading artwork, native descriptions, logo and button remain separate layers.
- PLAY remains editable text without a triangle icon. Existing button shells and their prototype reactions were retained. Role hit areas were moved above the new artwork at y=625, with 105px height.
- Existing hidden menu artwork remains recoverable in the file.

## Typography

The sketch's sculpted letters are custom raster artwork, not an identifiable font. Generated transparent title assets preserve that appearance for RACER/CITY and CHOOSE YOUR SIDE. Existing illustrated logo and result headings remain separate artwork.

Editable text uses Lilita One Regular for PLAY (64px), RACE AGAIN and TRY AGAIN (28px), MAIN MENU (22px), and INTERCEPT (26px). Nunito Black and ExtraBold text was changed to Roboto Black for denser supporting text and game statistics. Role descriptions use Roboto Black 16px with 19px line height. This is a visual approximation of the sketch's supporting typography, not a claim of an exact font match.

## Verification

- `overview.png`: actual PNG exported from the updated Figma section; all six screens visually inspected for English copy, typography and clipping.
- `figma-proof.jpg`: editor screenshot after the changes.
- `prototype-checks.json`: eight existing navigation connections checked in Figma's Prototype sidebar (both role switches, both PLAY buttons, and four result buttons). This checks configured destinations; it is not an end-to-end playthrough of a running game.
- `asset-verification.json`: dimensions, hashes and alpha-channel checks for the five imported assets.
- `manifest.json`: ImageGen prompts, source references and asset hashes. Transparent assets were trimmed with padding; illustration-only backgrounds were retained at generated dimensions.

Figma MCP and native Figma Agents had reached their plan limits, so final edits and export were performed through the browser editor. No game source code was changed in this task.
