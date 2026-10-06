import * as THREE from 'three';

export const DAMAGE_EFFECTS = Object.freeze({ smoke: .15, dark: .45, fire: .75, terminalDelay: .6, aftermath: 5 });
const clamp = value => Math.max(0, Math.min(1, value));

export function damageVisualStage(damage) {
  return damage >= 1 ? 'terminal' : damage >= DAMAGE_EFFECTS.fire ? 'fire'
    : damage >= DAMAGE_EFFECTS.dark ? 'dark-smoke' : damage >= DAMAGE_EFFECTS.smoke ? 'grey-smoke' : 'healthy';
}

/** Visual time only: never changes physics damage or consumes contact events. */
export class DamageEffectController {
  constructor() { this.reset(); }
  reset() {
    this.stage = 'healthy'; this.smoke = 0; this.fire = 0; this.darkness = 0;
    this.terminalTime = 0; this.exploded = false; this.explosions = 0; this.aftermathTime = 0;
  }
  update(damage, dt) {
    damage = clamp(Number.isFinite(damage) ? damage : 0);
    dt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    this.stage = damageVisualStage(damage);
    const blend = 1 - Math.exp(-dt / .22);
    const smokeGoal = this.exploded ? 0 : clamp((damage - DAMAGE_EFFECTS.smoke) / .55);
    const fireGoal = this.exploded ? 0 : clamp((damage - DAMAGE_EFFECTS.fire) / .25);
    this.smoke += (smokeGoal - this.smoke) * blend;
    this.darkness += (clamp((damage - .3) / .4) - this.darkness) * blend;
    this.fire += (fireGoal - this.fire) * blend;
    let burst = false;
    if (damage >= 1 && !this.exploded) {
      this.terminalTime += dt;
      this.fire = 1; this.smoke = 1;
      if (this.terminalTime + 1e-9 >= DAMAGE_EFFECTS.terminalDelay) {
        this.exploded = true; this.explosions++; burst = true;
      }
    } else if (!this.exploded) this.terminalTime = 0;
    if (this.exploded) {
      if (!burst) this.aftermathTime += dt;
      this.fire = 0;
      this.smoke *= Math.exp(-dt / .55);
      if (this.aftermathTime >= DAMAGE_EFFECTS.aftermath) this.smoke = 0;
    }
    return burst;
  }
}

class ParticlePool {
  constructor(scene, capacity, additive) {
    this.capacity = capacity;
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('particleAlpha', this.alpha);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute float particleAlpha;
        varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
        void main() {
          vUv = uv; vColor = instanceColor; vAlpha = particleAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 p = (vUv - .5) * 2.0;
          float shape = max(0.0, 1.0 - dot(p, p));
          float wisps = .8 + .2 * sin(p.x * 13.0 + sin(p.y * 11.0));
          gl_FragColor = vec4(vColor, pow(shape, 1.6) * wisps * vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = additive ? 'Damage fire and embers' : 'Damage smoke';
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles = Array.from({ length: capacity }, () => ({
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 0, life: 0, size: 0, kind: 'smoke', shade: 0,
    }));
    this.matrix = new THREE.Matrix4(); this.scale = new THREE.Vector3(); this.color = new THREE.Color();
    this.rotation = new THREE.Quaternion(); this.cursor = 0;
    // Allocate instanceColor once, including before the first shader compilation.
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, this.color);
    scene.add(this.mesh); this.reset();
  }
  emit(origin, kind, darkness, burst = false) {
    const p = this.particles[this.cursor]; this.cursor = (this.cursor + 1) % this.capacity;
    p.position.copy(origin);
    p.position.x += (Math.random() - .5) * .65; p.position.z += (Math.random() - .5) * .5;
    p.age = 0; p.kind = kind; p.shade = darkness;
    const angle = Math.random() * Math.PI * 2, spread = burst ? 2 + Math.random() * 4 : .3;
    p.velocity.set(Math.cos(angle) * spread, kind === 'spark' ? 3 + Math.random() * 4 : 1 + Math.random() * 1.5, Math.sin(angle) * spread);
    p.life = kind === 'smoke' ? (burst ? 3 + Math.random() * 1.7 : 2 + Math.random()) : kind === 'flash' ? .2 : kind === 'spark' ? .7 + Math.random() * .6 : .4 + Math.random() * .5;
    p.size = kind === 'smoke' ? .5 + Math.random() * .35 : kind === 'flash' ? 5 : kind === 'spark' ? .06 : .45 + Math.random() * .5;
  }
  update(dt, camera, limit) {
    this.rotation.copy(camera.quaternion);
    let active = 0;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i]; p.age += dt;
      const alive = p.life > p.age && i < limit;
      if (alive) {
        active++;
        p.position.addScaledVector(p.velocity, dt);
        if (p.kind === 'spark') p.velocity.y -= dt * 7;
        else p.velocity.multiplyScalar(Math.exp(-dt * .3));
        const progress = p.age / p.life;
        const size = p.size * (p.kind === 'smoke' ? 1 + progress * 3.5 : p.kind === 'flash' ? 1 + progress : 1 + progress * .7);
        this.scale.set(size, p.kind === 'spark' ? size * 3 : size, 1);
        const fade = Math.sin(Math.PI * progress);
        this.alpha.setX(i, p.kind === 'flash' ? 1 - progress : fade * (p.kind === 'smoke' ? .25 + p.shade * .35 : .95));
        if (p.kind === 'smoke') this.color.setScalar(.38 - p.shade * .34);
        else this.color.setRGB(1, p.kind === 'flash' ? .85 : .2 + (1 - progress) * .55, p.kind === 'flash' ? .35 : .015);
        this.mesh.setColorAt(i, this.color);
      } else { this.scale.setScalar(0); this.alpha.setX(i, 0); }
      this.matrix.compose(p.position, this.rotation, this.scale); this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.visible = active > 0;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; this.alpha.needsUpdate = true;
    return active;
  }
  reset() {
    this.cursor = 0;
    for (const p of this.particles) { p.life = 0; p.age = 0; }
    this.mesh.visible = false;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

export class CarDamageEffects {
  constructor(scene) {
    this.controller = new DamageEffectController();
    this.smokePool = new ParticlePool(scene, 160, false);
    this.firePool = new ParticlePool(scene, 128, true);
    this.origin = new THREE.Vector3(); this.anchor = new THREE.Vector3(0, .35, 1.45);
    this.reset();
  }
  update({ damage, car, camera, dt, quality }) {
    dt = Math.max(0, Math.min(.08, Number.isFinite(dt) ? dt : 0));
    this.origin.copy(this.anchor).applyQuaternion(car.quaternion).add(car.position);
    const burst = this.controller.update(damage, dt);
    const low = quality === 'low', factor = low ? .55 : 1;
    if (burst) {
      this.firePool.emit(this.origin, 'flash', 0, true);
      for (let i = 0; i < (low ? 24 : 48); i++) {
        this.smokePool.emit(this.origin, 'smoke', .9, true);
        this.firePool.emit(this.origin, i % 3 === 0 ? 'spark' : 'fire', 0, true);
      }
    }
    this.smokeCredit += dt * this.controller.smoke * 36 * factor;
    this.fireCredit += dt * this.controller.fire * 45 * factor;
    this.sparkCredit += dt * this.controller.fire * 7 * factor;
    while (this.smokeCredit >= 1) { this.smokeCredit--; this.smokePool.emit(this.origin, 'smoke', this.controller.darkness); }
    while (this.fireCredit >= 1) { this.fireCredit--; this.firePool.emit(this.origin, 'fire', 0); }
    while (this.sparkCredit >= 1) { this.sparkCredit--; this.firePool.emit(this.origin, 'spark', 0); }
    // The pool is bounded in both quality modes; reduce emission, never hide a ring-buffer slot by index.
    this.activeSmoke = this.smokePool.update(dt, camera, 160);
    this.activeFire = this.firePool.update(dt, camera, 128);
  }
  reset() {
    this.controller.reset(); this.smokePool.reset(); this.firePool.reset();
    this.smokeCredit = this.fireCredit = this.sparkCredit = 0; this.activeSmoke = this.activeFire = 0;
  }
  snapshot() {
    return { stage: this.controller.stage, exploded: this.controller.exploded, explosions: this.controller.explosions,
      terminalTime: this.controller.terminalTime, activeSmoke: this.activeSmoke, activeFire: this.activeFire,
      capacity: 288, origin: this.origin.toArray() };
  }
  dispose() { this.smokePool.dispose(); this.firePool.dispose(); }
}
