import { CAMERA_MAX_SCALE, smoothCameraScale, targetCameraScale } from './camera-distance.js';

const finite = value => Number.isFinite(value) ? value : 0;
// Offline resize historically applies 50 degrees, overriding its old 38-degree
// constructor. Keep the effective projection shared as well as the pose.
export const FOLLOW_CAMERA_FOV = 50;

// Shared offline/online composition. The displayed chassis supplies X/Z; its
// suspension height and yaw deliberately do not move the ground-level aim.
export function followCameraPose(car, scale, width, height, position, target) {
  const viewportScale = width < 700 ? 1.05 : height < 500 ? 0.82 : 1;
  const distance = Math.max(1, Math.min(CAMERA_MAX_SCALE, Number.isFinite(scale) ? scale : 1)) * 1.4 * viewportScale;
  target.x = finite(car.x); target.y = .5; target.z = finite(car.z);
  position.x = target.x + 12 * distance;
  position.y = target.y + 20 * distance;
  position.z = target.z - 17 * distance;
}

export class FollowCamera {
  constructor() {
    this.position = { x: 0, y: 0, z: 0 };
    this.target = { x: 0, y: .5, z: 0 };
    this.reset();
  }
  reset() { this.subject = null; this.scale = 1; }
  update(car, speedKmh, dt, width, height, subject) {
    if (this.subject !== subject) { this.reset(); this.subject = subject; }
    else this.scale = smoothCameraScale(this.scale, targetCameraScale(speedKmh), dt);
    followCameraPose(car, this.scale, width, height, this.position, this.target);
    return this;
  }
}
