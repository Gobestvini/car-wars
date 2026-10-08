import test from 'node:test';
import assert from 'node:assert/strict';
import { CarSimulation, STEP } from '../src/vehicle.js';

function measureDamage(multiplier, speed = 6) {
  const source = new CarSimulation();
  source.body.position.set(100, 0.96, 100);
  const police = new CarSimulation({ world: source.world, materials: source.materials,
    spawn: { x: 0, y: 0.96, z: 0, yaw: 0 }, damage: true, damageMultiplier: multiplier, allowWheelDetachment: false });
  police.addStaticBox({ x: 0, y: 0.9, z: 4.1, halfX: 2, halfY: 1, halfZ: 0.25 });
  police.body.position.set(0, 0.96, 0);
  police.body.quaternion.setFromEuler(0, 0, 0);
  police.body.velocity.set(0, 0, speed);
  for (let step = 0; step < 60 && police.damage === 0; step++) {
    source.prepare({}, STEP); police.prepare({}, STEP); source.world.step(STEP); source.postStep(STEP); police.postStep(STEP);
  }
  const result = { damage: police.damage, detached: police.wheels.some(wheel => wheel.detached),
    impacts: police.drainImpactEvents().length };
  police.disposeDamageListener(); source.world.removeBody(police.body); source.world.removeBody(police.staticBodies[0]);
  return result;
}

test('police take twice the normalized damage from the same real impact and keep their wheels attached', () => {
  const playerHit = measureDamage(1), policeHit = measureDamage(2);
  assert.ok(playerHit.damage > 0);
  assert.equal(policeHit.damage, playerHit.damage * 2);
  assert.ok(policeHit.impacts > 0);
  assert.equal(policeHit.detached, false);
});

test('police damage listener is explicitly removable without disabling another vehicle', () => {
  const player = new CarSimulation();
  player.body.position.set(100, 0.96, 100);
  const police = new CarSimulation({ world: player.world, materials: player.materials, damage: true, damageMultiplier: 2 });
  const listener = police.damageListener;
  assert.ok(listener);
  assert.equal(police.disposeDamageListener(), true);
  assert.equal(police.damageListener, null);
  assert.equal(police.disposeDamageListener(), false);
  police.world.removeBody(police.body);
});
