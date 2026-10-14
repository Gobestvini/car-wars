import { Schema, defineTypes, ArraySchema, MapSchema } from '@colyseus/schema';
export class ActorState extends Schema {
  constructor() { super(); this.id = ''; this.role = ''; this.generation = 1; this.physical = true;
    this.pose = new ArraySchema(); this.wheels = new ArraySchema(); this.steering = 0; this.damage = 0;
    this.ack = -1; this.appliedTick = 0; this.connected = true; }
}
defineTypes(ActorState, { id: 'string', role: 'string', generation: 'uint32', physical: 'boolean',
  pose: ['float32'], wheels: ['float32'], steering: 'float32', damage: 'float32', ack: 'int32',
  appliedTick: 'uint32', connected: 'boolean' });
export class WorldState extends Schema {
  constructor() { super(); this.tick = 0; this.seed = 0; this.signature = ''; this.contactCount = 0; this.actors = new MapSchema(); }
}
defineTypes(WorldState, { tick: 'uint32', seed: 'uint32', signature: 'string', contactCount:'uint32', actors: { map: ActorState } });
const quantize = n => Math.round(n * 1000) / 1000;
export function syncState(state, snapshot) {
  state.tick = snapshot.tick; state.seed = snapshot.seed; state.signature = snapshot.mapSignature;
  const ids = new Set();
  for (const a of [...snapshot.players, ...snapshot.actors]) {
    ids.add(a.id);
    let s = state.actors.get(a.id);
    if (!s) { s = new ActorState(); state.actors.set(a.id, s); }
    s.id = a.id; s.role = a.role; s.generation = a.generation; s.physical = a.physical;
    const pose = [...a.p, ...a.q, ...a.v, ...a.av];
    for (let i = 0; i < pose.length; i++) s.pose[i] = quantize(pose[i]);
    const wheels = a.wheels.flatMap(w => [...w.p, w.rotation, w.slip, Number(w.grounded), Number(w.detached)]);
    for (let i = 0; i < wheels.length; i++) s.wheels[i] = quantize(wheels[i]);
    s.steering = quantize(a.steering); s.damage = quantize(a.damage); s.ack = a.lastProcessedInputSeq;
    s.appliedTick = a.lastAppliedTick; s.connected = a.connected;
  }
  for (const id of state.actors.keys()) if (!ids.has(id)) state.actors.delete(id);
}
