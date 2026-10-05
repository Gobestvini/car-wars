import * as THREE from 'three';

export const DEFAULT_TRACK_CAPACITY = 6000;
export const TRACK_WIDTH = 0.29;
export const TRACK_END_FADE_LENGTH = 0.5;
export const TRACK_LIFETIME = 45;
const MIN_POINT_DISTANCE = 0.08;
const MAX_POINT_DISTANCE = 4;
export const SKID_START_SPEED = 6;
export const SKID_START_LATERAL = 2.2;
export const SKID_START_ANGLE = 0.28;
const SKID_CONTINUE_SPEED = 4;
const SKID_CONTINUE_LATERAL = 1.5;
const SKID_CONTINUE_ANGLE = 0.20;
const SKID_CONFIRM_TIME = 0.08;
const SKID_RELEASE_TIME = 0.12;

export function isHardSkid(wheel, continuing = false) {
  const speed = Math.abs(wheel?.longitudinal || 0);
  const lateral = Math.abs(wheel?.lateral || 0);
  if (!wheel || !wheel.grounded || wheel.detached || !Number.isFinite(speed + lateral)) return false;
  const minimumSpeed = continuing ? SKID_CONTINUE_SPEED : SKID_START_SPEED;
  const minimumLateral = continuing ? SKID_CONTINUE_LATERAL : SKID_START_LATERAL;
  const minimumAngle = continuing ? SKID_CONTINUE_ANGLE : SKID_START_ANGLE;
  const slipAngle = Math.atan2(lateral, Math.max(speed, 2.5));
  return speed >= minimumSpeed && lateral >= minimumLateral && slipAngle >= minimumAngle;
}

const finitePoint = point => Number.isFinite(point.x) && Number.isFinite(point.z);

/** Build a quad from two shared cross-sections. Returns null for invalid geometry. */
export function buildTrackSegment(start, end, startBirth, endBirth, startFade, endFade, width = TRACK_WIDTH, startCap = false, endCap = false, startNormal = null) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (!finitePoint(start) || !finitePoint(end) || !Number.isFinite(length) || length <= 1e-8) return null;
  const ox = startNormal ? startNormal.x * width / 2 : -dz / length * width / 2;
  const oz = startNormal ? startNormal.z * width / 2 : dx / length * width / 2;
  const endNormal = { x: -dz / length, z: dx / length };
  return {
    positions: [
      start.x + ox, 0.025, start.z + oz, start.x - ox, 0.025, start.z - oz,
      end.x + ox, 0.025, end.z + oz,
      start.x - ox, 0.025, start.z - oz, end.x - ox, 0.025, end.z - oz,
      end.x + ox, 0.025, end.z + oz,
    ],
    births: [startBirth, startBirth, endBirth, startBirth, endBirth, endBirth],
    fades: [startCap ? 0 : startFade, startCap ? 0 : startFade, endCap ? 0 : endFade,
      startCap ? 0 : startFade, endCap ? 0 : endFade, endCap ? 0 : endFade],
    startNormal: { x: ox / (width / 2), z: oz / (width / 2) },
    endNormal,
    length,
  };
}

export function createTrackSection(point, normal, width = TRACK_WIDTH) {
  if (!finitePoint(point) || !finitePoint(normal)) return null;
  const magnitude = Math.hypot(normal.x, normal.z);
  if (magnitude <= 1e-8 || !Number.isFinite(magnitude)) return null;
  const half = width / 2;
  const ox = normal.x / magnitude * half;
  const oz = normal.z / magnitude * half;
  return { left: { x: point.x + ox, z: point.z + oz }, right: { x: point.x - ox, z: point.z - oz },
    normal: { x: normal.x / magnitude, z: normal.z / magnitude }, width };
}

export function buildSectionSegment(start, end, startBirth, endBirth, startFade = 1, endFade = 1, startCap = false, endCap = false) {
  if (!start || !end || !finitePoint(start.left) || !finitePoint(start.right) || !finitePoint(end.left) || !finitePoint(end.right)) return null;
  const positions = [start.left.x, 0.025, start.left.z, start.right.x, 0.025, start.right.z,
    end.left.x, 0.025, end.left.z, start.right.x, 0.025, start.right.z,
    end.right.x, 0.025, end.right.z, end.left.x, 0.025, end.left.z];
  return { positions, births: [startBirth, startBirth, endBirth, startBirth, endBirth, endBirth],
    fades: [startCap ? 0 : startFade, startCap ? 0 : startFade, endCap ? 0 : endFade,
      startCap ? 0 : startFade, endCap ? 0 : endFade, endCap ? 0 : endFade] };
}

// One draw call and bounded storage. A segment is retained for at least 45s;
// at 120 segments/s the 6000-slot ring cannot overwrite a still-visible point.
export class TireTracks {
  constructor(scene, capacity = DEFAULT_TRACK_CAPACITY) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 18);
    this.births = new Float32Array(capacity * 6);
    this.fades = new Float32Array(capacity * 6);
    const uv = new Float32Array(capacity * 12);
    for (let i = 0; i < capacity; i++) uv.set([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1], i * 12);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('birth', new THREE.BufferAttribute(this.births, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('fade', new THREE.BufferAttribute(this.fades, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color('#45574d') } },
      vertexShader: `attribute float birth; attribute float fade; varying float vBirth; varying float vFade; varying vec2 vUv;
        void main() { vBirth = birth; vFade = fade; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float time; uniform vec3 color; varying float vBirth; varying float vFade; varying vec2 vUv;
        void main() {
          float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(0.0, 0.16, 1.0 - vUv.x);
          float age = 1.0 - smoothstep(30.0, 45.0, time - vBirth);
          gl_FragColor = vec4(color, 0.52 * edge * age * vFade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.previous = Array.from({ length: 4 }, () => ({ x: 0, z: 0, active: false, slipping: false, direction: 0, strip: null, pendingSlipTime: 0, releaseTime: 0 }));
    this.time = 0;
    this.tick = 0;
    this.pendingRanges = { position: [], birth: [], fade: [] };
    this.reset();
  }

  reset() {
    this.cursor = this.count = 0;
    this.geometry.setDrawRange(0, 0);
    for (const point of this.previous) {
      point.active = false; point.slipping = false; point.direction = 0; point.strip = null; point.pendingSlipTime = 0; point.releaseTime = 0;
    }
    this.pendingRanges = { position: [], birth: [], fade: [] };
    for (const name of ['position', 'birth', 'fade']) this.geometry.attributes[name].clearUpdateRanges();
  }

  addRange(name, start, count) { this.pendingRanges[name].push([start, count]); }

  flushRanges() {
    for (const [name, ranges] of Object.entries(this.pendingRanges)) {
      const attribute = this.geometry.attributes[name];
      if (!ranges.length) continue;
      ranges.sort((a, b) => a[0] - b[0]);
      let [start, end] = [ranges[0][0], ranges[0][0] + ranges[0][1]];
      for (const [nextStart, nextCount] of ranges.slice(1)) {
        const nextEnd = nextStart + nextCount;
        if (nextStart <= end) end = Math.max(end, nextEnd);
        else { attribute.addUpdateRange(start, end - start); [start, end] = [nextStart, nextEnd]; }
      }
      attribute.addUpdateRange(start, end - start);
      attribute.needsUpdate = true;
      ranges.length = 0;
    }
  }

  setVertexData(segmentIndex, segment) {
    const offset = segmentIndex * 18;
    const dataOffset = segmentIndex * 6;
    this.positions.set(segment.positions, offset);
    this.births.set(segment.births, dataOffset);
    this.fades.set(segment.fades, dataOffset);
    this.addRange('position', offset, 18);
    this.addRange('birth', dataOffset, 6);
    this.addRange('fade', dataOffset, 6);
  }

  appendSegment(prev, point) {
    if (this.count === this.capacity && this.time - this.births[this.cursor * 6] < TRACK_LIFETIME) return false;
    const start = prev.headPoint;
    const end = { x: point.x, z: point.z };
    const dx = end.x - start.center.x, dz = end.z - start.center.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-8) return false;
    const normal = { x: -dz / length, z: dx / length };
    let sectionNormal = normal;
    let sectionWidth = TRACK_WIDTH;
    if (prev.headNormal) {
      const mx = prev.headNormal.x + normal.x, mz = prev.headNormal.z + normal.z;
      const miterLength = Math.hypot(mx, mz);
      if (miterLength > 1e-8) {
        sectionNormal = { x: mx / miterLength, z: mz / miterLength };
        const scale = Math.min(2, 1 / Math.max(0.5, sectionNormal.x * normal.x + sectionNormal.z * normal.z));
        sectionWidth *= scale;
      }
    }
    const section = createTrackSection(end, sectionNormal, sectionWidth);
    if (!start.section) start.section = createTrackSection(start.center, normal);
    const built = buildSectionSegment(start.section, section, prev.headBirth, this.time, 1, 1, start.cap, false);
    if (!built) return false;
    const index = this.cursor;
    this.setVertexData(index, built);
    prev.head = index;
    prev.headPoint = { center: end, section, cap: false };
    prev.headBirth = this.time;
    prev.headFade = 1;
    prev.headNormal = { x: -dz / length, z: dx / length };
    prev.headDirection = { x: dx / length, z: dz / length };
    prev.length += length;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    return true;
  }

  update(wheels, enabled, dt) {
    this.time += dt;
    this.flushRanges();
    if (++this.tick % 4) return;
    const sampleDt = dt * 4;
    wheels.slice(0, this.previous.length).forEach((wheel, i) => {
      const prev = this.previous[i];
      let strip = prev.strip;
      const hasContact = enabled && wheel.grounded && !wheel.detached && Math.abs(wheel.longitudinal) >= SKID_CONTINUE_SPEED;
      if (!hasContact) { if (strip) this.endStrip(strip); prev.strip = null; prev.active = false; prev.slipping = false; prev.direction = 0; prev.pendingSlipTime = 0; prev.releaseTime = 0; return; }
      const direction = Math.sign(wheel.longitudinal);
      if (prev.slipping && direction !== prev.direction) {
        if (strip) this.endStrip(strip);
        prev.strip = null; prev.active = false; prev.slipping = false;
      }
      const hardSkid = isHardSkid(wheel, prev.slipping);
      if (hardSkid) { prev.pendingSlipTime += sampleDt; prev.releaseTime = 0; }
      else if (prev.slipping) { prev.releaseTime += sampleDt; }
      else prev.pendingSlipTime = 0;
      if (!prev.slipping && (!hardSkid || prev.pendingSlipTime < SKID_CONFIRM_TIME)) return;
      if (prev.slipping && !hardSkid && prev.releaseTime >= SKID_RELEASE_TIME) {
        if (strip) this.endStrip(strip); prev.strip = null; prev.active = false; prev.slipping = false; prev.direction = 0; prev.pendingSlipTime = 0; prev.releaseTime = 0; return;
      }
      const { x, z } = wheel.position;
      if (!finitePoint({ x, z })) { if (strip) this.endStrip(strip); prev.strip = null; prev.active = false; return; }
      const dx = x - prev.x, dz = z - prev.z;
      const distance = Math.hypot(dx, dz);
      if (prev.active && distance < MIN_POINT_DISTANCE) return;
      let wasSlipping = prev.slipping;
      if (prev.active && distance >= MAX_POINT_DISTANCE) {
        if (strip) this.endStrip(strip);
        strip = null; prev.strip = null; prev.active = false; prev.slipping = false; wasSlipping = false;
      }
      prev.slipping = true;
      if (prev.active && distance < MAX_POINT_DISTANCE && strip) {
        if (!this.appendSegment(strip, { x, z })) {
          this.endStrip(strip); prev.strip = null; prev.active = false; prev.slipping = false; return;
        }
      }
      prev.x = x; prev.z = z; prev.active = true;
      if (!wasSlipping) {
        const center = { x, z };
        strip = { head: -1, headPoint: { center, section: null, cap: true }, headBirth: this.time, headFade: 0, headNormal: null, headDirection: null, length: 0 };
        prev.strip = strip;
      }
      prev.direction = direction;
      if (strip) prev.strip = strip;
    });
  }

  endStrip(strip) {
    if (strip.head < 0) return;
    const lastBirth = this.births[strip.head * 6 + 2];
    const previousSection = strip.headPoint;
    const section = previousSection?.section;
    if (section && strip.headDirection) {
      const fadeLength = Math.min(TRACK_END_FADE_LENGTH, strip.length);
      const capCenter = {
        x: previousSection.center.x + strip.headDirection.x * fadeLength,
        z: previousSection.center.z + strip.headDirection.z * fadeLength,
      };
      const cap = createTrackSection(capCenter, section.normal || strip.headNormal, section.width || TRACK_WIDTH);
      const built = buildSectionSegment(section, cap, lastBirth, lastBirth, 1, 0, false, false);
      if (built && (this.count < this.capacity || this.time - this.births[this.cursor * 6] >= TRACK_LIFETIME)) {
        const index = this.cursor;
        this.setVertexData(index, built);
        // Remove the cap's centerline fade endpoints entirely.
        const offset = index * 6;
        this.fades[offset + 2] = 0; this.fades[offset + 4] = 0; this.fades[offset + 5] = 0;
        this.addRange('fade', offset, 6);
        this.cursor = (this.cursor + 1) % this.capacity;
        this.count = Math.min(this.count + 1, this.capacity);
      } else if (built) {
        // No safe slot for service geometry: extend the existing terminal quad.
        const index = strip.head;
        const positionOffset = index * 18;
        this.positions.set(built.positions.slice(6, 9), positionOffset + 6);
        this.positions.set(built.positions.slice(12, 15), positionOffset + 12);
        this.positions.set(built.positions.slice(15, 18), positionOffset + 15);
        this.addRange('position', positionOffset + 6, 12);
        const fadeOffset = index * 6;
        this.fades[fadeOffset + 2] = 0; this.fades[fadeOffset + 4] = 0; this.fades[fadeOffset + 5] = 0;
        this.addRange('fade', fadeOffset + 2, 4);
      }
    }
    strip.head = -1; strip.headPoint = null;
  }

  prepareRender() {
    this.material.uniforms.time.value = this.time;
    this.geometry.setDrawRange(0, this.count * 6);
    this.flushRanges();
  }
}
