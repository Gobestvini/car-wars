import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createCityPlan } from '../src/city-generator.js';
import { createCityScene } from '../src/city-scene.js';
import { createTraffic } from '../src/traffic.js';
import { footprintsOverlap } from '../src/traffic-spawn.js';
import { followingLimit } from '../src/traffic-planner.js';

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
  const performanceSamples = [];
  const lod = { physicalSeen: false, logicalSeen: false, maxPhysical: 0, maxLogical: 0 };
  const sector = value => Math.max(0, Math.min(2, Math.floor((value + plan.bounds) / (2 * plan.bounds) * 3)));
  let maximumIdle = 0, idle = 0;
  const stopById = new Map(), stopIntervals = [];
  const clearSince = new Map(), clearDurations = [];
  const blockedReasons = new Set(['signal-red', 'signal-yellow', 'intersection-reservation', 'oncoming-priority',
    'blocked-junction-exit', 'queue-wait', 'blocked-by-leader', 'collision-jam', 'turn-staging', 'maneuver', 'maneuver-blocked']);
  const blockingEvidence = car => {
    const blocker = traffic.states.find(other => other.id === car.ai.blocker);
    if (!blocker) return null;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const limit = followingLimit(car.occupancyItem, blocker.occupancyItem, fx, fz);
    return { id: blocker.id, limit: Number(limit.toFixed(2)), overlap: footprintsOverlap(car, blocker, 0.12),
      x: Number(blocker.x.toFixed(2)), z: Number(blocker.z.toFixed(2)), speed: Number(blocker.speed.toFixed(2)) };
  };
  try {
    for (let tick = 0; tick < 300 / STEP; tick++) {
      traffic.stepWorld({ brake: 1 }, STEP);
      let moving = 0;
      for (const car of traffic.states) {
        const now = (tick + 1) * STEP;
        const stopped = Math.abs(car.speed) < 0.3;
        const blocked = blockedReasons.has(car.ai.waitReason) || Boolean(car.ai.blocker && car.ai.leaderLimit < 8);
        let interval = stopById.get(car.id);
        if (stopped && !interval) {
          interval = { id: car.id, start: now - STEP, reasons: new Set(), blockers: new Set(),
            startState: { x: car.x, z: car.z, reason: car.ai.waitReason || null, targetSpeed: car.ai.targetSpeed ?? null,
              progress: car.ai.progressAlong ?? null, noProgressTime: car.ai.noProgressTime || 0,
              blocker: blockingEvidence(car) } };
          stopById.set(car.id, interval);
        }
        if (stopped) {
          if (blocked) clearSince.delete(car.id);
          else if (!clearSince.has(car.id)) clearSince.set(car.id, now - STEP);
          if (car.ai.waitReason) interval.reasons.add(car.ai.waitReason);
          if (car.ai.blocker) interval.blockers.add(car.ai.blocker);
          interval.endState = { x: car.x, z: car.z, reason: car.ai.waitReason || null, targetSpeed: car.ai.targetSpeed ?? null,
            progress: car.ai.progressAlong ?? null, noProgressTime: car.ai.noProgressTime || 0,
            blocker: blockingEvidence(car) };
        } else if (interval) {
          interval.end = now;
          if (interval.end - interval.start > 1) stopIntervals.push(interval);
          stopById.delete(car.id);
        }
        if (!stopped && clearSince.has(car.id)) {
          clearDurations.push(now - clearSince.get(car.id));
          clearSince.delete(car.id);
        }
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
        const status = traffic.status();
        lod.physicalSeen ||= status.bodies > 0; lod.logicalSeen ||= status.logical > 0;
        lod.maxPhysical = Math.max(lod.maxPhysical, status.bodies); lod.maxLogical = Math.max(lod.maxLogical, status.logical);
        performanceSamples.push(traffic.performance());
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
    for (const interval of stopById.values()) {
      interval.end = traffic.simulationTime();
      if (interval.end - interval.start > 1) stopIntervals.push(interval);
    }
    const stopAudit = stopIntervals.map(({ id, start, end, reasons, blockers, startState, endState }) => ({ id,
      start: Number(start.toFixed(2)), duration: Number((end - start).toFixed(2)), reasons: [...reasons],
      blockers: [...blockers], startState, endState }));
    console.log(`TRAFFIC_STOP_AUDIT ${JSON.stringify({ count: stopAudit.length, unexplained: stopAudit.filter(stop => !stop.reasons.length).length,
      reasonCounts: Object.fromEntries(stopAudit.flatMap(stop => stop.reasons).reduce((counts, reason) => counts.set(reason, (counts.get(reason) || 0) + 1), new Map())),
      controllerStall: stopAudit.filter(stop => stop.reasons.includes('controller-stall')).slice(0, 12),
      stagingOnly: stopAudit.filter(stop => stop.reasons.length === 1 && stop.reasons[0] === 'turn-staging').slice(0, 8) })}`);
    assert.equal(stopAudit.filter(stop => stop.reasons.includes('controller-stall')).length, 0,
      `long stop intervals ended with controller-stall instead of an evidenced wait: ${JSON.stringify(stopAudit.filter(stop => stop.reasons.includes('controller-stall')).slice(0, 4))}`);
    assert.equal(stopAudit.filter(stop => stop.reasons.includes('no-path')).length, 0,
      `long stop intervals have no route: ${JSON.stringify(stopAudit.filter(stop => stop.reasons.includes('no-path')).slice(0, 4))}`);
    assert.ok(stopAudit.every(stop => stop.reasons.length > 0), `long waits without a reason: ${JSON.stringify(stopAudit.filter(stop => !stop.reasons.length).slice(0, 4))}`);
    const leaderReasons = new Set(['queue-wait', 'blocked-by-leader', 'no-safe-passing-lane']);
    assert.ok(stopAudit.every(stop => !stop.reasons.some(reason => leaderReasons.has(reason)) || stop.blockers.length > 0),
      `leader wait lacks a blocker identity: ${JSON.stringify(stopAudit.filter(stop => stop.reasons.some(reason => leaderReasons.has(reason)) && !stop.blockers.length).slice(0, 4))}`);
    assert.ok(clearDurations.every(duration => duration <= 2), `movement did not resume within2s after blockage cleared: ${JSON.stringify(clearDurations.filter(duration => duration > 2).slice(0, 8))}`);
    assert.ok([...clearSince].every(([, start]) => traffic.simulationTime() - start <= 2),
      `clear corridor remained stopped through end of trace: ${JSON.stringify([...clearSince].slice(0, 8))}`);
    assert.equal(lod.physicalSeen, true, `the 60-car trace never exercised physical LOD: ${JSON.stringify(lod)}`);
    assert.equal(lod.logicalSeen, true, `the 60-car trace never exercised logical LOD: ${JSON.stringify(lod)}`);
    const p95 = key => {
      const values = performanceSamples.map(sample => sample[key]).sort((a, b) => a - b);
      return values[Math.ceil(values.length * 0.95) - 1];
    };
    console.log(`TRAFFIC_FLOW_PROFILE ${JSON.stringify({ samples: performanceSamples.length, aiMsP95: p95('aiMs'),
      prepareMsP95: p95('prepareMs'), worldStepMsP95: p95('worldStepMs'), physicalMax: lod.maxPhysical,
      logicalMax: lod.maxLogical, physicalAndLogicalBothObserved: lod.physicalSeen && lod.logicalSeen })}`);
    assert.equal(traffic.status().visible, 0);
  } finally { traffic.dispose(); city.dispose(); }
});

test('cause-aware traffic waits hold across city seeds and road widths', () => {
  for (const [seed, roadWidth] of [[20261005, 12], [20261006, 15], [20261007, 30]]) {
    const plan = createCityPlan(seed, { roadWidth }), scene = new THREE.Scene(), player = new CarSimulation();
    const city = createCityScene(scene, player, plan);
    const obstacles = plan.buildings.map(b => ({ x: b.x, z: b.z, halfX: b.width / 2, halfZ: b.depth / 2 }));
    const traffic = createTraffic(scene, THREE, 60, plan.roadNetwork, roadWidth, obstacles);
    traffic.attachPhysics(player);
    const camera = new THREE.PerspectiveCamera(50, 1.5, 0.5, 1000);
    camera.position.set(0, 450, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const distance = new Map(), previous = new Map(), waiting = new Map(), clearSince = new Map();
    const allowed = new Set(['signal-red', 'signal-yellow', 'intersection-reservation', 'oncoming-priority',
      'blocked-junction-exit', 'queue-wait', 'blocked-by-leader', 'collision-jam', 'no-safe-passing-lane',
      'turn-staging', 'maneuver', 'maneuver-blocked']);
    try {
      for (let tick = 0; tick < 30 / STEP; tick++) {
        traffic.stepWorld({ brake: 1 }, STEP);
        for (const car of traffic.states) {
          const now = (tick + 1) * STEP;
          const before = previous.get(car.id);
          if (before) distance.set(car.id, (distance.get(car.id) || 0) + Math.hypot(car.x - before.x, car.z - before.z));
          previous.set(car.id, { x: car.x, z: car.z });
          const reason = car.ai.waitReason;
          const blocked = allowed.has(reason) && !['controller-stall', 'no-path'].includes(reason)
            || Boolean(car.ai.blocker && car.ai.leaderLimit < 8);
          if (blocked) clearSince.delete(car.id);
          else if (!clearSince.has(car.id)) clearSince.set(car.id, now - STEP);
          if (Math.abs(car.speed) < 0.3) {
            const current = waiting.get(car.id) || { start: now, seconds: 0 };
            current.seconds += STEP;
            if (current.seconds > 1) {
              const blockerEvidence = Boolean(car.ai.blocker && car.ai.leaderLimit < 8);
              if (!blocked) assert.ok(now - clearSince.get(car.id) <= 2,
                `unexplained stop after clear corridor seed=${seed} width=${roadWidth} car=${car.id} t=${now.toFixed(2)} reason=${reason} blocker=${car.ai.blocker} limit=${car.ai.leaderLimit}`);
              else assert.ok(allowed.has(reason) || blockerEvidence || car.ai.staging || car.ai.maneuver,
                `stop lacks cause seed=${seed} width=${roadWidth} car=${car.id} t=${now.toFixed(2)} reason=${reason}`);
            }
            waiting.set(car.id, current);
            if (!blocked) assert.ok(now - clearSince.get(car.id) <= 2,
              `no movement within2s of clear corridor seed=${seed} width=${roadWidth} car=${car.id}`);
          } else {
            waiting.delete(car.id);
            clearSince.delete(car.id);
          }
        }
        if ((tick + 1) % 120 === 0) {
          if (tick * STEP > 15) camera.position.set(1500, 450, 0);
          camera.lookAt(camera.position.x, 0, 0); camera.updateMatrixWorld();
          traffic.render(1, camera);
        }
      }
      assert.equal(traffic.states.length, 60);
      assert.equal([...distance.values()].filter(metres => metres > 0.5).length, 60,
        `cars failed to move across seed=${seed}, width=${roadWidth}: ${JSON.stringify([...distance])}`);
    } finally { traffic.dispose(); city.dispose(); }
  }
});

test('traffic resumes after reducing a full 300-car congestion load', () => {
  const plan = createCityPlan(), scene = new THREE.Scene(), player = new CarSimulation();
  const city = createCityScene(scene, player, plan);
  const obstacles = plan.buildings.map(b => ({ x: b.x, z: b.z, halfX: b.width / 2, halfZ: b.depth / 2 }));
  const traffic = createTraffic(scene, THREE, 300, plan.roadNetwork, plan.roadWidth, obstacles);
  traffic.attachPhysics(player);
  const previous = new Map(), distance = new Map();
  try {
    for (let tick = 0; tick < 15 / STEP; tick++) {
      traffic.stepWorld({ brake: 1 }, STEP);
      for (const car of traffic.states) {
        const before = previous.get(car.id);
        if (before) distance.set(car.id, (distance.get(car.id) || 0) + Math.hypot(car.x - before.x, car.z - before.z));
        previous.set(car.id, { x: car.x, z: car.z });
      }
    }
    assert.equal(traffic.states.length, 300, 'the full congestion load did not finish spawning');
    traffic.setCount(60);
    for (let tick = 0; tick < 15 / STEP; tick++) {
      traffic.stepWorld({ brake: 1 }, STEP);
      for (const car of traffic.states) {
        const before = previous.get(car.id);
        if (before) {
          const travel = Math.hypot(car.x - before.x, car.z - before.z);
          assert.ok(travel < 0.2, `count reduction teleported ${car.id} by ${travel}`);
          distance.set(car.id, (distance.get(car.id) || 0) + travel);
          previous.set(car.id, { x: car.x, z: car.z });
        }
      }
    }
    assert.equal(traffic.states.length, 60);
    assert.equal([...distance].filter(([id, metres]) => traffic.states.some(car => car.id === id) && metres > 0.5).length, 60,
      `remaining cars failed to resume after congestion cleared: ${JSON.stringify([...distance].slice(0, 70))}`);
  } finally { traffic.dispose(); city.dispose(); }
});
