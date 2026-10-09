const PROFILES = Object.freeze([
  Object.freeze({ level: 0, maxSpeed: 0, leadSeconds: 0, ramDistance: 0, canMaintainBlock: false }),
  Object.freeze({ level: 1, maxSpeed: 22, leadSeconds: 0.15, ramDistance: 0, canMaintainBlock: false }),
  Object.freeze({ level: 2, maxSpeed: 28, leadSeconds: 0.25, ramDistance: 0, canMaintainBlock: false }),
  Object.freeze({ level: 3, maxSpeed: 34, leadSeconds: 0.35, ramDistance: 6, canMaintainBlock: true }),
  Object.freeze({ level: 4, maxSpeed: 40, leadSeconds: 0.45, ramDistance: 8, canMaintainBlock: true }),
  Object.freeze({ level: 5, maxSpeed: 45, leadSeconds: 0.5, ramDistance: 10, canMaintainBlock: true }),
  Object.freeze({ level: 6, maxSpeed: 50, leadSeconds: 0.55, ramDistance: 12, canMaintainBlock: true }),
]);

export function normalizeWantedLevel(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(6, Math.floor(value))) : 0;
}

export function getPoliceIntensity(value) {
  return PROFILES[normalizeWantedLevel(value)];
}
