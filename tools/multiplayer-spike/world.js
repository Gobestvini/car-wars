// Research harness, not the production traffic runtime. No THREE or DOM imports.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CarSimulation, STEP } from '../../src/vehicle.js';
import { createCityPlan } from '../../src/city-generator.js';
import { createRoundedSidewalkLayout, createSidewalkSupportBoxes, createSidewalkSupportPrisms } from '../../src/road-surface.js';
import { createRoadGraph, createSeededRandom, chooseRoadGoal, findRoadRoute } from '../../src/traffic-ai.js';
import { driveControl, followingLimit, edgeProgress } from '../../src/traffic-planner.js';
import { createTrafficSpawnSlots, isTrafficSpawnSafe } from '../../src/traffic-spawn.js';
import { createTrafficSignals } from '../../src/traffic-signals.js';

export { STEP };
export const heading = q => Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
const vector = v => [v.x, v.y, v.z];
const quaternion = q => [q.x, q.y, q.z, q.w];
const neutral = () => ({ steer: 0, throttle: 0, brake: 1 });

export function colliderDescriptors(plan) {
  const middle = Math.floor(plan.roads.length / 2);
  const span = Math.abs(plan.roads[middle] - plan.roads[middle - 1]);
  const sidewalks = createRoundedSidewalkLayout(plan, plan.bounds, plan.roadWidth, plan.sidewalkWidth,
    { centerX: 0, centerZ: 0, width: span, depth: span });
  return {
    boxes: [...plan.buildings, ...plan.landmarks, ...plan.boundaryBuildings].map(b => ({
      x: b.x, y: b.height / 2, z: b.z, halfX: b.width / 2, halfY: b.height / 2, halfZ: b.depth / 2,
    })).concat(createSidewalkSupportBoxes(sidewalks.rectangles)),
    prisms: createSidewalkSupportPrisms(sidewalks.corners),
  };
}

export class SpikeWorld {
  constructor({ seed = 20261005, npcCount = 102, playerCount = 0, allPhysical = false } = {}) {
    this.plan = createCityPlan(seed);
    this.owner = new CarSimulation({ damage: false });
    this.world = this.owner.world;
    this.world.removeBody(this.owner.body);
    this.owner.disposeDamageListener();
    const colliders = colliderDescriptors(this.plan);
    for (const box of colliders.boxes) this.owner.addStaticBox(box);
    for (const prism of colliders.prisms) this.owner.addStaticConvex(prism);
    this.signature = createHash('sha256').update(JSON.stringify({ seed, roadWidth: this.plan.roadWidth,
      map: this.plan.signature, colliders })).digest('hex');
    this.colliders = colliders;
    this.graph = createRoadGraph(this.plan.roadNetwork, Math.min(5.2, this.plan.roadWidth * .25));
    this.slots = createTrafficSpawnSlots(this.graph.directed);
    this.signals = createTrafficSignals(this.plan.roadNetwork);
    this.players = new Map(); this.npcs = []; this.tick = 0; this.steps = 0; this.contacts = 0;
    this.allPhysical = allPhysical; this.slotCursor = 0;
    this.metrics = { stepMs: [], aiMs: [], physicalCounts: [], transitions: 0 };
    for (let i = 0; i < playerCount; i++) this.addPlayer(`scripted-${i}`);
    for (let i = 0; i < npcCount; i++) this.npcs.push(this.makeNpc(i));
  }
  occupants() {
    return [...this.players.values(), ...this.npcs].map(actor => this.occupancy(actor));
  }
  occupancy(actor) {
    const b = actor.sim.body;
    return { id: actor.id, x: b.position.x, z: b.position.z, heading: heading(b.quaternion), vx: b.velocity.x, vz: b.velocity.z };
  }
  spawnSlot() {
    const occupied = this.occupants();
    const obstacles = [...this.plan.buildings, ...this.plan.landmarks, ...this.plan.boundaryBuildings]
      .map(b => ({ x: b.x, z: b.z, halfX: b.width / 2, halfZ: b.depth / 2 }));
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[this.slotCursor++ % this.slots.length];
      if (isTrafficSpawnSafe(slot, occupied, obstacles)) return slot;
    }
    throw new Error('No safe spawn slot; requested population not created');
  }
  makeSim(slot, damage = true) {
    return new CarSimulation({ world: this.world, materials: this.owner.materials, damage,
      spawn: { x: slot.x, z: slot.z, y: .96, yaw: slot.heading } });
  }
  addPlayer(id) {
    if (this.players.size >= 3 || this.players.has(id)) throw new Error('Room full or duplicate player');
    const slot = this.spawnSlot(), actor = { id, role: 'player', generation: 1, sim: this.makeSim(slot),
      control: neutral(), pending: null, lastSeq: -1, receivedSeq: -1, lastInputTick: this.tick,
      lastAppliedTick: 0, connected: true };
    this.players.set(id, actor); return actor;
  }
  removePlayer(id) {
    const actor = this.players.get(id); if (!actor) return;
    this.removeSim(actor.sim); this.players.delete(id);
  }
  removeSim(sim) {
    sim.disposeDamageListener(); this.world.removeBody(sim.body);
    for (const w of sim.wheels) if (w.detachedBody) this.world.removeBody(w.detachedBody);
  }
  makeNpc(index) {
    const slot = this.spawnSlot();
    const actor = { id: `npc-${index}`, role: 'civilian', generation: 1, sim: this.makeSim(slot, false),
      control: neutral(), edge: slot.edge, random: createSeededRandom(this.plan.seed ^ index), route: [],
      physical: true, goal: null };
    this.planRoute(actor); return actor;
  }
  planRoute(actor) {
    actor.goal = chooseRoadGoal(this.graph, actor.edge.to, actor.random, actor.goal);
    actor.route = actor.goal ? findRoadRoute(this.graph, actor.edge.to, actor.goal).slice(1) : [];
  }
  input(id, input) {
    const actor = this.players.get(id);
    if (!actor || input.seq <= actor.receivedSeq) return false;
    actor.receivedSeq = input.seq; actor.pending = input; return true;
  }
  disconnect(id) {
    const actor = this.players.get(id);
    if (actor) { actor.connected = false; actor.pending = null; actor.control = neutral(); }
  }
  think() {
    const occupants = this.occupants();
    for (const actor of this.npcs) {
      const b = actor.sim.body;
      let progress = edgeProgress(b.position, actor.edge);
      if (progress >= actor.edge.length - 2) {
        if (!actor.route.length) this.planRoute(actor);
        const next = actor.route.shift();
        const edge = this.graph.adjacency.get(actor.edge.to)?.find(e => e.to === next);
        if (edge) { actor.edge = edge; progress = edgeProgress(b.position, edge); }
      }
      const look = Math.max(0, Math.min(1, (progress + 8) / actor.edge.length));
      const target = { x: actor.edge.start.x + (actor.edge.end.x - actor.edge.start.x) * look,
        z: actor.edge.start.z + (actor.edge.end.z - actor.edge.start.z) * look };
      const current = this.occupancy(actor), fx = Math.sin(actor.edge.heading), fz = Math.cos(actor.edge.heading);
      let speed = 11;
      for (const other of occupants) if (other.id !== actor.id) speed = Math.min(speed, followingLimit(current, other, fx, fz));
      const phase = this.signals.phase(actor.edge.to, actor.edge.from, this.tick * STEP);
      if (!phase.canEnter && progress > actor.edge.length - 16) speed = Math.min(speed, Math.max(0, actor.edge.length - 8 - progress));
      actor.control = driveControl(target.x - b.position.x, target.z - b.position.z, current.heading,
        Math.hypot(b.velocity.x, b.velocity.z), speed);
      const distance = Math.min(...[...this.players.values()].map(p => p.sim.body.position.distanceTo(b.position)));
      const touching = this.world.contacts.some(c => (c.bi === b && c.bj.mass > 0) || (c.bj === b && c.bi.mass > 0));
      const physical = this.allPhysical || distance < (actor.physical ? 36 : 24) || touching;
      if (physical !== actor.physical) {
        if (physical) { b.previousPosition.copy(b.position); b.previousQuaternion.copy(b.quaternion);
          b.aabbNeedsUpdate = true; b.wakeUp(); this.world.addBody(b); }
        else this.world.removeBody(b);
        actor.physical = physical; this.metrics.transitions++;
      }
    }
  }
  step() {
    const start = performance.now();
    for (const actor of this.players.values()) {
      if (actor.pending && actor.connected) {
        const { seq, ...control } = actor.pending;
        actor.control = control; actor.lastSeq = seq; actor.lastAppliedTick = this.tick + 1;
        actor.lastInputTick = this.tick; actor.pending = null;
      }
      if (!actor.connected || this.tick - actor.lastInputTick >= 30) actor.control = neutral();
      actor.sim.prepare(actor.control, STEP);
    }
    if (this.tick % 12 === 0) { const begin = performance.now(); this.think(); this.metrics.aiMs.push(performance.now() - begin); }
    for (const actor of this.npcs) {
      if (actor.physical) actor.sim.prepare(actor.control, STEP);
      else {
        const b = actor.sim.body, error = actor.edge.heading - heading(b.quaternion);
        const turn = Math.atan2(Math.sin(error), Math.cos(error));
        const yaw = heading(b.quaternion) + Math.max(-STEP * .8, Math.min(STEP * .8, turn));
        const targetSpeed = Math.max(0, 11 * (1 - actor.control.brake));
        const speed = Math.hypot(b.velocity.x, b.velocity.z);
        const nextSpeed = speed + Math.max(-5.5 * STEP, Math.min(2.5 * STEP, targetSpeed - speed));
        b.previousPosition.copy(b.position); b.previousQuaternion.copy(b.quaternion);
        b.velocity.set(Math.sin(yaw) * nextSpeed, 0, Math.cos(yaw) * nextSpeed);
        b.position.x += b.velocity.x * STEP; b.position.z += b.velocity.z * STEP;
        b.quaternion.setFromEuler(0, yaw, 0);
      }
    }
    this.world.step(STEP); this.steps++; this.contacts += this.world.contacts.length;
    for (const actor of [...this.players.values(), ...this.npcs]) if (actor.role === 'player' || actor.physical) actor.sim.postStep(STEP);
    this.tick++;
    this.metrics.stepMs.push(performance.now() - start);
    if (this.tick % 120 === 0) this.metrics.physicalCounts.push(this.npcs.filter(a => a.physical).length);
  }
  snapshot() {
    const actor = a => {
      const s = a.sim, b = s.body;
      return { id: a.id, generation: a.generation, role: a.role, physical: a.physical ?? true,
        p: vector(b.position), q: quaternion(b.quaternion), v: vector(b.velocity), av: vector(b.angularVelocity),
        steering: s.steering, damage: s.damage, lastProcessedInputSeq: a.lastSeq ?? -1,
        lastAppliedTick: a.lastAppliedTick ?? 0, connected: a.connected ?? true,
        wheels: s.wheels.map(w => ({ p: vector(w.detachedBody?.position ?? w.position),
          rotation: w.rotation, slip: w.slip, grounded: w.grounded, detached: w.detached })) };
    };
    return { protocolVersion: 1, buildId: 'spike-1', roundId: 'round-1', tick: this.tick,
      serverTime: this.tick * STEP, stepSeconds: STEP, seed: this.plan.seed, roadWidth: this.plan.roadWidth,
      generatorVersion: 'baseline-dc9eb06-working-tree', mapSignature: this.signature,
      players: [...this.players.values()].map(actor), actors: this.npcs.map(actor),
      signalTime: this.tick * STEP,
      coverage: 'spike: damage and wheels only; no wanted/arrest/pickups/props/police gameplay' };
  }
  dispose() {
    for (const a of [...this.players.values(), ...this.npcs]) this.removeSim(a.sim);
    this.players.clear(); this.npcs.length = 0;
    for (const b of [...this.world.bodies]) this.world.removeBody(b);
    this.metrics.stepMs.length = this.metrics.aiMs.length = this.metrics.physicalCounts.length = 0;
  }
}
