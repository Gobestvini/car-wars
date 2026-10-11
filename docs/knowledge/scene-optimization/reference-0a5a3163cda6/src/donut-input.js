const TAU = Math.PI * 2;
const wrapAngle = value => Math.atan2(Math.sin(value), Math.cos(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const DONUT_ENTRY_SPEED_KMH = 60;
export const DONUT_GESTURE_MIN_STRENGTH = 0.55;
export const DONUT_GESTURE_ANGLE = Math.PI / 2;
export const DONUT_GESTURE_WINDOW_SECONDS = 1.2;
export const DONUT_ACTIVE_MIN_STRENGTH = 0.3;
export const DONUT_IDLE_TIMEOUT_SECONDS = 0.7;

export class DonutGesture {
  constructor() { this.reset(); }

  reset() {
    this.enabled = false;
    this.active = false;
    this.previousAngle = null;
    this.accumulatedAngle = 0;
    this.startedAt = 0;
    this.lastMovementAt = 0;
    this.direction = 0;
  }

  begin() {
    this.reset();
    this.enabled = true;
  }

  update(angle, strength, speedKmh, now) {
    if (!this.enabled || !Number.isFinite(angle) || !Number.isFinite(now)) return this.snapshot();
    if (this.active) {
      if (strength < DONUT_ACTIVE_MIN_STRENGTH) return this.cancel();
      const delta = wrapAngle(angle - this.previousAngle);
      this.previousAngle = angle;
      if (Math.abs(delta) > 0.02) this.lastMovementAt = now;
      if (now - this.lastMovementAt > DONUT_IDLE_TIMEOUT_SECONDS) return this.cancel();
      return this.snapshot();
    }
    if (strength < DONUT_GESTURE_MIN_STRENGTH || Math.abs(speedKmh) > DONUT_ENTRY_SPEED_KMH) {
      this.previousAngle = null;
      this.accumulatedAngle = 0;
      return this.snapshot();
    }
    if (this.previousAngle === null || now - this.startedAt > DONUT_GESTURE_WINDOW_SECONDS) {
      this.previousAngle = angle;
      this.startedAt = this.lastMovementAt = now;
      this.accumulatedAngle = 0;
      return this.snapshot();
    }
    const delta = wrapAngle(angle - this.previousAngle);
    this.previousAngle = angle;
    if (Math.abs(delta) > 0.02) {
      this.accumulatedAngle += delta;
      this.lastMovementAt = now;
    }
    if (Math.abs(this.accumulatedAngle) >= DONUT_GESTURE_ANGLE && now - this.startedAt <= DONUT_GESTURE_WINDOW_SECONDS) {
      this.active = true;
      this.direction = Math.sign(this.accumulatedAngle);
    }
    return this.snapshot();
  }

  read(strength, now) {
    if (this.active && (strength < DONUT_ACTIVE_MIN_STRENGTH || now - this.lastMovementAt > DONUT_IDLE_TIMEOUT_SECONDS)) this.cancel();
    return this.snapshot();
  }

  cancel() {
    this.reset();
    return this.snapshot();
  }

  snapshot() {
    return { active: this.active, direction: this.direction, accumulatedAngle: this.accumulatedAngle };
  }
}

export function donutDriveInput(direction, strength) {
  if (!direction || strength < 0.4) return { steer: 0, throttle: 0, brake: 0.18, handbrake: false };
  const normalizedStrength = clamp(strength, 0.75, 1);
  return {
    steer: -Math.sign(direction),
    throttle: 0.55 + (normalizedStrength - 0.75) * 0.4,
    brake: 0,
    handbrake: false,
  };
}
