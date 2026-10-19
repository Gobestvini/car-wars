# Дальний обзор дороги

## Визуальный ориентир

Rockstar's [GTA 2 page](https://www.rockstargames.com/games/gta2) identifies the original game, and gameplay reference frames are available from the [GTA 2 screenshot archive](https://www.mobygames.com/game/1097/grand-theft-auto-2/screenshots/). The early games use a high, overhead view that keeps street layout and nearby junctions readable. CarWars remains a perspective chase camera: it borrows the readable road preview, not the original camera angle or formulas.

## CarWars implementation

Verified 2026-10-19 for TASK-0107: `src/camera-follow.js:followCameraPose()` now supplies the same composition to offline `updateCamera()` and the online renderer. The shared effective FOV is 50 degrees (FOLLOW_CAMERA_FOV), including initialization and resize. It aims at `(displayedCar.x, 0.5, displayedCar.z)` with the fixed `(12,20,-17)` offset multiplied by `1.4 * speedScale * viewportScale`. The viewport factor is 1.05 below 700 px width, otherwise 0.82 below 500 px height, otherwise 1. Speed scale remains 1…1.7 over 15…110 km/h with the existing exponential smoothing in `camera-distance.js`. There is no directional look-ahead in the current implementation; the earlier note describing it was stale.

Problem → cause → working method: online framing was closer and ignored viewport changes because it duplicated a different camera formula. Share the ground aim/offset calculation, follow the displayed predicted chassis, and reset zoom on a new subject/generation or room welcome. Avoid adding another position filter on top of prediction.

Verification: numerical composition and 30/60/120 FPS tests, real Edge WebGL at 1440×900, 390×844 and 844×390; three clients, controls including emulated touch, collisions, respawn, room replacement and reconnect. [Before/after evidence](multiplayer/2026-10-19-camera/after.json). Screenshots in the same directory show the viewport results. This is desktop browser/emulated viewport evidence, not a physical-phone or input-to-display measurement. Coefficients are CarWars tuning choices, not GTA formulas.

QA correction, 2026-10-19: checking constructor defaults alone missed offline resize() overriding FOV 38 with 50. Equal camera position/target did not mean equal framing: online screen length was 35.4256% larger. The projection regression in tests/camera-composition-browser.cjs now waits for loading completion, pins the same displayed chassis pose/speed, and fails unless offline/online screen position and 4.4 m chassis projection agree at 0/110 km/h in all three viewports. Historical failure evidence remains in qa-0107-0108/; corrected evidence is in multiplayer/2026-10-19-camera/composition/.
