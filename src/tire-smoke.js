import * as THREE from 'three';

export const TIRE_SMOKE_CONFIG = Object.freeze({ capacity: 512, lowCapacity: 256,
  lifetimeMin: 0.8, lifetimeMax: 1.6, thresholdMultiplier: 1.35, highSources: 24, lowSources: 12,
  highDistance: 80, lowDistance: 50, rate: 12 });

const finiteWheel = wheel => wheel?.grounded && !wheel.detached
  && [wheel.longitudinal, wheel.lateral, wheel.contact?.x, wheel.contact?.y, wheel.contact?.z].every(Number.isFinite);

export function tireSmokeIntensity(wheel, threshold = 1.25, continuing = false) {
  if (!finiteWheel(wheel)) return 0;
  const factor = TIRE_SMOKE_CONFIG.thresholdMultiplier * Math.max(0.5, Math.min(3, Number.isFinite(threshold) ? threshold : 1.25));
  const speed = Math.abs(wheel.longitudinal), lateral = Math.abs(wheel.lateral);
  const speedLimit = (continuing ? 4 : 6) * factor;
  const lateralLimit = (continuing ? 1.5 : 2.2) * factor;
  const angleLimit = (continuing ? 0.2 : 0.28) * factor;
  const angle = Math.atan2(lateral, Math.max(speed, 2.5));
  if (speed < speedLimit || lateral < lateralLimit || angle < angleLimit) return 0;
  return Math.max(0, Math.min(1, Math.min(speed / (speedLimit * 2.5), lateral / (lateralLimit * 2.5), angle / (angleLimit * 2.5))));
}

function createSoftSmokeTexture() {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot((x + 0.5 - size / 2) / (size / 2), (y + 0.5 - size / 2) / (size / 2));
    const alpha = Math.round(255 * Math.pow(Math.max(0, 1 - radius * radius), 2.2));
    const offset = (y * size + x) * 4;
    data[offset] = 232; data[offset + 1] = 235; data[offset + 2] = 232; data[offset + 3] = alpha;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function sourcePriority(source) { return source.id === 'player' ? 0 : source.role === 'police' ? 1 : 2; }

/** Fixed-size shared billboard pool. Skid qualification is sampled at physics rate, rendering at frame rate. */
export class TireSmoke {
  constructor(scene, { capacity = TIRE_SMOKE_CONFIG.capacity, seed = 0x51D3A9B7 } = {}) {
    this.capacity = capacity;
    this.randomState = seed >>> 0;
    this.states = new Map();
    this.particles = Array.from({ length: capacity }, () => ({ active: false, age: 0, life: 1,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0 }));
    this.texture = createSoftSmokeTexture();
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true,
      opacity: 0.52, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, color: '#f1f2ee' });
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.name = 'Tire skid smoke';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.position = new THREE.Vector3(); this.scale = new THREE.Vector3(); this.matrix = new THREE.Matrix4();
    this.zeroScale = new THREE.Vector3(0, 0, 0); this.rotation = new THREE.Quaternion();
    this.diagnostics = { emitted: 0, sourceCount: 0, limitedSources: 0, highWater: 0 };
  }

  random() {
    this.randomState = (this.randomState + 0x6D2B79F5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }

  sample(sources, dt, { enabled = true, threshold = 1.25, quality = 'high', cameraPosition = { x: 0, y: 0, z: 0 } } = {}) {
    const low = quality === 'low', budget = low ? TIRE_SMOKE_CONFIG.lowCapacity : this.capacity;
    const maxSources = low ? TIRE_SMOKE_CONFIG.lowSources : TIRE_SMOKE_CONFIG.highSources;
    const distanceLimit = low ? TIRE_SMOKE_CONFIG.lowDistance : TIRE_SMOKE_CONFIG.highDistance;
    const candidates = (enabled ? sources : []).filter(source => source && source.id != null && Array.isArray(source.wheels)
      && (source.id === 'player' || Math.hypot((source.x ?? source.body?.position?.x ?? 0) - cameraPosition.x,
        (source.z ?? source.body?.position?.z ?? 0) - cameraPosition.z) <= distanceLimit))
      .sort((a, b) => sourcePriority(a) - sourcePriority(b)
        || Math.hypot((a.x ?? 0) - cameraPosition.x, (a.z ?? 0) - cameraPosition.z)
          - Math.hypot((b.x ?? 0) - cameraPosition.x, (b.z ?? 0) - cameraPosition.z));
    const selected = candidates.slice(0, maxSources);
    const liveIds = new Set(selected.map(source => String(source.id)));
    for (const id of this.states.keys()) if (!liveIds.has(id)) this.states.delete(id);
    this.diagnostics.sourceCount = selected.length;
    this.diagnostics.limitedSources = Math.max(0, candidates.length - selected.length);
    let remaining = Math.min(budget, this.capacity) - this.activeCount;
    for (const source of selected) {
      const id = String(source.id);
      let wheelStates = this.states.get(id);
      if (!wheelStates) { wheelStates = Array.from({ length: 4 }, () => ({ active: false, pending: 0, release: 0, credit: 0 })); this.states.set(id, wheelStates); }
      source.wheels.slice(0, 4).forEach((wheel, index) => {
        const state = wheelStates[index];
        const strength = tireSmokeIntensity(wheel, threshold, state.active);
        if (strength > 0) { state.pending += dt; state.release = 0; }
        else if (state.active) state.release += dt;
        else { state.pending = 0; state.credit = 0; return; }
        if (!state.active && state.pending >= 0.08) state.active = true;
        if (state.active && strength > 0) {
          state.credit += dt * TIRE_SMOKE_CONFIG.rate * strength;
          while (state.credit >= 1 && remaining > 0) {
            state.credit -= 1; this.emit(wheel.contact); remaining--;
          }
        }
        if (state.active && state.release >= 0.12) {
          state.active = false; state.pending = 0; state.release = 0; state.credit = 0;
        }
      });
      for (let index = source.wheels.length; index < 4; index++) wheelStates[index] = { active: false, pending: 0, release: 0, credit: 0 };
    }
    this.diagnostics.highWater = Math.max(this.diagnostics.highWater, this.activeCount);
  }

  emit(contact) {
    if (!contact || ![contact.x, contact.y, contact.z].every(Number.isFinite)) return false;
    const particle = this.particles.find(item => !item.active);
    if (!particle) return false;
    particle.active = true; particle.age = 0;
    particle.life = TIRE_SMOKE_CONFIG.lifetimeMin + this.random() * (TIRE_SMOKE_CONFIG.lifetimeMax - TIRE_SMOKE_CONFIG.lifetimeMin);
    particle.x = contact.x; particle.y = contact.y + 0.1; particle.z = contact.z;
    particle.vx = (this.random() - 0.5) * 0.7; particle.vy = 0.35 + this.random() * 0.45; particle.vz = (this.random() - 0.5) * 0.7;
    particle.size = 0.25 + this.random() * 0.22;
    this.diagnostics.emitted++;
    return true;
  }

  get activeCount() { let count = 0; for (const particle of this.particles) if (particle.active) count++; return count; }

  update(dt, camera, { quality = 'high' } = {}) {
    const low = quality === 'low', active = [];
    this.rotation.copy(camera?.quaternion || new THREE.Quaternion());
    for (let index = 0; index < this.capacity; index++) {
      const particle = this.particles[index];
      if (!particle.active) { this.matrix.compose(this.position.set(0, -1000, 0), this.rotation, this.zeroScale); this.mesh.setMatrixAt(index, this.matrix); continue; }
      particle.age += dt;
      if (particle.age >= particle.life) { particle.active = false; this.matrix.compose(this.position.set(0, -1000, 0), this.rotation, this.zeroScale); this.mesh.setMatrixAt(index, this.matrix); continue; }
      const progress = particle.age / particle.life;
      particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.z += particle.vz * dt;
      particle.size += dt * 0.45;
      const fade = progress < 0.15 ? progress / 0.15 : (1 - progress) / 0.85;
      const scale = particle.size * Math.max(0, Math.min(1, fade));
      this.matrix.compose(this.position.set(particle.x, particle.y, particle.z), this.rotation, this.scale.set(scale, scale, scale));
      this.mesh.setMatrixAt(index, this.matrix); active.push(index);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = this.capacity;
    this.mesh.visible = active.length > 0;
    this.diagnostics.active = active.length;
    this.diagnostics.capacity = this.capacity;
    this.diagnostics.quality = quality;
    this.diagnostics.budget = low ? Math.min(TIRE_SMOKE_CONFIG.lowCapacity, this.capacity) : this.capacity;
    this.diagnostics.highWater = Math.max(this.diagnostics.highWater, active.length);
    return this.snapshot();
  }

  reset() {
    for (const state of this.states.values()) for (const wheel of state) { wheel.active = false; wheel.pending = 0; wheel.release = 0; wheel.credit = 0; }
    this.states.clear();
    for (const particle of this.particles) particle.active = false;
    this.mesh.visible = false; this.diagnostics.active = 0; this.diagnostics.highWater = 0;
  }

  snapshot() { return { ...this.diagnostics, emitters: this.states.size, emitted: this.diagnostics.emitted }; }
  dispose() { this.reset(); this.mesh.removeFromParent(); this.geometry.dispose(); this.texture.dispose(); this.material.dispose(); }
}
