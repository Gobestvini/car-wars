export const CAMERA_SPEED_MIN_KMH = 15;
export const CAMERA_SPEED_MAX_KMH = 110;
export const CAMERA_MAX_SCALE = 1.7;
export const CAMERA_ZOOM_OUT_RATE = 2.5;
export const CAMERA_ZOOM_IN_RATE = 1.8;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function targetCameraScale(speedKmh) {
  const speed = Number.isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  const t = clamp((speed - CAMERA_SPEED_MIN_KMH) / (CAMERA_SPEED_MAX_KMH - CAMERA_SPEED_MIN_KMH), 0, 1);
  const eased = t * t * (3 - 2 * t);
  return 1 + (CAMERA_MAX_SCALE - 1) * eased;
}

export function smoothCameraScale(currentScale, targetScale, dt) {
  const current = Number.isFinite(currentScale) ? clamp(currentScale, 1, CAMERA_MAX_SCALE) : 1;
  const target = Number.isFinite(targetScale) ? clamp(targetScale, 1, CAMERA_MAX_SCALE) : 1;
  const deltaTime = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  if (deltaTime === 0 || current === target) return current;
  const rate = target > current ? CAMERA_ZOOM_OUT_RATE : CAMERA_ZOOM_IN_RATE;
  const alpha = 1 - Math.exp(-rate * deltaTime);
  return clamp(current + (target - current) * alpha, 1, CAMERA_MAX_SCALE);
}
