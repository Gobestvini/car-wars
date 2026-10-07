import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createCityPlan } from '../src/city-generator.js';
import { createCityScene } from '../src/city-scene.js';
import { createTraffic } from '../src/traffic.js';
import { footprintsOverlap } from '../src/traffic-spawn.js';

test('overhead city traffic stays alive for five minutes, including offscreen cars', () => {
  const plan = createCityPlan(), scene = new THREE.Scene(), player = new CarSimulation();
  const city = createCityScene(scene, player, plan);
  const obstacles = plan.buildings.map(b => ({ x: b.x, z: b.z, halfX: b.width / 2, halfZ: b.depth / 2 }));
  const traffic = createTraffic(scene, THREE, 60, plan.roadNetwork, plan.roadWidth, obstacles);
  traffic.attachPhysics(player);
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.5, 1000);
  camera.position.set(0, 450, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const previous = new Map(), distance = new Map(), total = new Map();
  const visitedSectors = new Set();
  const sector = value => Math.max(0, Math.min(2, Math.floor((value + plan.bounds) / (2 * plan.bounds) * 3)));
  let maximumIdle = 0, idle = 0;
  try {
    for (let tick = 0; tick < 300 / STEP; tick++) {
      traffic.stepWorld({ brake: 1 }, STEP);
      let moving = 0;
      for (const car of traffic.states) {
        const before = previous.get(car.id);
        const travel = before ? Math.hypot(car.x - before[0], car.z - before[1]) : 0;
        assert.ok(travel < 0.2, `position jump for ${car.id}: ${travel}`);
        distance.set(car.id, (distance.get(car.id) || 0) + travel);
        total.set(car.id, (total.get(car.id) || 0) + travel);
        previous.set(car.id, [car.x, car.z]);
        if (car.speed > 0.5) moving++;
      }
      idle = moving < 6 ? idle + STEP : 0;
      maximumIdle = Math.max(maximumIdle, idle);
      // A brief overlap between one-second render samples is still a collision.
      for (let a = 0; a < traffic.states.length; a++) for (let b = a + 1; b < traffic.states.length; b++) {
        const first = traffic.states[a], second = traffic.states[b];
        if ((first.x - second.x) ** 2 + (first.z - second.z) ** 2 < 36) {
          assert.equal(footprintsOverlap(first, second), false, `overlap ${first.id}/${second.id} at ${(tick + 1) * STEP}s`);
        }
      }
      if ((tick + 1) % 120 === 0) {
        for (const car of traffic.states) visitedSectors.add(`${sector(car.x)}:${sector(car.z)}`);
        // Rendering and camera culling must never pause the logical simulation.
        if (tick * STEP > 150) camera.position.set(1500, 450, 0);
        camera.lookAt(camera.position.x, 0, 0); camera.updateMatrixWorld();
        traffic.render(1, camera);
      }
      if ((tick + 1) % 7200 === 0) {
        assert.equal(traffic.states.length, 60);
        const active = [...distance.values()].filter(metres => metres > 5).length;
        assert.equal(active, 60, `only ${active}/60 progressed in window ending ${(tick + 1) * STEP}s: ${JSON.stringify(traffic.debug())}`);
        assert.ok([...traffic.reservations.values()].every(r => !r.entered || traffic.simulationTime() - r.time < 20),
          `junction held indefinitely at ${(tick + 1) * STEP}s`);
        distance.clear();
      }
    }
    assert.ok(maximumIdle < 2, `city became motionless for ${maximumIdle}s`);
    assert.ok([...total.values()].every(metres => metres > 150), `cars stopped making progress: ${JSON.stringify([...total])}`);
    assert.equal(visitedSectors.size, 9, `traffic did not visit every city sector: ${[...visitedSectors]}`);
    assert.equal(traffic.status().visible, 0);
  } finally { traffic.dispose(); city.dispose(); }
});
