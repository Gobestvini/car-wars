# Car Stars loading screen

## Revision 2

User-requested art correction: street trees rooted in sidewalk beds, bare blue
roofs, restrained smoke at the rear tire contact area, short trails behind the
rear tires, and a clean foreground road. Two built-in ImageGen edit passes.
Selected source: `background-v2.png` (887×1774); production asset:
`public/ui/loading/background-v2.webp` (173,002 bytes). The original source is
retained for history. Exact edit prompts are in the runtime manifest. New asset
URL is used for both the foreground and ambient layer to avoid stale caches.

Generated 2026-10-09 with the built-in ImageGen tool, then implemented with
native DOM text, progress and controls. No external stock art was used.
Reference: `docs/art/verification/start-screen-2026-10-09/racer-390x844.jpg`.
The user requested drawing the screen and then adding it to the game; this
direction preserves the approved sunny low-poly miniature city, yellow racer,
blue-roof buildings, faceted green trees and gold/navy UI.

## Technical brief

- Browser/Three.js game; DOM loading overlay before scene preparation.
- Opaque portrait 887×1774 source, 1:2 composition; native preview 390×844.
- Upper logo reserve, central pursuit illustration, uncluttered lower UI reserve.
- Gold action/progress, navy depth, warm cream highlights, cyan/blue city accents.
- Static background, animated native bar; no collision or physics role.
- Source PNG is retained unchanged; runtime WebP quality 90/method 6, 196,190 bytes.
- Existing logo reused. Lilita One heading, Roboto Black status, existing OFL fonts.
- Native progress derives from resource download and completed preparation stages;
  no timer-generated fake progress and no long minimum loading time.
- Motion: gold sheen and short progress/fade transitions; reduced-motion support.
- See `public/ui/loading/manifest.json` and the browser verification directory.
