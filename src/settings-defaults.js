import { ROAD_WIDTH_LIMITS } from './city-generator.js';

export const SETTINGS_DEFAULTS_KEY = 'carwars.defaults.v1';

const fieldRules = {
  softness: { min: 0, max: 1 },
  grip: { min: 0.55, max: 1.8 },
  power: { min: 0.5, max: 1.6 },
  roadWidth: ROAD_WIDTH_LIMITS,
  trafficCount: { min: 0, max: 300, step: 1 },
  skidThreshold: { min: 0.5, max: 3, step: 0.05 },
  trackIntensity: { min: 0, max: 1, step: 0.01 },
  cameraSpeed: { min: 2, max: 50, step: 1 },
  drawDistanceFollow: { min: 100, max: 1000, step: 10 },
  drawDistanceFree: { min: 100, max: 1000, step: 10 },
};

function normalizeValues(values, defaults) {
  const normalized = { ...defaults };
  for (const [key, rule] of Object.entries(fieldRules)) {
    const value = values?.[key];
    if (Number.isFinite(value) && value >= rule.min && value <= rule.max
      && Math.abs((value - rule.min) / (rule.step || 0.01) - Math.round((value - rule.min) / (rule.step || 0.01))) < 1e-8) normalized[key] = value;
  }
  if (values?.quality === 'Высокая' || values?.quality === 'Лёгкая') normalized.quality = values.quality;
  if (typeof values?.trails === 'boolean') normalized.trails = values.trails;
  return normalized;
}

export function readSettingsDefaults(storage, defaults) {
  const fallback = { ...defaults };
  try {
    const raw = storage?.getItem(SETTINGS_DEFAULTS_KEY);
    if (!raw) return fallback;
    const profile = JSON.parse(raw);
    if (profile?.version !== 1 || !profile.values || typeof profile.values !== 'object') return fallback;
    return normalizeValues(profile.values, fallback);
  } catch {
    return fallback;
  }
}

export function saveSettingsDefaults(storage, values, defaults) {
  try {
    if (!storage?.setItem) return false;
    const normalized = normalizeValues(values, defaults);
    const allowedValues = Object.fromEntries(Object.keys(defaults).map(key => [key, normalized[key]]));
    storage.setItem(SETTINGS_DEFAULTS_KEY, JSON.stringify({ version: 1, values: allowedValues }));
    return true;
  } catch {
    return false;
  }
}

export function clearSettingsDefaults(storage) {
  try {
    if (!storage?.removeItem) return false;
    storage.removeItem(SETTINGS_DEFAULTS_KEY);
    return true;
  } catch {
    return false;
  }
}
