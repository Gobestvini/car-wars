# Дальний обзор дороги

## Визуальный ориентир

Rockstar's [GTA 2 page](https://www.rockstargames.com/games/gta2) identifies the original game, and gameplay reference frames are available from the [GTA 2 screenshot archive](https://www.mobygames.com/game/1097/grand-theft-auto-2/screenshots/). The early games use a high, overhead view that keeps street layout and nearby junctions readable. CarWars remains a perspective chase camera: it borrows the readable road preview, not the original camera angle or formulas.

## CarWars implementation

`src/main.js:updateCamera()` retains a fixed yaw and perspective projection, increases the camera offset by 1.35, and aims ahead along the car's longitudinal travel direction. `src/camera-distance.js` smooths signed look-ahead with dt, limits it to 40 m, and raises speed zoom to 1.7. Reverse looks behind the chassis; stationary look-ahead returns to zero. The look direction deliberately ignores lateral tire velocity so a skid does not swing the view sideways.

The scale factors, 28 m bound, and speed-to-distance coefficient are CarWars tuning choices, not extracted GTA values.
