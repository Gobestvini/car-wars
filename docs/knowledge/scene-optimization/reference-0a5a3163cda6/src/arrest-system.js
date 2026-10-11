const DEFAULTS = Object.freeze({ stoppedSpeed: 0.5, stoppedHoldSeconds: 2,
  startRadius: 6, breakSpeed: 1.5, breakRadius: 8, policeSpeed: 2, durationSeconds: 5 });

const finite = value => Number.isFinite(value);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const ARREST_CONFIG = DEFAULTS;

/** Pure fixed-step arrest FSM. Police must be physical, assigned, nearby and unobstructed. */
export function createArrestSystem(config = {}) {
  const settings = { ...DEFAULTS, ...config };
  let state = 'idle';
  let holdTime = 0;
  let elapsed = 0;
  let arrestedEventPending = false;
  let cancellationReason = null;
  let nearbyPoliceIds = [];

  const snapshot = () => ({ state, progress: state === 'arresting' ? Math.min(1, elapsed / settings.durationSeconds) : 0,
    remainingSeconds: state === 'arresting' ? Math.max(0, settings.durationSeconds - elapsed) : settings.durationSeconds,
    holdProgress: state === 'holding' ? Math.min(1, holdTime / settings.stoppedHoldSeconds) : 0,
    nearbyPoliceIds: [...nearbyPoliceIds], cancellationReason });
  const clearAttempt = reason => {
    state = 'idle'; holdTime = 0; elapsed = 0; nearbyPoliceIds = [];
    cancellationReason = reason || null;
  };

  return {
    reset() {
      clearAttempt(null); arrestedEventPending = false; return snapshot();
    },
    snapshot,
    update(dt, { wantedLevel = 0, player, police = [], enabled = true, damage = 0 } = {}) {
      if (!finite(dt) || dt < 0) return { ...snapshot(), completed: false };
      if (state === 'arrested') return { ...snapshot(), completed: false };
      if (!enabled) { if (state !== 'idle') clearAttempt('disabled'); return { ...snapshot(), completed: false }; }
      if (wantedLevel < 1) { if (state !== 'idle') clearAttempt('no-wanted-level'); return { ...snapshot(), completed: false }; }
      if (damage >= 1) { if (state !== 'idle') clearAttempt('vehicle-destroyed'); return { ...snapshot(), completed: false }; }
      if (!player || !finite(player.x) || !finite(player.z) || !finite(player.speed)) {
        if (state !== 'idle') clearAttempt('invalid-player');
        return { ...snapshot(), completed: false };
      }

      const candidates = police.filter(unit => unit && unit.id && unit.role === 'police' && unit.operational !== false
        && (!finite(unit.damage) || unit.damage < 1)
        && unit.targetId === 'player' && !unit.logical && unit.clearPath !== false
        && finite(unit.x) && finite(unit.z) && finite(unit.speed) && unit.speed <= settings.policeSpeed);
      const within = radius => candidates.filter(unit => distance(player, unit) <= radius);
      const nearby = state === 'arresting' ? within(settings.breakRadius) : within(settings.startRadius);
      nearbyPoliceIds = nearby.map(unit => unit.id);

      if (state === 'idle') {
        cancellationReason = null;
        if (player.speed < settings.stoppedSpeed && nearby.length) {
          state = 'holding'; holdTime = dt;
        }
      } else if (state === 'holding') {
        if (player.speed >= settings.stoppedSpeed || !nearby.length) clearAttempt('hold-interrupted');
        else {
          holdTime += dt;
          if (holdTime >= settings.stoppedHoldSeconds) { state = 'arresting'; elapsed = 0; }
        }
      } else if (state === 'arresting') {
        if (player.speed >= settings.breakSpeed) clearAttempt('escaped');
        else if (!nearby.length) clearAttempt('police-lost');
        else {
          elapsed += dt;
          if (elapsed >= settings.durationSeconds) {
            state = 'arrested'; elapsed = settings.durationSeconds;
            cancellationReason = null; arrestedEventPending = true;
          }
        }
      }

      const completed = arrestedEventPending;
      arrestedEventPending = false;
      return { ...snapshot(), completed };
    },
  };
}
