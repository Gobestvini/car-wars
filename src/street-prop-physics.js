import * as C from 'cannon-es';
import { PROP_PHYSICS, PROP_LIFETIME, PROP_FADE_SECONDS, PROP_DEBRIS_LIMIT, PROP_CRIME_KMH } from './street-prop-config.js';

const vec = values => new C.Vec3(...values);
const unitAxes = [vec([1,0,0]),vec([0,1,0]),vec([0,0,1])];
function boxesOf(body) {
  return body.shapes.flatMap((shape, i) => {
    if (!(shape instanceof C.Box)) return [];
    const rotation = body.quaternion.mult(body.shapeOrientations[i]);
    return [{ center: body.position.vadd(body.quaternion.vmult(body.shapeOffsets[i])),
      half: [shape.halfExtents.x,shape.halfExtents.y,shape.halfExtents.z],
      axes: unitAxes.map(axis => rotation.vmult(axis)) }];
  });
}
const radiusOn = (box, axis) => box.axes.reduce((sum, basis, i) => sum + box.half[i] * Math.abs(basis.dot(axis)), 0);

/** Continuous separating-axis test for two oriented boxes, including roll/pitch.
 * Only the actor translates during this prediction; the prop is still anchored.
 * Entry normal points from actor into prop, independent of Cannon bi/bj ordering.
 */
export function sweepPropBox(actor, prop, velocity, dt, margin = 0) {
  const axes = [...actor.axes,...prop.axes];
  for (const a of actor.axes) for (const b of prop.axes) {
    const cross = a.cross(b);
    if (cross.lengthSquared() > 1e-10) { cross.normalize(); axes.push(cross); }
  }
  const delta = prop.center.vsub(actor.center);
  let entry = -Infinity, exit = Infinity, normal = null, penetration = Infinity, overlapNormal = null;
  for (const axis of axes) {
    const distance = delta.dot(axis), range = radiusOn(actor,axis) + radiusOn(prop,axis) + margin;
    const speed = velocity.dot(axis);
    const depth = range - Math.abs(distance);
    if (depth < penetration) { penetration = depth; overlapNormal = axis.scale(distance < 0 ? -1 : 1); }
    if (Math.abs(speed) < 1e-10) { if (Math.abs(distance) > range) return null; continue; }
    const a = (distance-range)/speed, b = (distance+range)/speed;
    const near = Math.min(a,b), far = Math.max(a,b);
    if (near > entry) { entry = near; normal = axis.scale(speed < 0 ? -1 : 1); }
    exit = Math.min(exit,far);
    if (entry > exit) return null;
  }
  if (exit < -1e-9 || entry > dt + 1e-9) return null;
  return { time: Math.max(0,entry), normal: entry <= 0 ? overlapNormal : normal };
}

export class StreetPropPhysics {
  constructor(world) {
    this.world = world;
    this.entries = [];
    this.byBody = new Map();
    this.cells = new Map();
    this.activeIntact = new Set();
    this.debris = [];
    this.events = [];
    this.clock = 0;
    this.playerPushedUntil = -Infinity;
    this.disposed = false;
    this.material = new C.Material({ friction: .45, restitution: .1 });
    const materials = new Set(world.bodies.map(body => body.material).filter(Boolean));
    materials.add(this.material);
    this.contactMaterials = [...materials].map(material => {
      const contact = new C.ContactMaterial(material,this.material,{friction:.45,restitution:.1});
      world.addContactMaterial(contact); return contact;
    });
  }
  makeBody(entry, dynamic = false) {
    const spec = PROP_PHYSICS[entry.type];
    const body = new C.Body({ mass: dynamic ? spec.mass : 0, material: this.material,
      linearDamping: .15, angularDamping: .25, allowSleep: true });
    body.collisionFilterGroup = 4; // props are obstacles, never wheel-ray supports
    body.position.set(entry.x,entry.y + spec.height/2,entry.z);
    body.quaternion.setFromEuler(0,entry.yaw,0);
    for (const box of spec.boxes) body.addShape(new C.Box(vec(box.half)),
      vec([box.center[0],box.center[1]-spec.height/2,box.center[2]]));
    this.world.addBody(body);
    this.byBody.set(body,entry);
    return body;
  }
  register(source) {
    const entry = { ...source, state: 'intact', lastTouch: -Infinity, episode: false, destroyedAt: null };
    entry.body = this.makeBody(entry);
    entry.active = true;
    this.activeIntact.add(entry);
    entry.boxes = boxesOf(entry.body);
    this.entries.push(entry);
    const key = `${Math.floor(entry.x/12)}:${Math.floor(entry.z/12)}`;
    if (!this.cells.has(key)) this.cells.set(key,[]);
    this.cells.get(key).push(entry);
    return entry;
  }
  candidates(body, dt) {
    const reach = body.boundingRadius + 1.2;
    const endX = body.position.x + body.velocity.x*dt, endZ = body.position.z + body.velocity.z*dt;
    const entries = [];
    for (let x = Math.floor((Math.min(body.position.x,endX)-reach)/12); x <= Math.floor((Math.max(body.position.x,endX)+reach)/12); x++)
      for (let z = Math.floor((Math.min(body.position.z,endZ)-reach)/12); z <= Math.floor((Math.max(body.position.z,endZ)+reach)/12); z++)
        for (const entry of this.cells.get(`${x}:${z}`) || []) if (entry.state === 'intact') entries.push(entry);
    return entries;
  }
  offense(entry, speed, actor) {
    if (!actor.player || !this.enabled) return;
    entry.lastTouch = this.clock;
    if (entry.episode) return;
    entry.episode = true;
    if (speed + 1e-6 < PROP_CRIME_KMH || this.clock < this.playerPushedUntil) return;
    this.events.push({ type: 'property-collision', propId: entry.id, propType: entry.type,
      impactSpeedKmh: speed, time: this.clock });
  }
  detach(entry, actor, normal, speed) {
    if (entry.state !== 'intact') return;
    while (this.debris.length >= PROP_DEBRIS_LIMIT) this.remove(this.debris[0]);
    this.byBody.delete(entry.body); this.world.removeBody(entry.body);
    this.activeIntact.delete(entry);
    entry.body = this.makeBody(entry,true);
    entry.active = true;
    entry.state = 'detached'; entry.destroyedAt = this.clock;
    // Apply at bumper height, below the centre of tall poles, to topple them.
    const mass = PROP_PHYSICS[entry.type].mass;
    const impulse = Math.min(speed/3.6 * mass * .65, mass * 16);
    const point = new C.Vec3(-normal.x*.08, Math.min(actor.body.position.y-entry.body.position.y,0), -normal.z*.08);
    entry.body.applyImpulse(new C.Vec3(normal.x*impulse,0,normal.z*impulse),point);
    entry.onDetach?.();
    this.debris.push(entry);
  }
  beforeStep(dt, actors, enabled = true) {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.enabled = enabled;
    this.actors = new Map(actors.map(actor => [actor.body,actor]));
    this.velocities = new Map(actors.map(actor => [actor.body,actor.body.velocity.clone()]));
    // Anchored bodies are needed only along physical actors' swept footprints.
    // Their stable shapes/poses remain allocated, and are reinserted BEFORE the
    // world step. Detached debris never participates in this activation cull.
    const nearby = new Map(actors.map(actor => [actor,this.candidates(actor.body,dt)]));
    const needed = new Set([...nearby.values()].flat());
    for (const entry of this.activeIntact) if (!needed.has(entry)) {
      this.world.removeBody(entry.body); this.byBody.delete(entry.body);
      entry.active = false; this.activeIntact.delete(entry);
    }
    for (const entry of needed) if (!entry.active) {
      entry.body.aabbNeedsUpdate = true; this.world.addBody(entry.body); this.byBody.set(entry.body,entry);
      entry.active = true; this.activeIntact.add(entry);
    }
    const player = actors.find(actor => actor.player)?.body;
    const playerBoxes = player ? boxesOf(player) : [];
    for (const entry of this.entries) if (entry.episode && this.clock-entry.lastTouch >= .5) {
      const nearby = playerBoxes.some(box => entry.boxes.some(prop => sweepPropBox(box,prop,new C.Vec3(),0,.5)));
      if (!nearby) entry.episode = false;
    }
    for (const actor of actors) {
      if (actor.player && !enabled) continue;
      const body = actor.body;
      if (Math.hypot(body.velocity.x,body.velocity.z) < 1e-6) continue;
      const boxes = boxesOf(body);
      for (const entry of nearby.get(actor)) {
        if (entry.state !== 'intact') continue;
        let hit = null;
        for (const box of boxes) for (const prop of entry.boxes) {
          const candidate = sweepPropBox(box,prop,body.velocity,dt);
          if (candidate && (!hit || candidate.time < hit.time)) hit = candidate;
        }
        if (!hit) continue;
        const length = Math.hypot(hit.normal.x,hit.normal.z);
        if (length < 1e-6) continue;
        const normal = new C.Vec3(hit.normal.x/length,0,hit.normal.z/length);
        const speed = Math.max(0,body.velocity.dot(normal))*3.6;
        this.offense(entry,speed,actor);
        if (speed + 1e-6 >= PROP_PHYSICS[entry.type].threshold) this.detach(entry,actor,normal,speed);
      }
    }
  }
  afterStep(dt, contacts = this.world.contacts) {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return [];
    // Preserve causality across steps when an NPC shoves a stationary player
    // into a prop on the following tick. Continued NPC contact extends the episode.
    for (const contact of contacts || []) {
      const a = this.actors?.get(contact.bi), b = this.actors?.get(contact.bj);
      if (!a || !b || a.player === b.player) continue;
      const player = a.player ? a : b, npc = a.player ? b : a;
      const pv = this.velocities.get(player.body), nv = this.velocities.get(npc.body);
      const toward = player.body.position.vsub(npc.body.position);
      toward.y = 0;
      if (toward.lengthSquared() < 1e-10) continue;
      toward.normalize();
      if (nv.dot(toward) > pv.dot(toward) + .1
        && (Math.hypot(pv.x,pv.z)*3.6 < PROP_CRIME_KMH || this.clock < this.playerPushedUntil))
        this.playerPushedUntil = this.clock + .5;
    }
    // Catch resting/angular contacts that were not covered by translation sweep.
    for (const contact of contacts || []) {
      const entry = this.byBody.get(contact.bi) || this.byBody.get(contact.bj);
      if (!entry || entry.state !== 'intact') continue;
      const other = contact.bi === entry.body ? contact.bj : contact.bi;
      const actor = this.actors?.get(other);
      if (!actor || (actor.player && !this.enabled)) continue;
      const n = contact.ni.clone();
      const toward = entry.body.position.vsub(other.position);
      if (n.dot(toward) < 0) n.negate(n);
      const length = Math.hypot(n.x,n.z);
      if (length < 1e-6) continue;
      const normal = new C.Vec3(n.x/length,0,n.z/length);
      if (actor.player) entry.lastTouch = this.clock;
      const speed = Math.max(0,(this.velocities?.get(other) || new C.Vec3()).dot(normal))*3.6;
      this.offense(entry,speed,actor);
      if (speed+1e-6 >= PROP_PHYSICS[entry.type].threshold) this.detach(entry,actor,normal,speed);
    }
    this.clock += dt;
    for (const entry of [...this.debris]) {
      if (this.clock-entry.destroyedAt >= PROP_LIFETIME-1e-9) this.remove(entry);
    }
    return this.events.splice(0);
  }
  syncVisuals() {
    for (const entry of this.debris) {
      const scale = Math.min(1,Math.max(0,(PROP_LIFETIME-(this.clock-entry.destroyedAt))/PROP_FADE_SECONDS));
      entry.sync?.(entry.body,scale);
    }
  }
  remove(entry) {
    if (entry.state === 'removed') return;
    this.world.removeBody(entry.body); this.byBody.delete(entry.body);
    this.activeIntact.delete(entry); entry.active = false;
    entry.state = 'removed'; entry.hide?.();
    this.debris = this.debris.filter(item => item !== entry);
  }
  reset() {
    if (this.disposed) return;
    for (const entry of this.entries) {
      if (entry.state !== 'intact') {
        this.world.removeBody(entry.body); this.byBody.delete(entry.body);
        entry.body = this.makeBody(entry);
        entry.active = true; this.activeIntact.add(entry);
        entry.boxes = boxesOf(entry.body);
      }
      entry.state = 'intact'; entry.episode = false; entry.lastTouch = -Infinity; entry.destroyedAt = null;
      entry.restore?.();
    }
    this.debris = []; this.events = []; this.clock = 0;
    this.playerPushedUntil = -Infinity;
    this.actors?.clear(); this.velocities?.clear();
  }
  snapshot() {
    return { detached: this.debris.length, activeIntact: this.activeIntact.size, total: this.entries.length, time: this.clock,
      objects: this.entries.map(entry => ({ id: entry.id,type: entry.type,state: entry.state,
        x: entry.x,y: entry.y,z: entry.z,yaw: entry.yaw,bodyId: entry.body.id,active: entry.active,
        position: { ...entry.body.position }, remaining: entry.state === 'detached' ? PROP_LIFETIME-this.clock+entry.destroyedAt : null })) };
  }
  dispose() {
    if (this.disposed) return;
    for (const entry of this.entries) { this.world.removeBody(entry.body); entry.hide?.(); }
    this.entries = []; this.byBody.clear(); this.cells.clear(); this.debris = []; this.events = [];
    this.activeIntact.clear();
    this.actors?.clear(); this.velocities?.clear(); this.disposed = true;
    for (const contact of this.contactMaterials) this.world.removeContactMaterial(contact);
    this.contactMaterials = [];
  }
}
