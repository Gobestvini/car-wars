import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan } from '../src/city-generator.js';
import { getSignalPosition, getStopLineLayout, isSignalFacingCamera } from '../src/signal-layout.js';

test('signal assemblies sit fully inside approach sidewalks for every cardinal direction and road width', () => {
  for (const roadWidth of [12, 15, 20, 30]) {
    const plan = createCityPlan(undefined, { roadWidth });
    for (const edge of plan.roadNetwork.edges) for (const [fromId, nodeId] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const node = plan.roadNetwork.intersections.find(item => item.id === nodeId);
      const from = plan.roadNetwork.intersections.find(item => item.id === fromId);
      const dx = node.x - from.x, dz = node.z - from.z, length = Math.hypot(dx, dz);
      const approach = { forwardX: dx / length, forwardZ: dz / length, rightX: dz / length, rightZ: -dx / length };
      const signal = getSignalPosition(node, approach, roadWidth, plan.sidewalkWidth);
      const along = (node.x - signal.x) * approach.forwardX + (node.z - signal.z) * approach.forwardZ;
      const lateral = (signal.x - node.x) * approach.rightX + (signal.z - node.z) * approach.rightZ;
      assert.ok(along > roadWidth / 2 && along < plan.blockPitch - roadWidth / 2);
      assert.ok(lateral - 0.3 > roadWidth / 2);
      assert.ok(lateral + 0.3 < roadWidth / 2 + plan.sidewalkWidth);
    }
  }
});

test('signal facing mask hides the back with a stable hysteresis band', () => {
  const signal = { signalX: 0, signalZ: 0, forwardX: 1, forwardZ: 0 };
  assert.equal(isSignalFacingCamera(signal, { x: -4, z: 0 }, true), true);
  assert.equal(isSignalFacingCamera(signal, { x: 4, z: 0 }, true), false);
  assert.equal(isSignalFacingCamera(signal, { x: 0.5, z: 0 }, true), true);
  assert.equal(isSignalFacingCamera(signal, { x: 0.5, z: 0 }, false), false);
  assert.equal(isSignalFacingCamera(signal, { x: -2, z: 0 }, false), true);
});

test('stop lines span only the incoming half-road and share an approach plane', () => {
  for (const roadWidth of [12, 15, 20, 30]) for (const [forwardX, forwardZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const approach = { forwardX, forwardZ, rightX: forwardZ, rightZ: -forwardX };
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
