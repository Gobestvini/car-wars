import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { createTraffic } from '../src/traffic.js';
import { createRoadGraph } from '../src/traffic-ai.js';
import { escapeRoute, hiddenFromPlayer, TRAFFIC_EVASION } from '../src/traffic-evasion.js';

const straight = { intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 500, z: 0 }],
  edges: [{ from: 'a', to: 'b', length: 500 }] };
const green = { phase: () => ({ color: 'green', controlled: true, canEnter: true }) };
function fixture() {
  const player = new CarSimulation({ damage: false });
  const traffic = createTraffic(new THREE.Scene(), THREE, 1, straight, 20);
  traffic.attachPhysics(player); traffic.setSignalController(green);
  const state = traffic.states[0], body = state.simulation.body;
  body.position.set(30, 0.96, 5); body.quaternion.setFromEuler(0, Math.PI / 2, 0);
  Object.assign(state, { x: 30, z: 5, heading: Math.PI / 2 });
  Object.assign(state.ai, { fromNode: 'a', targetNode: 'b', route: ['b', 'a'], routeIndex: 0 });
  return { player, traffic, state };
}
function step(traffic, seconds) { for (let i = 0; i < seconds / STEP; i++) traffic.stepWorld({ brake: 1 }, STEP); }

test('escape destination prefers cover and avoids an immediate turn back into the player', () => {
  const network = { intersections: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 50, z: 0 },
    { id: 'c', x: 100, z: 0 }, { id: 'd', x: 50, z: 50 }], edges: [
    { from: 'a', to: 'b', length: 50 }, { from: 'b', to: 'c', length: 50 }, { from: 'b', to: 'd', length: 50 }] };
  const graph = createRoadGraph(network, 5), edge = graph.adjacency.get('a')[0];
  const player = { x: 20, z: 0 }, cover = [{ x: 40, z: 30, halfX: 15, halfZ: 8 }];
  assert.equal(hiddenFromPlayer({ x: 50, z: 50 }, player, cover), true);
  assert.equal(hiddenFromPlayer({ x: 100, z: 0 }, player, cover), false);
  assert.deepEqual(escapeRoute(graph, edge, player, cover), ['b', 'd']);
});

test('a real player impact triggers fast escape, survives logical LOD, then resumes normal driving', () => {
  const { traffic, player, state } = fixture();
  try {
    player.body.position.set(24.5, 0.96, 5); player.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
    player.body.velocity.set(10, 0, 0); player.body.aabbNeedsUpdate = true;
    step(traffic, 0.8);
    assert.ok(state.ai.evasion, 'real chassis contact did not trigger escape');
    const afterImpact = state.x, id = state.id;
    player.body.position.set(10, 0.96, 5); player.body.velocity.setZero(); player.body.aabbNeedsUpdate = true;
    let maximumSpeed = 0, sawFleeing = false, sawLogical = false, previous = [state.x, state.z];
    for (let i = 0; i < 12 / STEP; i++) {
      traffic.stepWorld({ brake: 1 }, STEP);
      maximumSpeed = Math.max(maximumSpeed, state.speed);
      sawFleeing ||= state.ai.state === 'fleeing'; sawLogical ||= state.logical;
      assert.ok(Math.hypot(state.x - previous[0], state.z - previous[1]) < 0.2, 'escape teleported the car');
      previous = [state.x, state.z];
    }
    assert.ok(sawFleeing && sawLogical);
    assert.ok(maximumSpeed > 13, `escape did not accelerate: ${maximumSpeed}`);
    assert.ok(state.x > afterImpact + 80, `NPC did not leave player: ${state.x - afterImpact}`);
    step(traffic, 12);
    assert.equal(state.ai.evasion, null);
    assert.equal(state.ai.state, 'following'); assert.equal(state.id, id);
    assert.ok(state.speed < 8.5);
  } finally { traffic.dispose(); }
});

test('touching without an impact does not trigger escape, reset cancels an active escape', () => {
  const { traffic, player, state } = fixture();
  try {
    player.body.position.set(25.86, 0.96, 5); player.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
    player.body.aabbNeedsUpdate = true;
    step(traffic, 0.2);
    assert.ok(!state.ai.evasion);
    state.ai.evasion = { startedAt: 0, lastImpactAt: 0, nextReplanAt: Infinity };
    state.ai.playerImpactPending = true;
    traffic.reset();
    assert.equal(state.ai.evasion, null); assert.equal(state.ai.playerImpactPending, false);
  } finally { traffic.dispose(); }
});

test('escape ignores a red light while normal driving resumes signal compliance', () => {
  const { traffic, player, state } = fixture();
  try {
    player.body.position.set(460, 0.96, -20); player.body.aabbNeedsUpdate = true;
    state.simulation.body.position.set(480, 0.96, 5); state.simulation.body.aabbNeedsUpdate = true;
    state.ai.evasion = { startedAt: 0, lastImpactAt: 0, nextReplanAt: Infinity };
    traffic.setSignalController({ phase: () => ({ color: 'red', controlled: true, canEnter: false }) });
    step(traffic, 3);
    assert.ok(state.ai.evasion);
    assert.notEqual(state.ai.waitReason, 'signal-red');
    assert.ok(state.x > 495, `escape still stopped at red: ${state.x}`);
    state.ai.evasion = null;
    state.simulation.body.position.set(480, 0.96, 5);
    state.simulation.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
    state.simulation.body.velocity.setZero(); state.simulation.body.angularVelocity.setZero();
    state.simulation.body.aabbNeedsUpdate = true;
    traffic.reservations.clear();
    Object.assign(state.ai, { fromNode: 'a', targetNode: 'b', route: ['b', 'a'], routeIndex: 0, reservationNode: null });
    step(traffic, 3);
    assert.equal(state.ai.waitReason, 'signal-red');
    assert.ok(state.x + 2.08 < 488.5);
    assert.ok(TRAFFIC_EVASION.maximumDuration > TRAFFIC_EVASION.minimumDuration);
  } finally { traffic.dispose(); }
});

test('front and side player impacts release contact before the NPC accelerates away', () => {
  for (const side of ['front', 'side']) {
    const { traffic, player, state } = fixture();
    try {
      player.body.position.set(side === 'front' ? 35.5 : 30, 0.96, side === 'front' ? 5 : 0);
      player.body.quaternion.setFromEuler(0, side === 'front' ? -Math.PI / 2 : 0, 0);
      player.body.velocity.set(side === 'front' ? -10 : 0, 0, side === 'front' ? 0 : 10);
      player.body.aabbNeedsUpdate = true;
      let triggered = false, maximumSpeed = 0;
      for (let i = 0; i < 15 / STEP; i++) {
        traffic.stepWorld({ brake: 1 }, STEP);
        triggered ||= Boolean(state.ai.evasion);
        maximumSpeed = Math.max(maximumSpeed, state.speed);
      }
      assert.ok(triggered, `${side} impact was ignored`);
      assert.ok(state.x > 75 && maximumSpeed > 9, `${side} contact did not release: ${state.x}, speed ${maximumSpeed}`);
      step(traffic, 10);
      assert.equal(state.ai.evasion, null);
    } finally { traffic.dispose(); }
  }
});

test('ignoring signs during escape does not disable braking for an occupied lane', () => {
  const { traffic, player, state } = fixture();
  try {
    player.body.position.set(45, 0.96, 5); player.body.quaternion.setFromEuler(0, Math.PI / 2, 0);
    player.body.aabbNeedsUpdate = true;
    state.ai.evasion = { startedAt: 0, lastImpactAt: 0, nextReplanAt: Infinity };
    step(traffic, 5);
    assert.ok(state.ai.evasion);
    assert.ok(state.x + 2.08 < player.body.position.x - 2.08);
    assert.ok(state.ai.targetSpeed < 0.5, `escape ignored its leader: ${state.ai.targetSpeed}`);
  } finally { traffic.dispose(); }
});
