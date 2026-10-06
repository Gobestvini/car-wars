import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan } from '../src/city-generator.js';
import { getSignalPosition, getStopLineLayout } from '../src/signal-layout.js';
import { signalGlowLayout } from '../src/signal-glow.js';
import { createCityScene } from '../src/city-scene.js';
import { createTrafficSignals } from '../src/traffic-signals.js';
import * as THREE from 'three';

test('signals and stop lines use independently expected right-hand world coordinates', () => {
  for (const width of [12, 15, 20, 30]) {
    const along = width / 2 + 3, lateral = width / 2 + 1;
    const stop = width / 2 + 1.5, lane = width / 4;
    const cases = [
      [1, 0, 0, 1, -along, lateral, -stop, lane],
      [-1, 0, 0, -1, along, -lateral, stop, -lane],
      [0, 1, -1, 0, -lateral, -along, -lane, -stop],
      [0, -1, 1, 0, lateral, along, lane, stop],
    ];
    for (const [forwardX, forwardZ, rightX, rightZ, sx, sz, lx, lz] of cases) {
      const approach = { forwardX, forwardZ, rightX, rightZ };
      assert.deepEqual(getSignalPosition({ x: 0, z: 0 }, approach, width, 2), { x: sx, z: sz });
      const line = getStopLineLayout({ x: 0, z: 0 }, approach, width);
      assert.deepEqual([line.x, line.z], [lx, lz]);
    }
  }
});

test('signal assemblies sit fully inside approach sidewalks for every cardinal direction and road width', () => {
  for (const roadWidth of [12, 15, 20, 30]) {
    const plan = createCityPlan(undefined, { roadWidth });
    for (const edge of plan.roadNetwork.edges) for (const [fromId, nodeId] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const node = plan.roadNetwork.intersections.find(item => item.id === nodeId);
      const from = plan.roadNetwork.intersections.find(item => item.id === fromId);
      const dx = node.x - from.x, dz = node.z - from.z, length = Math.hypot(dx, dz);
      const approach = { forwardX: dx / length, forwardZ: dz / length, rightX: -dz / length, rightZ: dx / length };
      const signal = getSignalPosition(node, approach, roadWidth, plan.sidewalkWidth);
      const along = (node.x - signal.x) * approach.forwardX + (node.z - signal.z) * approach.forwardZ;
      const lateral = (signal.x - node.x) * approach.rightX + (signal.z - node.z) * approach.rightZ;
      assert.ok(along > roadWidth / 2 && along < plan.blockPitch - roadWidth / 2);
      assert.ok(lateral - 0.3 > roadWidth / 2);
      assert.ok(lateral + 0.3 < roadWidth / 2 + plan.sidewalkWidth);
    }
  }
});

test('glow pools extend into the incoming half-road in all four world directions', () => {
  for (const width of [12, 15, 30]) for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const approach = { forwardX: fx, forwardZ: fz, rightX: -fz, rightZ: fx };
    const line = getStopLineLayout({ x: 0, z: 0 }, approach, width);
    const glow = signalGlowLayout({ ...approach, stopX: line.x, stopZ: line.z }, width);
    assert.ok((glow.x - line.x) * fx + (glow.z - line.z) * fz < 0);
    const lateral = glow.x * -fz + glow.z * fx;
    assert.ok(lateral - glow.width / 2 > 0);
    assert.ok(lateral + glow.width / 2 < width / 2);
  }
});

test('four signal assemblies persist and glow colors follow the controller on the real city', () => {
  const plan = createCityPlan(), scene = new THREE.Scene();
  const city = createCityScene(scene, { addStaticBox: () => ({}), removeStaticBox() {} }, plan);
  const controller = createTrafficSignals(plan.roadNetwork);
  const counts = new Map();
  for (const approach of city.signalApproaches) counts.set(approach.nodeId, (counts.get(approach.nodeId) || 0) + 1);
  assert.equal(counts.size, controller.controlled.size);
  assert.ok([...counts.values()].every(count => count === 4));
  const color = new THREE.Color();
  const expected = { red: '#f34f45', green: '#51d28b', yellow: '#ffc34a' };
  for (const time of [0, 16, 18, 19, 35, 37, 38]) {
    city.updateSignals(controller, time);
    city.signalApproaches.forEach((approach, i) => {
      assert.equal(approach.signalVisible, true);
      const phase = controller.phase(approach.nodeId, approach.fromId, time).color;
      city.signalGlow.getColorAt(i, color);
      assert.equal(color.getHexString(), new THREE.Color(expected[phase]).getHexString());
    });
  }
  city.dispose(); assert.equal(scene.children.length, 0);
});

test('stop lines span only the incoming half-road and share an approach plane', () => {
  for (const roadWidth of [12, 15, 20, 30]) for (const [forwardX, forwardZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const approach = { forwardX, forwardZ, rightX: -forwardZ, rightZ: forwardX };
    const node = { x: 25, z: -25 };
    const line = getStopLineLayout(node, approach, roadWidth);
    const fromNodeX = node.x - line.x, fromNodeZ = node.z - line.z;
    const along = fromNodeX * forwardX + fromNodeZ * forwardZ;
    const lateral = (line.x - node.x) * approach.rightX + (line.z - node.z) * approach.rightZ;
    assert.equal(along, roadWidth / 2 + 1.5);
    assert.equal(line.distanceFromNode, along);
    assert.equal(lateral, roadWidth / 4);
    assert.equal(line.length, roadWidth / 2 - 0.3);
    assert.equal(line.thickness, 0.4);
    assert.ok(lateral - line.length / 2 >= 0);
    assert.ok(lateral + line.length / 2 <= roadWidth / 2);
  }
});
