import { attachForTrafficTest, framePrepare } from './traffic-frame-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarSimulation } from '../src/vehicle.js';
import { createTraffic, TRAFFIC_PHYSICS_ZONE } from '../src/traffic.js';

function fixture() {
  const player = new CarSimulation({ spawn: { x: 0, y: .96, z: 0, yaw: Math.PI / 2 } });
  const network = { intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 1000, z: 0 }],
    edges: [{ from: 'a', to: 'b', length: 1000 }] };
  const traffic = createTraffic(new THREE.Scene(), THREE, 1, network, 20);
  attachForTrafficTest(traffic, player);
  const state = traffic.states[0];
  const place = x => {
    const body = state.simulation.body;
    body.position.set(x, .96, 5); body.previousPosition.copy(body.position);
    body.velocity.setZero(); body.quaternion.setFromEuler(0, Math.PI / 2, 0);
    body.aabbNeedsUpdate = true; state.x = x; state.z = 5;
  };
  return { player, traffic, state, place };
}

test('physical zone has hysteresis and switches without replacing civilian geometry', () => {
  const { traffic, state, place } = fixture();
  const mesh = state.mesh, geometry = mesh.children[0].geometry;
  const vertices = geometry.attributes.position.array.slice();
  place(80); framePrepare(traffic, TRAFFIC_PHYSICS_ZONE.interval);
  assert.equal(state.logical, true);
  place(20); framePrepare(traffic, TRAFFIC_PHYSICS_ZONE.interval);
  assert.equal(state.logical, false);
  place(30); framePrepare(traffic, TRAFFIC_PHYSICS_ZONE.interval);
  assert.equal(state.logical, false);
  place(40); framePrepare(traffic, TRAFFIC_PHYSICS_ZONE.interval);
  assert.equal(state.logical, true);
  assert.equal(state.mesh, mesh); assert.equal(mesh.children[0].geometry, geometry);
  assert.deepEqual(geometry.attributes.position.array, vertices);
  assert.equal(state.simulation.hasDamage, false);
  assert.equal(mesh.userData.damageableBody, undefined);
  traffic.dispose();
});

test('fast approaching player activates collision physics before reaching the ordinary zone', () => {
  const { player, traffic, state, place } = fixture();
  place(65); framePrepare(traffic, .051); assert.equal(state.logical, true);
  player.body.velocity.set(60, 0, 0);
  framePrepare(traffic, .051); assert.equal(state.logical, false);
  // A receding player does not retain the same distant body.
  player.body.velocity.set(-60, 0, 0);
  framePrepare(traffic, .051); assert.equal(state.logical, true);
  traffic.dispose();
});

test('a remote collision and passing maneuver cannot retain full physics indefinitely', () => {
  const { player, traffic, state, place } = fixture();
  place(100);
  state.ai.maneuver = { kind: 'pass', points: [{ x: 100, z: 5 }, { x: 120, z: 5 }], index: 1 };
  const wall = player.addStaticBox({ x: 100, y: 1, z: 6, halfX: 1, halfY: 1, halfZ: 1 });
  player.world.contacts.push({ bi: wall, bj: state.simulation.body });
  framePrepare(traffic, .051);
  assert.equal(state.logical, true);
  assert.ok(!player.world.bodies.includes(state.simulation.body));
  traffic.dispose(); player.removeStaticBox(wall);
});
