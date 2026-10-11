const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const angle = value => Math.atan2(Math.sin(value), Math.cos(value));

// Reverse engages only inside a narrow sector centred on the car's rear axis.
export const REVERSE_DIRECTION_TOLERANCE = Math.PI * 0.15;
const REVERSE_ALIGNMENT_THRESHOLD = -Math.cos(REVERSE_DIRECTION_TOLERANCE);

// Hysteresis prevents forward/reverse chatter near a sideways joystick direction.
export function directionalInput(targetHeading, heading, signedSpeed, strength, previousDirection = 1, { mode = 'normal', cornerAssist = true } = {}) {
  if (strength <= 0) return { steer: 0, throttle: 0, brake: 0.18, handbrake: false, direction: previousDirection };
  const alignment = Math.cos(angle(targetHeading - heading));
  let direction = previousDirection;
  const requestsReverse = alignment < REVERSE_ALIGNMENT_THRESHOLD;
  if (mode === 'normal') {
    if (requestsReverse) direction = -1;
    else if (alignment > 0.35) direction = 1;
  }
  const desiredHeading = targetHeading + (direction < 0 ? Math.PI : 0);
  const error = angle(desiredHeading - heading);
  const steer = clamp(error * 2.3 * direction, -1, 1);
  const turnDemand = clamp(Math.abs(error) / (Math.PI / 2), 0, 1);
  const cornerFactor = mode === 'normal' && cornerAssist ? 1 - 0.72 * turnDemand : 1 - 0.55 * Math.min(Math.abs(error) / Math.PI, 1);
  const desiredSpeed = (direction > 0 ? 38 : 16) * strength * cornerFactor;
  const travelSpeed = signedSpeed * direction;
  // Always brake the current motion before applying torque in the opposite direction.
  if (travelSpeed < -0.5) return { steer, throttle: 0, brake: 0.65, handbrake: mode === 'drift', direction };
  return {
    steer, throttle: direction * clamp((desiredSpeed - travelSpeed) * 0.4, 0, 1),
    brake: clamp((travelSpeed - desiredSpeed) * (mode === 'normal' && cornerAssist ? 0.3 : 0.16), 0, mode === 'normal' && cornerAssist ? 0.9 : 0.6),
    handbrake: mode === 'drift', direction,
  };
}
