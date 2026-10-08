import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TireTracks, buildTrackSegment, createTrackSection, buildSectionSegment, DEFAULT_TRACK_CAPACITY, TRACK_END_FADE_LENGTH, isHardSkid } from '../src/tire-tracks.js';
import { createCityPlan } from '../src/city-generator.js';
import { createSurfaceHeightSampler, ROAD_SURFACE_HEIGHTS } from '../src/road-surface.js';
import { CarSimulation, STEP } from '../src/vehicle.js';

const wheel = (x, z, overrides = {}) => ({
  position: { x, z }, grounded: true, slip: 0.3, lateral: 3.2, longitudinal: 8, ...overrides,
});
const tracks = (capacity = DEFAULT_TRACK_CAPACITY) => new TireTracks(new THREE.Scene(), capacity);
function sample(tracks, positions, options = {}) {
  for (let i = 0; i < positions.length; i++) {
    const wheels = Array.from({ length: 4 }, (_, index) => {
      const [x, z] = positions[i];
      return wheel(x, z, options[index] || {});
    });
    for (let substep = 0; substep < 4; substep++) tracks.update(wheels, options.enabled ?? true, 1 / 120);
  }
}

test('segment cross sections share identical edges and remain finite on straight and curved paths', () => {
  const points = [[0, 0], [1, 0], [1.7, 0.7], [1.5, 1.8]];
  const sections = [];
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    const dx = after[0] - before[0], dz = after[1] - before[1];
    const length = Math.hypot(dx, dz);
    sections.push(createTrackSection({ x: points[i][0], z: points[i][1] }, { x: -dz / length, z: dx / length }));
  }
  const segments = sections.slice(1).map((section, index) => buildSectionSegment(sections[index], section, index, index + 1));
  assert.ok(segments.every(Boolean));
  for (let i = 1; i < segments.length; i++) {
    const previousEnd = segments[i - 1].positions.slice(6, 9);
    const previousEndRight = segments[i - 1].positions.slice(12, 15);
    const nextStart = segments[i].positions.slice(0, 3);
    const nextStartRight = segments[i].positions.slice(3, 6);
    assert.deepEqual(nextStart, previousEnd);
    assert.deepEqual(nextStartRight, previousEndRight);
  }
  const short = buildTrackSegment({ x: 2, z: 3 }, { x: 2, z: 3 }, 0, 0, 1, 1);
  assert.equal(short, null);
  assert.ok(segments.flatMap(s => s.positions).every(Number.isFinite));
  assert.equal(TRACK_END_FADE_LENGTH, 0.5);
});

test('sections follow the visible road and sidewalk elevations, including transitions', () => {
  const height = createSurfaceHeightSampler(createCityPlan());
  assert.ok(Math.abs(height(0, 83.5) - (ROAD_SURFACE_HEIGHTS.sidewalkVisual + 0.004)) < 1e-9);
  assert.ok(Math.abs(height(0, 80) - (ROAD_SURFACE_HEIGHTS.road + 0.004)) < 1e-9);
  assert.ok(Math.abs(height(0, 207) + 0.011) < 1e-9);
  const start = createTrackSection({ x: 0, z: 80 }, { x: 1, z: 0 }, 0.29, height(0, 80));
  const end = createTrackSection({ x: 0, z: 83.5 }, { x: 1, z: 0 }, 0.29, height(0, 83.5));
  const segment = buildSectionSegment(start, end, 0, 1);
  assert.ok(segment.positions.some(value => Math.abs(value - 0.009) < 1e-8));
  assert.ok(segment.positions.some(value => Math.abs(value - (ROAD_SURFACE_HEIGHTS.sidewalkVisual + 0.004)) < 1e-8));
});

test('threshold calibration rejects a measured gentle turn and accepts a sustained physical skid', () => {
  const gentleTracks = tracks(2048), gentleCar = new CarSimulation();
  for (let i = 0; i < 2400; i++) {
    gentleCar.step({ throttle: 0.75, steer: i < 600 ? 0 : 0.18 }, STEP);
    gentleTracks.update(gentleCar.wheels, true, STEP);
  }
  assert.equal(gentleTracks.count, 0);

  const skidTracks = tracks(2048), skidCar = new CarSimulation();
  for (let i = 0; i < 2400; i++) {
    skidCar.step(i < 1200 ? { throttle: 1 } : { throttle: 0.8, steer: 0.3, handbrake: true }, STEP);
    skidTracks.update(skidCar.wheels, true, STEP);
  }
  assert.ok(skidTracks.count > 0, 'a sustained handbrake skid leaves track segments');
  assert.ok([...skidTracks.positions.slice(0, skidTracks.count * 18)].every(Number.isFinite));
});

test('zero movement and invalid positions create no non-finite geometry', () => {
  const t = tracks(8);
  sample(t, [[0, 0], [0, 0], [0, 0], [0, 0]]);
  assert.equal(t.count, 0);
  sample(t, [[1, 0], [NaN, 0], [2, 0], [3, 0]]);
  assert.ok([...t.positions].every(Number.isFinite));
});

test('real discontinuities and disable/reset terminate strips', () => {
  const t = tracks(256);
  sample(t, [[0, 0], [0.2, 0], [0.4, 0], [0.6, 0], [0.8, 0], [1, 0], [1.2, 0], [1.4, 0]]);
  assert.ok(t.count > 0);
  sample(t, [[1.6, 0], [1.8, 0], [2, 0], [2.2, 0], [2.4, 0], [2.6, 0], [2.8, 0], [3, 0]], { 0: { grounded: false } });
  const before = t.count;
  sample(t, [[3.2, 0], [3.4, 0], [3.6, 0], [3.8, 0], [4, 0], [4.2, 0], [4.4, 0], [4.6, 0]], { enabled: false });
  const afterDisable = t.count;
  assert.ok(afterDisable >= before);
  sample(t, [[4.8, 0], [5, 0], [5.2, 0], [5.4, 0]], { enabled: false });
  assert.equal(t.count, afterDisable);
  sample(t, [[5.6, 0], [5.8, 0], [6, 0], [6.2, 0], [6.4, 0], [6.6, 0], [6.8, 0], [7, 0]]);
  assert.ok(t.previous.every(p => p.active));
  t.reset();
  assert.equal(t.count, 0);
  assert.ok(t.previous.every(p => !p.active));
});

test('position jump of at least 4m closes the old strip and starts a fresh one', () => {
  const t = tracks(256);
  sample(t, [[0, 0], [0.2, 0], [0.4, 0], [0.6, 0], [0.8, 0], [1, 0], [1.2, 0], [1.4, 0]]);
  const oldStrip = t.previous[0].strip;
  for (let i = 0; i < 8; i++) sample(t, [[10 + i * 0.2, 0]]);
  assert.notEqual(t.previous[0].strip, oldStrip);
  assert.ok(t.previous[0].strip);
  for (let segment = 0; segment < t.count; segment++) {
    const xs = [];
    for (let vertex = 0; vertex < 6; vertex++) xs.push(t.positions[segment * 18 + vertex * 3]);
    assert.ok(Math.max(...xs) - Math.min(...xs) <= 0.51, 'no segment may bridge the teleport');
  }
});

test('slip hysteresis keeps a strip connected across threshold fluctuations', () => {
  const t = tracks(256);
  for (let i = 0; i < 48; i++) {
    const lateral = i < 3 ? 3 : (i % 2 ? 1.7 : 2.1);
    for (let substep = 0; substep < 4; substep++) t.update(Array.from({ length: 4 }, () => wheel(i * 0.1, 0, { lateral })), true, 1 / 120);
  }
  assert.ok(t.count >= 8, `expected a continuous strip, got ${t.count} segments`);
  assert.ok(t.previous[0].slipping);
});

test('straight acceleration and mild cornering do not leave tracks; sustained hard slides do', () => {
  assert.equal(isHardSkid(wheel(0, 0, { lateral: .2 })), false);
  assert.equal(isHardSkid(wheel(0, 0, { longitudinal: 2 })), false);
  assert.equal(isHardSkid(wheel(0, 0, { grounded: false, lateral: 5 })), false);
  assert.equal(isHardSkid(wheel(0, 0, { detached: true, lateral: 5 })), false);
  const t = tracks(256);
  sample(t, Array.from({ length: 18 }, (_, i) => [i * .15, 0]), { 0: { lateral: .8 }, 1: { lateral: 1.2 }, 2: { lateral: .4 }, 3: { lateral: 1.5 } });
  assert.equal(t.count, 0, 'a routine turn must stay clean');
  sample(t, Array.from({ length: 12 }, (_, i) => [3 + i * .15, .14 * i]), { 0: { lateral: 4 }, 1: { lateral: 3.5 }, 2: { lateral: 4.2 }, 3: { lateral: 3.8 } });
  assert.ok(t.count > 0, 'a sustained slide draws marks after its confirmation delay');
  assert.ok(t.previous.every(point => point.slipping));
});

test('reverse starts a new strip instead of connecting across the direction change', () => {
  const t = tracks(128);
  sample(t, [[0, 0], [0.2, 0], [0.4, 0], [0.6, 0], [0.8, 0], [1, 0], [1.2, 0], [1.4, 0]]);
  const previousStrip = t.previous[0].strip;
  assert.ok(previousStrip?.head >= 0);
  for (let i = 0; i < 4; i++) {
    const wheels = Array.from({ length: 4 }, (_, index) => wheel(1.2 - i * 0.1, index * 2, { longitudinal: -8 }));
    for (let step = 0; step < 4; step++) t.update(wheels, true, 1 / 120);
  }
  assert.notEqual(t.previous[0].strip, previousStrip);
  assert.equal(t.previous[0].direction, -1);
  assert.ok(t.previous[0].slipping);
});

test('simulation time advances with stopped wheels and prepareRender publishes it', () => {
  const t = tracks(32);
  t.update(Array.from({ length: 4 }, () => wheel(0, 0, { longitudinal: 0, slip: 0 })), false, 12);
  t.prepareRender();
  assert.equal(t.material.uniforms.time.value, 12);
});

test('multiple vehicle sources share one clock and retain independent wheel strips', () => {
  const t = tracks(1024);
  for (let step = 0; step < 24; step++) {
    const source = (id, offset) => ({ id, wheels: Array.from({ length: 4 }, (_, index) =>
      wheel(offset + step * 0.2, index * 0.5, { lateral: 5, longitudinal: 12 })) });
    t.updateVehicles([source('police-a', 0), source('police-b', 100)], true, STEP);
  }
  assert.ok(Math.abs(t.time - 24 * STEP) < 1e-12);
  assert.equal(t.sourceStates.size, 3);
  assert.ok(t.count > 0);
  assert.notEqual(t.sourceStates.get('police-a')[0].strip, t.sourceStates.get('police-b')[0].strip);
  assert.ok(t.removeSource('police-a'));
  assert.equal(t.sourceStates.has('police-a'), false);
  t.updateVehicles([{ id: 'police-b', wheels: Array.from({ length: 4 }, (_, index) => wheel(110, index * 0.5)) }], true, STEP);
  assert.equal(t.sourceStates.get('police-a'), undefined);
});

test('prepareRender publishes changed geometry attributes and the bounded draw range', () => {
  const scene = new THREE.Scene();
  const t = new TireTracks(scene, 32);
  sample(t, [[0, 0], [0.2, 0], [0.4, 0], [0.6, 0], [0.8, 0], [1, 0]]);
  t.prepareRender();
  assert.equal(scene.children.filter(child => child === t.mesh).length, 1);
  assert.equal(t.geometry.drawRange.count, t.count * 6);
  for (const name of ['position', 'birth', 'fade']) assert.ok(t.geometry.attributes[name].updateRanges.length > 0, `${name} range was not queued`);
});

test('actual end caps fade, internal joins do not, and age is interpolated per cross section', () => {
  const segment = buildTrackSegment({ x: 0, z: 0 }, { x: 1, z: 0 }, 2, 3, 1, 1, undefined, true, false);
  assert.deepEqual(segment.fades, [0, 0, 1, 0, 1, 1]);
  assert.deepEqual(segment.births, [2, 2, 3, 2, 3, 3]);
  const next = buildTrackSegment({ x: 1, z: 0 }, { x: 2, z: 0 }, 3, 4, 1, 1);
  assert.ok(next.fades.every(v => v === 1));
  assert.equal(DEFAULT_TRACK_CAPACITY, 6000);
});

test('terminal cap uses up to 0.5m and limits short-strip fade to strip length', () => {
  const t = tracks(8);
  const section = createTrackSection({ x: 2, z: 3 }, { x: 1, z: 0 });
  t.births[2] = 4;
  const strip = { head: 0, headPoint: { center: { x: 2, z: 3 }, section },
    headNormal: { x: 1, z: 0 }, headDirection: { x: 0, z: 1 }, length: 0.2 };
  t.endStrip(strip);
  const endZ = t.positions.slice(6, 18).filter((_v, i) => i % 3 === 2);
  assert.ok(Math.max(...endZ) <= 3.201);
  assert.ok(t.fades.slice(0, 6).some(value => value === 0));
  assert.equal(strip.head, -1);
});

test('full live buffer embeds terminal fade without overwriting its visible segment', () => {
  const t = tracks(1);
  t.count = 1; t.cursor = 0; t.time = 10;
  t.births[2] = 2;
  const section = createTrackSection({ x: 0, z: 0 }, { x: 1, z: 0 });
  t.positions.set(buildSectionSegment(section, createTrackSection({ x: 0, z: 0.1 }, { x: 1, z: 0 }), 1, 2).positions);
  t.fades.fill(1);
  const strip = { head: 0, headPoint: { center: { x: 0, z: 0 }, section },
    headNormal: { x: 1, z: 0 }, headDirection: { x: 0, z: 1 }, length: 0.1 };
  t.endStrip(strip);
  assert.equal(t.count, 1);
  assert.equal(t.cursor, 0);
  assert.deepEqual([t.fades[2], t.fades[4], t.fades[5]], [0, 0, 0]);
  assert.ok(t.positions[8] > 0.09);
});

test('four-wheel maximum-rate ring does not overwrite a visible segment before 45 seconds', () => {
  const t = tracks();
  const maxLifetimeSegments = Math.ceil(45 * 30 * 4);
  assert.ok(t.capacity >= maxLifetimeSegments);
  for (let frame = 0; frame < 52 * 30; frame++) {
    const wheels = Array.from({ length: 4 }, (_, i) => wheel(frame * 0.1, i * 2));
    for (let substep = 0; substep < 4; substep++) {
      const willSample = (t.tick + 1) % 4 === 0;
      const oldCursor = t.cursor;
      const oldCount = t.count;
      const slots = Array.from({ length: 4 }, (_, i) => (oldCursor + i) % t.capacity);
      const oldBirths = slots.map(slot => t.births[slot * 6]);
      t.update(wheels, true, 1 / 120);
      if (willSample && oldCount === t.capacity) {
        for (let i = 0; i < 4; i++) {
          assert.ok(t.time - oldBirths[i] >= 45,
            `visible segment would be overwritten at ${t.time}s (age ${t.time - oldBirths[i]}s)`);
        }
      }
    }
  }
  assert.equal(t.count, t.capacity);
  assert.ok(t.cursor > 0 && t.cursor < t.capacity);
});
