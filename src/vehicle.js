import * as C from 'cannon-es';
import { accumulateDamage, damageFromImpact, damageState, tractionForDamage, wheelCanDetach } from './car-damage.js';

export const DEFAULT_TUNING = Object.freeze({ softness: 0.45, grip: 1.8, power: 1 });
export const STEP = 1 / 120;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const v = (x = 0, y = 0, z = 0) => new C.Vec3(x, y, z);

/** SI units; +Z forward, +X right, +Y up. No scripted body roll or yaw. */
export class CarSimulation {
  constructor({ world = null, materials = null, spawn = { x: 0, y: 0.96, z: 0, yaw: -0.45 }, damage = true,
    damageMultiplier = 1, allowWheelDetachment = true } = {}) {
    this.ownsWorld = world === null;
    this.world = world || new C.World({ gravity: v(0, -9.81, 0) });
    if (this.ownsWorld) {
      this.world.broadphase = new C.SAPBroadphase(this.world);
      this.world.solver.iterations = 10;
      const asphalt = new C.Material('asphalt');
      const chassis = new C.Material('chassis');
      materials = { asphalt, chassis };
      this.world.addContactMaterial(new C.ContactMaterial(asphalt, chassis, { friction: 0.45, restitution: 0.05 }));
      const ground = new C.Body({ mass: 0, material: asphalt });
      ground.addShape(new C.Plane());
      ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      ground.collisionFilterGroup = 1;
      this.world.addBody(ground);
      this.ground = ground;
    }
    this.materials = materials;
    this.spawn = { ...spawn };
    this.hasDamage = damage;
    this.damageMultiplier = Number.isFinite(damageMultiplier) && damageMultiplier >= 0 ? damageMultiplier : 1;
    this.allowWheelDetachment = allowWheelDetachment;
    this.body = new C.Body({ mass: 1600, material: materials.chassis, linearDamping: 0.005, angularDamping: 0.3, allowSleep: false });
    // Offset collision shapes leave the COM below the bodywork, but high enough to roll.
    this.body.addShape(new C.Box(v(0.87, 0.27, 2.08)), v(0, 0.12, 0));
    this.body.addShape(new C.Box(v(0.72, 0.25, 0.9)), v(0, 0.59, -0.15));
    this.body.collisionFilterGroup = 2;
    this.world.addBody(this.body);
    this.wheelRaycastOptions = { collisionFilterMask: 1, skipBackfaces: true };
    this.staticBodies = [];
    this.damage = 0;
    this.lastImpactSpeed = 0;
    this.impactEvents = [];
    this.impactCooldowns = new Map();
    this.damageListener = damage ? event => this.recordImpact(event.bodyA, event.bodyB) : null;
    if (this.damageListener) this.world.addEventListener('beginContact', this.damageListener);
    this.tuning = { ...DEFAULT_TUNING };
    this.wheels = [v(-0.77, -0.04, 1.15), v(0.77, -0.04, 1.15), v(-0.77, -0.04, -1.15), v(0.77, -0.04, -1.15)].map((mount, i) => ({
      mount, front: i < 2, radius: 0.45, length: 0.5, compression: 0, detached: false, detachedBody: null,
      load: 0, lateral: 0, longitudinal: 0, slip: 0, rotation: 0,
      position: v(), previousPosition: v(), previousRotation: 0, contact: v(), grounded: false, result: new C.RaycastResult(),
    }));
    this.forward = v();
    this.scratch = {
      localUp: v(0, 1, 0), localForward: v(0, 0, 1), up: v(), origin: v(), rayDelta: v(), rayEnd: v(),
      pointVelocity: v(), arm: v(), force: v(), force2: v(), forward: v(), localWheelForward: v(),
      right: v(), projection: v(), tireForce: v(), leftArm: v(), rightArm: v(), rollForce: v(), dragForce: v(),
    };
    this.steering = 0;
    this.previousSteering = 0;
    this.throttle = 0;
    this.reset();
  }

  reset() {
    this.body.position.set(this.spawn.x, this.spawn.y, this.spawn.z);
    this.body.quaternion.setFromEuler(0, this.spawn.yaw, 0);
    this.body.velocity.setZero(); this.body.angularVelocity.setZero();
    this.body.force.setZero(); this.body.torque.setZero();
    this.body.previousPosition.copy(this.body.position);
    this.body.interpolatedPosition.copy(this.body.position);
    this.body.previousQuaternion.copy(this.body.quaternion);
    this.body.interpolatedQuaternion.copy(this.body.quaternion);
    this.body.aabbNeedsUpdate = true;
    this.steering = 0; this.previousSteering = 0; this.throttle = 0; this.time = 0;
    this.damage = 0; this.lastImpactSpeed = 0; this.impactEvents.length = 0; this.impactCooldowns.clear();
    for (const wheel of this.wheels) {
      if (wheel.detachedBody) this.world.removeBody(wheel.detachedBody);
      wheel.detached = false; wheel.detachedBody = null;
      wheel.rotation = wheel.previousRotation = 0; wheel.slip = 0; wheel.length = 0.5;
    }
    this.syncWheelPositions();
    for (const wheel of this.wheels) wheel.previousPosition.copy(wheel.position);
  }

  repair() {
    const needsRepair = this.damage > 0 || this.wheels.some(wheel => wheel.detached);
    if (!needsRepair) return false;
    for (const wheel of this.wheels) {
      if (wheel.detachedBody) this.world.removeBody(wheel.detachedBody);
      wheel.detached = false; wheel.detachedBody = null;
      wheel.length = 0.5; wheel.compression = 0; wheel.slip = 0; wheel.load = 0;
      wheel.result.reset();
    }
    this.damage = 0;
    this.lastImpactSpeed = 0;
    this.impactEvents.length = 0;
    this.body.aabbNeedsUpdate = true;
    this.syncWheelPositions();
    for (const wheel of this.wheels) wheel.previousPosition.copy(wheel.position);
    return true;
  }

  addStaticBox({ x, y, z, halfX, halfY, halfZ, yaw = 0, wheelSupport = false }) {
    const body = new C.Body({ mass: 0 });
    body.addShape(new C.Box(v(halfX, halfY, halfZ)));
    body.position.set(x, y, z);
    body.quaternion.setFromEuler(0, yaw, 0);
    body.collisionFilterGroup = wheelSupport ? 1 : 4;
    body.wheelSupport = wheelSupport;
    this.world.addBody(body);
    this.staticBodies.push(body);
    return body;
  }

  addStaticConvex({ x, y, z, vertices, faces, wheelSupport = false }) {
    const body = new C.Body({ mass: 0 });
    body.addShape(new C.ConvexPolyhedron({ vertices: vertices.map(point => v(...point)), faces }));
    body.position.set(x, y, z);
    body.collisionFilterGroup = wheelSupport ? 1 : 4;
    body.wheelSupport = wheelSupport;
    this.world.addBody(body);
    this.staticBodies.push(body);
    return body;
  }

  removeStaticBox(body) {
    if (!this.staticBodies.includes(body)) return false;
    this.world.removeBody(body);
    this.staticBodies.splice(this.staticBodies.indexOf(body), 1);
    return true;
  }

  recordImpact(bodyA, bodyB) {
    if (!this.hasDamage || (bodyA !== this.body && bodyB !== this.body)) return;
    const other = bodyA === this.body ? bodyB : bodyA;
    const regions = new Map();
    for (const contact of this.world.contacts) {
      if (!((contact.bi === this.body && contact.bj === other) || (contact.bj === this.body && contact.bi === other))) continue;
      const speed = Math.abs(contact.getImpactVelocityAlongNormal());
      const impact = damageFromImpact(speed);
      if (!impact.severity) continue;
      const carIsA = contact.bi === this.body;
      const arm = carIsA ? contact.ri : contact.rj;
      const worldPoint = this.body.position.vadd(arm);
      const point = this.body.pointToLocalFrame(worldPoint);
      const cell = [point.x, point.y, point.z].map(n => Math.round(n / 0.8)).join(':');
      const previous = regions.get(cell);
      if (!previous || speed > previous.speed) {
        const normal = contact.ni.scale(carIsA ? -1 : 1);
        const localNormal = this.body.quaternion.conjugate().vmult(normal);
        regions.set(cell, { speed, point: { x: point.x, y: point.y, z: point.z }, normal: { x: localNormal.x, y: localNormal.y, z: localNormal.z }, impact });
      }
    }
    for (const [cell, event] of regions) {
      const key = `${other.id}:${cell}`;
      const last = this.impactCooldowns.get(key);
      if (last !== undefined && this.time - last < 0.65) continue;
      this.impactCooldowns.set(key, this.time);
      this.lastImpactSpeed = Math.max(this.lastImpactSpeed, event.speed);
      this.damage = accumulateDamage(this.damage, event.impact.amount * this.damageMultiplier);
      if (this.allowWheelDetachment) this.detachWheelAtImpact(event);
      if (this.impactEvents.length < 32) this.impactEvents.push({ ...event, otherBodyId: other.id });
    }
    for (const [key, time] of this.impactCooldowns) if (this.time - time > 5) this.impactCooldowns.delete(key);
  }

  drainImpactEvents() {
    return this.impactEvents.splice(0, this.impactEvents.length);
  }

  disposeDamageListener() {
    if (!this.damageListener) return false;
    this.world.removeEventListener('beginContact', this.damageListener);
    this.damageListener = null;
    return true;
  }

  detachWheelAtImpact(event) {
    if (event.speed < 14) return;
    const point = v(event.point.x, event.point.y, event.point.z);
    let target = null, distance = Infinity;
    for (const wheel of this.wheels) {
      if (wheel.detached) continue;
      // Contact height can be above/below the suspension hardpoint; wheel targeting uses the ground plane.
      const d = Math.hypot(point.x - wheel.mount.x, point.z - wheel.mount.z);
      if (d < distance) { target = wheel; distance = d; }
    }
    if (!target || !wheelCanDetach(event.speed, distance)) return;
    const worldPosition = target.position.clone();
    const detached = new C.Body({ mass: 18, linearDamping: 0.02, angularDamping: 0.06, allowSleep: false });
    const shape = new C.Cylinder(target.radius, target.radius, 0.30, 16);
    const axle = new C.Quaternion(); axle.setFromEuler(0, 0, Math.PI / 2);
    detached.addShape(shape, v(), axle);
    detached.position.copy(worldPosition);
    detached.quaternion.copy(this.body.quaternion);
    detached.velocity.copy(this.body.getVelocityAtWorldPoint(worldPosition, v()));
    const away = this.body.quaternion.vmult(v(event.normal.x, event.normal.y, event.normal.z));
    detached.velocity.vadd(away.scale(2.4), detached.velocity);
    detached.angularVelocity.copy(this.body.angularVelocity);
    detached.angularVelocity.vadd(this.body.quaternion.vmult(v(5, 0, 0)), detached.angularVelocity);
    detached.collisionFilterGroup = 8;
    detached.collisionFilterMask = 1;
    this.world.addBody(detached);
    target.detached = true;
    target.detachedBody = detached;
  }

  get signedSpeed() {
    this.body.quaternion.vmult(this.scratch.localForward, this.forward);
    return this.body.velocity.dot(this.forward);
  }

  prepare(input = {}, dt = STEP) {
    const body = this.body;
    this.previousSteering = this.steering;
    for (const wheel of this.wheels) {
      wheel.previousPosition.copy(wheel.position);
      wheel.previousRotation = wheel.rotation;
    }
    const speed = this.signedSpeed;
    const absSpeed = Math.abs(speed);
    // Steering wheel rate and speed-sensitive lock retain a wide high-speed turning arc.
    const lock = 0.95 / (1 + absSpeed * 0.016);
    const targetSteer = clamp(input.steer || 0, -1, 1) * lock;
    this.steering += clamp(targetSteer - this.steering, -7 * dt, 7 * dt);
    const targetThrottle = clamp(input.throttle || 0, -1, 1);
    this.throttle += (targetThrottle - this.throttle) * (1 - Math.exp(-dt * 7));
    const braking = clamp(input.brake || 0, 0, 1);
    const { localUp, localWheelForward, up, origin, rayDelta, rayEnd, pointVelocity, arm, force, force2,
      forward, right, projection, tireForce, leftArm, rightArm, rollForce, dragForce } = this.scratch;
    body.quaternion.vmult(localUp, up);
    const rest = 0.5;
    const stiffness = 42000 - this.tuning.softness * 22000;
    const compressionDamping = 4100 - this.tuning.softness * 1000;
    const reboundDamping = compressionDamping * 1.35;

    for (const wheel of this.wheels) {
      if (wheel.detached) {
        wheel.grounded = false; wheel.load = 0; wheel.slip = 0;
        continue;
      }
      body.pointToWorldFrame(wheel.mount, origin);
      up.scale(-(rest + wheel.radius + 0.18), rayDelta);
      origin.vadd(rayDelta, rayEnd);
      wheel.result.reset();
      this.world.raycastClosest(origin, rayEnd, this.wheelRaycastOptions, wheel.result);
      wheel.grounded = wheel.result.hasHit && up.y > 0.15;
      wheel.load = 0; wheel.slip = 0;
      if (!wheel.grounded) {
        wheel.length = rest + 0.18;
        wheel.position.copy(origin.vadd(up.scale(-wheel.length)));
        continue;
      }
      wheel.contact.copy(wheel.result.hitPointWorld);
      wheel.length = clamp(wheel.result.distance - wheel.radius, 0.10, rest + 0.18);
      wheel.compression = rest - wheel.length;
      wheel.position.copy(origin.vadd(up.scale(-wheel.length)));
      wheel.contact.vsub(body.position, arm);
      body.angularVelocity.cross(arm, pointVelocity);
      body.velocity.vadd(pointVelocity, pointVelocity);
      const normal = wheel.result.hitNormalWorld;
      const normalSpeed = pointVelocity.dot(normal);
      const damping = normalSpeed < 0 ? compressionDamping : reboundDamping;
      wheel.load = clamp(stiffness * wheel.compression - damping * normalSpeed, 0, 15000);
      body.applyForce(normal.scale(wheel.load, force), arm);

      const angle = wheel.front ? this.steering : 0;
      localWheelForward.set(Math.sin(angle), 0, Math.cos(angle));
      body.quaternion.vmult(localWheelForward, forward);
      normal.scale(forward.dot(normal), projection);
      forward.vsub(projection, forward);
      forward.normalize();
      normal.cross(forward, right); right.normalize();
      const longSpeed = pointVelocity.dot(forward);
      const sideSpeed = pointVelocity.dot(right);
      const slipAngle = Math.atan2(sideSpeed, Math.max(Math.abs(longSpeed), 2.5));
      // Smooth peak → progressive loss of grip, rather than instantly cancelling sideways velocity.
      const peak = 0.27;
      const slipRatio = Math.abs(slipAngle) / peak;
      const tireCurve = Math.tanh(slipRatio * 1.5) * (1 - 0.23 * clamp(slipRatio - 1, 0, 2) / 2);
      let mu = this.tuning.grip * (wheel.front ? 1.09 : 1.02);
      if (input.handbrake && !wheel.front) mu *= 0.36;
      // Load sensitivity prevents outside tires from gaining unlimited grip with weight transfer.
      const capacity = mu * wheel.load * Math.pow(3924 / Math.max(wheel.load, 500), 0.12);
      let sideForce = -Math.sign(slipAngle) * capacity * tireCurve;
      sideForce = clamp(sideForce, -Math.abs(sideSpeed) * body.mass / (4 * dt), Math.abs(sideSpeed) * body.mass / (4 * dt));
      // Rear-biased AWD gives arcade acceleration without scripted velocity changes.
      const gear = Math.min(5, 1 + Math.floor(absSpeed / 9));
      const gearFactor = [0, 1, 0.94, 0.88, 0.8, 0.72][gear];
      let driveForce = this.throttle * (wheel.front ? 3200 : 6500) * this.tuning.power * gearFactor * tractionForDamage(this.damage);
      if ((speed > 48 && driveForce > 0) || (speed < -16 && driveForce < 0)) driveForce = 0;
      const brakeStrength = braking * (wheel.front ? 5800 : 4000) + (input.handbrake && !wheel.front ? 6500 : 0);
      const rolling = wheel.load * 0.008;
      const brakeForce = -Math.sign(longSpeed) * Math.min(brakeStrength + rolling, Math.abs(longSpeed) * body.mass / (4 * dt));
      let longForce = driveForce + brakeForce;
      const demand = Math.hypot(sideForce, longForce);
      const saturation = Math.min(1, capacity / Math.max(demand, 0.001));
      sideForce *= saturation; longForce *= saturation;
      right.scale(sideForce, tireForce);
      forward.scale(longForce, force2);
      tireForce.vadd(force2, tireForce);
      // Arcade roll center: retain weight transfer, reduce overturning torque at speed.
      body.applyForce(tireForce, v(arm.x, arm.y * 0.55, arm.z));
      wheel.lateral = sideSpeed; wheel.longitudinal = longSpeed;
      wheel.slip = Math.max(0, slipRatio - 0.8, demand / Math.max(capacity, 1) - 1);
      wheel.rotation += longSpeed / wheel.radius * dt;
    }
    // Mild anti-roll bars: preserve visible lean, avoid uncontrolled oscillation.
    for (let axle = 0; axle < 2; axle++) {
      const left = this.wheels[axle * 2], right = this.wheels[axle * 2 + 1];
      if (!left.grounded || !right.grounded) continue;
      const force = (left.compression - right.compression) * 5200;
      body.quaternion.vmult(left.mount, leftArm);
      body.applyForce(up.scale(force, rollForce), leftArm);
      body.quaternion.vmult(right.mount, rightArm);
      body.applyForce(up.scale(-force, force2), rightArm);
    }
    const velocity = body.velocity;
    // Rolling/transmission drag preserves a real coast-down at city speeds; quadratic drag adds highway resistance.
    dragForce.set(-velocity.x * (155 + Math.abs(velocity.x) * 0.3), 0, -velocity.z * (155 + Math.abs(velocity.z) * 0.3));
    body.applyForce(dragForce);
  }

  postStep(dt = STEP) {
    this.syncWheelPositions();
    this.time += dt;
  }

  step(input = {}, dt = STEP) {
    this.prepare(input, dt);
    this.world.step(dt);
    this.postStep(dt);
  }

  // Visual snapshots must correspond to the post-step chassis, not the force raycasts
  // made before integration. Otherwise wheels visibly lag behind at high speeds.
  syncWheelPositions() {
    const { localUp, up, origin, rayDelta, rayEnd } = this.scratch;
    this.body.quaternion.vmult(localUp, up);
    for (const wheel of this.wheels) {
      if (wheel.detached) continue;
      this.body.pointToWorldFrame(wheel.mount, origin);
      up.scale(-(0.68 + wheel.radius), rayDelta);
      origin.vadd(rayDelta, rayEnd);
      wheel.result.reset();
      this.world.raycastClosest(origin, rayEnd, this.wheelRaycastOptions, wheel.result);
      const length = wheel.result.hasHit && up.y > 0.15 ? clamp(wheel.result.distance - wheel.radius, 0.1, 0.68) : 0.68;
      wheel.position.copy(origin.vadd(up.scale(-length)));
    }
  }

  telemetry() {
    const forward = this.body.quaternion.vmult(v(0, 0, 1));
    const right = this.body.quaternion.vmult(v(1, 0, 0));
    const speed = this.body.velocity.length();
    return {
      position: { ...this.body.position }, speed: speed * 3.6, signedSpeed: this.signedSpeed,
      heading: Math.atan2(forward.x, forward.z), roll: Math.asin(clamp(right.y, -1, 1)),
      steer: this.steering, grounded: this.wheels.filter(w => w.grounded).length,
      slip: Math.max(...this.wheels.map(w => w.slip)),
      gear: speed < 0.2 ? 'N' : this.signedSpeed < -0.3 ? 'R' : String(Math.min(5, 1 + Math.floor(speed / 9))),
      damage: this.damage, damageState: damageState(this.damage), traction: tractionForDamage(this.damage), lastImpactSpeed: this.lastImpactSpeed,
    };
  }
}
