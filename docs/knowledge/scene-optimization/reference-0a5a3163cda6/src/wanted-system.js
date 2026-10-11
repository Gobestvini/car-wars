const MAX_LEVEL = 6;
const WARNING_SECONDS = 10;
const OFFENSE_COOLDOWN = 0.5;
const PRIORITY = Object.freeze({
  'police-collision': 4,
  'civilian-collision': 3,
  'red-light': 2,
  speeding: 1,
});

export const WANTED_CONFIG = Object.freeze({
  stars: MAX_LEVEL,
  warningSeconds: WARNING_SECONDS,
  eventCooldownSeconds: OFFENSE_COOLDOWN,
});

export function createWantedSystem(config = {}) {
  const warningSeconds = Number.isFinite(config.warningSeconds) && config.warningSeconds > 0
    ? config.warningSeconds : WARNING_SECONDS;
  const eventCooldownSeconds = Number.isFinite(config.eventCooldownSeconds) && config.eventCooldownSeconds >= 0
    ? config.eventCooldownSeconds : OFFENSE_COOLDOWN;
  let level = 0;
  let clock = 0;
  let warningDeadline = null;
  let lastAcceptedAt = -Infinity;
  let lastViolation = null;

  const snapshot = () => ({
    level,
    stars: Array.from({ length: MAX_LEVEL }, (_, index) => index < level ? 'filled'
      : warningDeadline !== null && index === level ? 'pending' : 'empty'),
    pendingStar: warningDeadline !== null ? level + 1 : null,
    warningRemaining: warningDeadline === null ? 0 : Math.max(0, warningDeadline - clock),
    lastViolation,
    lastAcceptedAt: Number.isFinite(lastAcceptedAt) ? lastAcceptedAt : null,
  });

  return {
    reset() {
      level = 0;
      clock = 0;
      warningDeadline = null;
      lastAcceptedAt = -Infinity;
      lastViolation = null;
      return snapshot();
    },
    snapshot,
    update(dt, violations = []) {
      if (!Number.isFinite(dt) || dt < 0) return snapshot();
      clock += dt;

      // Expire first. An offense exactly on the deadline starts a fresh warning.
      if (warningDeadline !== null && clock >= warningDeadline) warningDeadline = null;
      if (level >= MAX_LEVEL || !Array.isArray(violations)) return snapshot();

      const event = violations
        .filter(item => item && Object.hasOwn(PRIORITY, item.type))
        .sort((a, b) => PRIORITY[b.type] - PRIORITY[a.type])[0];
      if (!event || clock - lastAcceptedAt + 1e-9 < eventCooldownSeconds) return snapshot();

      lastAcceptedAt = clock;
      lastViolation = event.type;
      if (warningDeadline === null) {
        warningDeadline = clock + warningSeconds;
      } else {
        level++;
        warningDeadline = null;
      }
      return snapshot();
    },
  };
}
