import test from 'node:test';
import assert from 'node:assert/strict';
import { CarSimulation } from '../src/vehicle.js';

test('repair restores damage and detached wheels without resetting chassis, motion, time, or tuning', () => {
  const sim = new CarSimulation();
  sim.body.position.set(12, 1.4, -8); sim.body.quaternion.setFromEuler(0.1, 0.8, -0.05);
  sim.body.velocity.set(6, 1, -2); sim.body.angularVelocity.set(0.2, 0.3, 0.4);
  sim.body.previousPosition.set(11.9, 1.3, -8); sim.body.interpolatedPosition.set(12.1, 1.5, -8);
  sim.time = 17; sim.steering = 0.3; sim.throttle = 0.6; sim.tuning.grip = 2.3;
  sim.damage = 0.82; sim.lastImpactSpeed = 26; sim.impactEvents.push({ speed: 20 });
  sim.detachWheelAtImpact({ speed: 24, point: { x: sim.wheels[0].mount.x, y: 0, z: sim.wheels[0].mount.z }, normal: { x: 1, y: 0, z: 0 } });
  const detached = sim.wheels.find(wheel => wheel.detached)?.detachedBody;
  assert.ok(detached && sim.world.bodies.includes(detached));
  const position = sim.body.position.clone(), quaternion = sim.body.quaternion.clone();
  const velocity = sim.body.velocity.clone(), angularVelocity = sim.body.angularVelocity.clone();
  const previousPosition = sim.body.previousPosition.clone(), interpolatedPosition = sim.body.interpolatedPosition.clone();
  assert.equal(sim.repair(), true);
  assert.equal(sim.damage, 0); assert.equal(sim.lastImpactSpeed, 0); assert.equal(sim.impactEvents.length, 0);
  assert.ok(!sim.world.bodies.includes(detached));
  assert.ok(sim.wheels.every(wheel => !wheel.detached && !wheel.detachedBody));
  assert.deepEqual(sim.body.position, position); assert.deepEqual(sim.body.quaternion, quaternion);
  assert.deepEqual(sim.body.velocity, velocity); assert.deepEqual(sim.body.angularVelocity, angularVelocity);
  assert.deepEqual(sim.body.previousPosition, previousPosition); assert.deepEqual(sim.body.interpolatedPosition, interpolatedPosition);
  assert.equal(sim.time, 17); assert.equal(sim.steering, 0.3); assert.equal(sim.throttle, 0.6); assert.equal(sim.tuning.grip, 2.3);
  assert.equal(sim.repair(), false);
  sim.disposeDamageListener();
});
