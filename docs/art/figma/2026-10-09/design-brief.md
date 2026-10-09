# Car Stars — English UI revision

Apply changes to all SIX existing 390×844 frames in section 6:57, preserving IDs 5:248, 5:281, 5:314, 5:362, 5:404, 5:446. Edit native Figma UI, never replace screens with flattened mockups. Current dimensional logo, clean illustration-only backgrounds, tactile button shells, palette and heavy Nunito family are the established visual direction.

## Menus — essential layout

Both menus must show BOTH roles at the BOTTOM, below the heading CHOOSE YOUR SIDE. Remove the old heading under the logo, floating CITY capsule, old giant thief title, subtitle and SELECTED badge. No visible Russian or THIEF remains.

Retain centered dimensional CAR STARS logo at top and gear control. Retain clean diagonal 70/30 hero scenes: selected role occupies the larger area. The city menu now has the correct imported menu-city illustration rectangle 9:80; retain it.

Suggested bottom layout in each 390×844 frame:

- CHOOSE YOUR SIDE centered at y548, about 24px heavy navy in a compact cream plate.
- Two cards at y592, height116, x18 width172 and x200 width172. Both are fully readable and have generous interior padding.
- Left card title RACER; description on two lines: Outrun patrols. / Earn stars.
- Right card title CITY; description on two lines: Command patrols. / Catch the racer.
- Titles 24px Black, descriptions 14px ExtraBold, native editable text.
- Active card uses gold for RACER, cyan/blue for CITY, stronger border and subtle lift/glow. Inactive card uses cream, quieter edging. No SELECTED text, badge, checkmark or extra written status. Selection is communicated by card treatment and 70/30 artwork expansion.
- Large PLAY button at x18 y734 width354 height86. Retain dimensional shell; ONE centered native PLAY label, 42px heavy navy/cream. REMOVE the triangle/play icon entirely, including invisible leftover spacing.
- Role cards switch to the corresponding selected menu. PLAY opens the selected role's gameplay.

## English copy for every screen

Translate all visible text, including presentation headings and screen captions, into English. Rename the frames 01 Menu — Racer, 02 Menu — City, 03 Gameplay — Racer, 04 Gameplay — City, 05 Victory, 06 Busted. English labels in the presentation too.

Racer gameplay: RACER, SPEED · KM/H, 112, WANTED, 4 / 6, OUTRUN THE PATROLS, CONDITION, 76%, BRAKE. Keep all numbers editable. Clear navy pause bars and chunky cream/navy steering arrows.

City gameplay: PATROLS, TIME, INTERCEPT THE RACER, TARGET, PATROL 02, IN PURSUIT, Select a patrol and set a route., INTERCEPT. Retain three patrol markers 01/02/03, cyan routes, target ring. City player commands the city and patrols, not one policeman.

Victory: replace Russian heading artwork with attached title-victory-en.png (exact VICTORY!). Subtitle YOU ESCAPED THE CHASE. Reward card STARS EARNED, four gold stars and two silver stars, large native 4 / 6, Race reward. Statistics Race time 02:14, Damage 24%. Buttons RACE AGAIN and MAIN MENU.

Busted: replace Russian heading artwork with attached title-busted-en.png (exact BUSTED!). Subtitle THE PATROLS CAUGHT YOU. Main card CAUGHT, Try a different route. Statistics Race time 01:32, Wanted 4 / 6. Buttons TRY AGAIN and MAIN MENU.

## Icons — match attached concept references

Use supplied icon-brake.png (navy tire, cream five-spoke hub, gold sidewall, two skid marks) inside the brake control. Replace the current abstract brake symbol. Match the conceptual sketch's bold, tactile visual family: gear has chunky filled navy teeth and cream center; pause has two thick rounded navy bars; clock has cream dial, navy edge and thick hands; police beacon has clear blue/red halves and navy base. Avoid thin outlines, medical-cross shapes, unrelated foot symbols. All control plates share cream face, thick navy edge, slight gold/blue depth and soft shadow. Individual bitmap artwork is permitted; labels and layout remain native.

## Preserve and check

Keep existing button reactions on shell nodes: 12:68 → 5:314; 12:118 → 5:362; 12:90 → 5:314; 12:93 → 5:248; 12:139 → 5:314; 12:142 → 5:248. Do not rebuild these shells or clear reactions. Preserve existing role hit areas, update card hit areas if needed.

Fix existing clipped final digits in victory statistics 02:14 and 24%. Use native right-aligned value text with at least80px width and correct auto-height, ensure full glyphs fit. Inspect every frame for bounds, overlap, line breaks, tiny illegible copy, image stretching, old Russian headings or duplicate labels. Show all six frames after completion. Report actual changes, frame IDs and any remaining limitation candidly.
