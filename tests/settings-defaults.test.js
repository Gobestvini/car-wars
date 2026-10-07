import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSettingsDefaults, readSettingsDefaults, saveSettingsDefaults, SETTINGS_DEFAULTS_KEY } from '../src/settings-defaults.js';

const defaults = { softness: 0.45, grip: 1.8, power: 1, quality: 'Высокая', trails: true,
  roadWidth: 15, trafficCount: 60, skidThreshold: 1.25, trackIntensity: 1,
  cameraSpeed: 15, drawDistanceFollow: 200, drawDistanceFree: 600 };
const memoryStorage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key), data };
};

test('saved defaults persist only validated user settings and can be cleared', () => {
  const storage = memoryStorage();
  assert.equal(saveSettingsDefaults(storage, { ...defaults, roadWidth: 18, grip: 0.65, trails: false,
    debugMode: true, cameraMode: 'free', trafficActual: 17 }, defaults), true);
  const profile = JSON.parse(storage.getItem(SETTINGS_DEFAULTS_KEY));
  assert.equal(profile.version, 1);
  assert.deepEqual(profile.values, { ...defaults, roadWidth: 18, grip: 0.65, trails: false });
  assert.deepEqual(readSettingsDefaults(storage, defaults), profile.values);
  assert.equal(clearSettingsDefaults(storage), true);
  assert.equal(storage.getItem(SETTINGS_DEFAULTS_KEY), null);
});

test('draw distance is persisted independently per camera mode and invalid values fall back', () => {
  const storage = memoryStorage();
  saveSettingsDefaults(storage, { ...defaults, drawDistanceFollow: 340, drawDistanceFree: 910 }, defaults);
  assert.deepEqual(readSettingsDefaults(storage, defaults), { ...defaults, drawDistanceFollow: 340, drawDistanceFree: 910 });
  storage.setItem(SETTINGS_DEFAULTS_KEY, JSON.stringify({ version: 1, values: {
    drawDistanceFollow: 345, drawDistanceFree: 1200,
  } }));
  assert.deepEqual(readSettingsDefaults(storage, defaults), defaults);
});

test('missing or invalid fields use their own factory fallback', () => {
  const storage = memoryStorage();
  storage.setItem(SETTINGS_DEFAULTS_KEY, JSON.stringify({ version: 1, values: {
    roadWidth: 31, trafficCount: -1, grip: Number.NaN, quality: 'ultra', trails: false, cameraSpeed: 23,
  } }));
  assert.deepEqual(readSettingsDefaults(storage, defaults), { ...defaults, trails: false, cameraSpeed: 23 });
});

test('unsupported versions, corrupt JSON, and unavailable storage safely fall back', () => {
  const storage = memoryStorage();
  storage.setItem(SETTINGS_DEFAULTS_KEY, JSON.stringify({ version: 2, values: { roadWidth: 30 } }));
  assert.deepEqual(readSettingsDefaults(storage, defaults), defaults);
  storage.setItem(SETTINGS_DEFAULTS_KEY, '{');
  assert.deepEqual(readSettingsDefaults(storage, defaults), defaults);
  assert.deepEqual(readSettingsDefaults({ getItem() { throw new Error('denied'); } }, defaults), defaults);
  assert.equal(saveSettingsDefaults({ setItem() { throw new Error('denied'); } }, defaults, defaults), false);
  assert.equal(clearSettingsDefaults({ removeItem() { throw new Error('denied'); } }), false);
});

test('skid controls validate, persist, and default for profiles created before the controls existed', () => {
  const storage = memoryStorage();
  storage.setItem(SETTINGS_DEFAULTS_KEY, JSON.stringify({ version: 1, values: { trails: false } }));
  assert.deepEqual(readSettingsDefaults(storage, defaults), { ...defaults, trails: false });
  assert.equal(saveSettingsDefaults(storage, { ...defaults, skidThreshold: 2, trackIntensity: 0.35 }, defaults), true);
  assert.deepEqual(readSettingsDefaults(storage, defaults), { ...defaults, skidThreshold: 2, trackIntensity: 0.35 });
  storage.setItem(SETTINGS_DEFAULTS_KEY, JSON.stringify({ version: 1,
    values: { skidThreshold: 1.23, trackIntensity: 1.5 } }));
  assert.deepEqual(readSettingsDefaults(storage, defaults), defaults);
});
