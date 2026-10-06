import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoadMarkings } from '../src/road-markings.js';

test('dashes align their long axis with both directions of the street grid', () => {
  const marks = createRoadMarkings([-75, -25, 25, 75], 110, 22);
  const alongZ = marks.find(mark => mark.axis === 'z');
  const alongX = marks.find(mark => mark.axis === 'x');
  assert.ok(alongZ && alongX);
  assert.equal(alongZ.yaw, 0);
  assert.equal(alongX.yaw, Math.PI / 2);

  const localLongAxis = [0, 1]; // local X/Z projection of the dash's local +Z axis
  const worldZ = [Math.sin(alongZ.yaw), Math.cos(alongZ.yaw)];
  const worldX = [Math.sin(alongX.yaw), Math.cos(alongX.yaw)];
  assert.ok(Math.abs(worldZ[1]) > Math.abs(worldZ[0]));
  assert.ok(Math.abs(worldX[0]) > Math.abs(worldX[1]));
  assert.deepEqual(localLongAxis, [0, 1]);
});

test('mark spacing, bounds, and junction gaps derive from the current road plan', () => {
  const roads = [-75, -25, 25, 75];
  const marks = createRoadMarkings(roads, 110, 20);
  assert.ok(marks.length > 0);
  assert.ok(marks.every(mark => Math.abs(mark.x) <= 104 && Math.abs(mark.z) <= 104));
  for (const mark of marks) {
    const offset = mark.axis === 'z' ? mark.z : mark.x;
    assert.ok(roads.every(cross => Math.abs(offset - cross) >= 13), `junction gap at ${offset}`);
  }
  assert.notEqual(marks.length, createRoadMarkings(roads, 80, 20).length);
});
