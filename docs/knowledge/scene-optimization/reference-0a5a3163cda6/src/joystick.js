export const JOYSTICK_RADIUS = 64;
export const JOYSTICK_DEAD_ZONE = 8;

// Screen displacement from the first touch, independent of car and camera translation.
export function joystickVector(startX, startY, x, y) {
  const dx = x - startX, dy = y - startY;
  const distance = Math.hypot(dx, dy);
  const scale = Math.min(1, JOYSTICK_RADIUS / Math.max(distance, 1));
  return {
    x: distance > JOYSTICK_DEAD_ZONE ? dx / distance : 0,
    y: distance > JOYSTICK_DEAD_ZONE ? dy / distance : 0,
    strength: Math.max(0, Math.min(1, (distance - JOYSTICK_DEAD_ZONE) / (JOYSTICK_RADIUS - JOYSTICK_DEAD_ZONE))),
    knobX: dx * scale, knobY: dy * scale,
  };
}
