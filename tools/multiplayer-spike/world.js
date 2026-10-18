// Research harness, not the production traffic runtime. No THREE or DOM imports.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CarSimulation, STEP } from '../../src/vehicle.js';
import { useSparseContacts } from '../../src/multiplayer/contact-cache.js';
import { createCityPlan } from '../../src/city-generator.js';
import { cityColliders, mapContract, mapBytes } from '../../src/multiplayer/map-contract.js';
import { createRoadGraph, createSeededRandom, chooseRoadGoal, findRoadRoute } from '../../src/traffic-ai.js';
import { driveControl, followingLimit, edgeProgress } from '../../src/traffic-planner.js';
import { createTrafficSpawnSlots, isTrafficSpawnSafe } from '../../src/traffic-spawn.js';
import { createTrafficSignals } from '../../src/traffic-signals.js';
import { drivingPath, pointOnPath, pathProgress, pathTarget, BuildingIndex } from './road-motion.js';

export { STEP };
export const heading = q => Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
const vector = v => [v.x, v.y, v.z];
const quaternion = q => [q.x, q.y, q.z, q.w];
const neutral = () => ({ steer: 0, throttle: 0, brake: 1 });

export function colliderDescriptors(plan) {
  return cityColliders(plan);
}

export class SpikeWorld {
  constructor({ seed = 20261005, npcCount = 102, playerCount = 0, allPhysical = false } = {}) {
    this.plan = createCityPlan(seed);
    this.owner = new CarSimulation({ damage: false });
    this.world = this.owner.world;
    useSparseContacts(this.world);
    this.world.removeBody(this.owner.body);
    this.owner.disposeDamageListener();
    const colliders = colliderDescriptors(this.plan);
    for (const box of colliders.boxes) this.owner.addStaticBox(box);
    for (const prism of colliders.prisms) this.owner.addStaticConvex(prism);
    this.map = mapContract(this.plan,colliders);
    this.signature = createHash('sha256').update(mapBytes(this.map)).digest('hex');
    this.colliders = colliders;
    this.graph = createRoadGraph(this.plan.roadNetwork, Math.min(5.2, this.plan.roadWidth * .25));
    this.slots = createTrafficSpawnSlots(this.graph.directed);
    this.signals = createTrafficSignals(this.plan.roadNetwork);
    this.buildingIndex=new BuildingIndex(this.plan);this.pathCache=new Map();this.junctionOwners=new Map();
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
    const obstacles = [...this.plan.buildings, ...this.plan.boundaryBuildings]
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
      lastAppliedTick: 0, connected: true, commands:new Map(), timed:false };
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
  setPath(actor) {
    if(!actor.route.length)this.planRoute(actor);
    const outgoing=this.graph.adjacency.get(actor.edge.to)?.find(edge=>edge.to===actor.route[0]);
    if(!outgoing)return;
    const key=`${actor.edge.from}>${actor.edge.to}>${outgoing.to}`;
    if(!this.pathCache.has(key))this.pathCache.set(key,drivingPath(actor.edge,outgoing,this.graph.nodes.get(actor.edge.to),this.plan.roadWidth));
    actor.path=this.pathCache.get(key);actor.outgoing=outgoing;
    actor.logicalProgress=pathProgress(actor.sim.body.position,actor.path);
  }
  input(id, input) {
    const actor = this.players.get(id);
    if (!actor || actor.timed || input.seq <= actor.receivedSeq) return false;
    actor.receivedSeq = input.seq; actor.pending = input; return true;
  }
  disconnect(id) {
    const actor = this.players.get(id);
    if (actor) { actor.connected = false; this.halt(id); }
  }
  timedInput(id,packet) {
    const actor=this.players.get(id);
    if(!actor || !actor.connected || packet.generation!==actor.generation)return false;
    actor.timed=true;actor.pending=null;
    for(const [tick,steer,throttle,brake,handbrake]of packet.commands){
      if(tick<=this.tick || tick>this.tick+120)continue;
      if(!actor.commands.has(tick))actor.commands.set(tick,{steer,throttle,brake,handbrake:Boolean(handbrake)});
    }
    return true;
  }
  halt(id) {
    const actor=this.players.get(id);if(!actor)return;
    actor.commands.clear();actor.pending=null;actor.control=neutral();actor.lastInputTick=this.tick;
  }
  think() {
    const occupants = this.occupants();
    for(const [node,id]of this.junctionOwners){
      const owner=this.npcs.find(a=>a.id===id);
      if(!owner || owner.edge.to!==node)this.junctionOwners.delete(node);
    }
    for (const actor of this.npcs) {
      const b = actor.sim.body;
      if(!actor.path)this.setPath(actor);
      if(actor.path && pathProgress(b.position,actor.path)>=actor.path.length-.5){
        if(this.junctionOwners.get(actor.edge.to)===actor.id)this.junctionOwners.delete(actor.edge.to);
        actor.edge=actor.outgoing;actor.route.shift();actor.path=null;this.setPath(actor);
      }
      let progress = edgeProgress(b.position, actor.edge);
      const look = Math.max(0, Math.min(1, (progress + 8) / actor.edge.length));
      const target = actor.path ? pathTarget(b.position,actor.path,Math.max(2.5,Math.hypot(b.velocity.x,b.velocity.z)*.4)) : { x: actor.edge.start.x + (actor.edge.end.x - actor.edge.start.x) * look,
        z: actor.edge.start.z + (actor.edge.end.z - actor.edge.start.z) * look };
      const current = this.occupancy(actor), fx = Math.sin(current.heading), fz = Math.cos(current.heading);
      const approaching=progress>actor.edge.length-this.plan.roadWidth/2-10;
      let speed = approaching ? 4.5 : 9;
      for (const other of occupants) if (other.id !== actor.id) speed = Math.min(speed, followingLimit(current, other, fx, fz));
      const phase = this.signals.phase(actor.edge.to, actor.edge.from, this.tick * STEP);
      const owner=this.junctionOwners.get(actor.edge.to),stopAt=actor.edge.length-this.plan.roadWidth/2-3;
      if(approaching && !owner && phase.canEnter)this.junctionOwners.set(actor.edge.to,actor.id);
      if(this.junctionOwners.get(actor.edge.to)!==actor.id && approaching)
        speed=Math.min(speed,Math.sqrt(2*5.5*Math.max(0,stopAt-progress)));
      actor.targetSpeed=speed;
      actor.control = driveControl(target.x - b.position.x, target.z - b.position.z, current.heading,
        Math.hypot(b.velocity.x, b.velocity.z), speed);
      const distance = Math.min(...[...this.players.values()].map(p => p.sim.body.position.distanceTo(b.position)));
      const touching = this.world.contacts.some(c => (c.bi === b && c.bj.mass > 0) || (c.bj === b && c.bi.mass > 0));
      const roadPose=actor.path?pointOnPath(actor.path,pathProgress(b.position,actor.path)):null;
      const aligned=roadPose && Math.hypot(b.position.x-roadPose.x,b.position.z-roadPose.z)<.25 &&
        Math.abs(b.quaternion.x)<.1 && Math.abs(b.quaternion.z)<.1 && b.position.y<1.8;
      const physical = this.allPhysical || distance < (actor.physical ? 42 : 32) || touching || (actor.physical && !aligned);
      if (physical !== actor.physical) {
        if (physical) { b.previousPosition.copy(b.position); b.previousQuaternion.copy(b.quaternion);
          b.aabbNeedsUpdate = true; b.wakeUp(); this.world.addBody(b); }
        else this.world.removeBody(b);
        actor.physical = physical; this.metrics.transitions++;
        actor.logicalProgress=actor.path?pathProgress(b.position,actor.path):0;
      }
    }
  }
  step() {
    const start = performance.now();
    for (const actor of this.players.values()) {
      if(actor.timed){
        const command=actor.commands.get(this.tick+1);
        if(command && actor.connected){actor.control=command;actor.lastAppliedTick=this.tick+1;actor.lastSeq=this.tick+1;actor.lastInputTick=this.tick;}
        for(const tick of actor.commands.keys())if(tick<=this.tick+1)actor.commands.delete(tick);
      }
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
        const b = actor.sim.body;
        const targetSpeed = actor.targetSpeed ?? 0;
        const speed = Math.hypot(b.velocity.x, b.velocity.z);
        const nextSpeed = speed + Math.max(-5.5 * STEP, Math.min(2.5 * STEP, targetSpeed - speed));
        const previous=actor.logicalProgress ?? (actor.path?pathProgress(b.position,actor.path):0);
        const next=actor.path?pointOnPath(actor.path,previous+nextSpeed*STEP):null;
        b.previousPosition.copy(b.position); b.previousQuaternion.copy(b.quaternion);
        if(next && !this.buildingIndex.overlaps(next)){
          actor.logicalProgress=previous+nextSpeed*STEP;
          b.velocity.set((next.x-b.position.x)/STEP,0,(next.z-b.position.z)/STEP);
          b.position.set(next.x,.96,next.z);b.quaternion.setFromEuler(0,next.heading,0);
          actor.sim.syncWheelPositions();
        }else b.velocity.setZero();
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
        steering: s.steering, throttle:s.throttle,control:{...a.control}, damage: s.damage, lastProcessedInputSeq: a.lastSeq ?? -1,
        lastAppliedTick: a.lastAppliedTick ?? 0, connected: a.connected ?? true,
        wheels: s.wheels.map(w => ({ p: vector(w.detachedBody?.position ?? w.position),
          rotation: w.rotation, slip: w.slip, grounded: w.grounded, detached: w.detached,
          body:w.detachedBody?{q:quaternion(w.detachedBody.quaternion),v:vector(w.detachedBody.velocity),av:vector(w.detachedBody.angularVelocity)}:null })) };
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
