import * as C from 'cannon-es';
import { CarSimulation, STEP } from '../vehicle.js';
import { useSparseContacts } from './contact-cache.js';
import { StreetPropPhysics } from '../street-prop-physics.js';
import { captureStreet, restoreStreet } from './street-world.js';

const vec = v => [v.x,v.y,v.z];
const quat = q => [q.x,q.y,q.z,q.w];
export const idleControl = () => ({steer:0,throttle:0,brake:1,handbrake:false});

// All persistent force-model inputs. Suspension/raycast/contact results are
// recomputed by prepare; damage and detachment decisions remain authoritative.
export function captureCar(sim) {
  const b=sim.body;
  return {p:vec(b.position),q:quat(b.quaternion),v:vec(b.velocity),av:vec(b.angularVelocity),
    steering:sim.steering,throttle:sim.throttle,damage:sim.damage,
    wheels:sim.wheels.map(w=>({p:vec(w.detachedBody?.position ?? w.position),rotation:w.rotation,
      slip:w.slip,grounded:w.grounded,detached:w.detached,
      body:w.detachedBody?{q:quat(w.detachedBody.quaternion),v:vec(w.detachedBody.velocity),av:vec(w.detachedBody.angularVelocity)}:null}))};
}

function restoreBody(b,s) {
  b.position.set(...s.p);b.quaternion.set(...s.q);b.velocity.set(...s.v);b.angularVelocity.set(...s.av);
  b.previousPosition.copy(b.position);b.interpolatedPosition.copy(b.position);
  b.previousQuaternion.copy(b.quaternion);b.interpolatedQuaternion.copy(b.quaternion);
  b.force.setZero();b.torque.setZero();b.vlambda.setZero();b.wlambda.setZero();
  b.aabbNeedsUpdate=true;b.wakeUp();
}

export function restoreCar(sim,state) {
  restoreBody(sim.body,state);
  sim.steering=sim.previousSteering=state.steering;sim.throttle=state.throttle;sim.damage=state.damage;
  state.wheels.forEach((source,i)=>{
    const w=sim.wheels[i];
    if(source.detached && !w.detachedBody){
      const b=new C.Body({mass:18,linearDamping:.02,angularDamping:.06,allowSleep:false});
      const axle=new C.Quaternion();axle.setFromEuler(0,0,Math.PI/2);
      b.addShape(new C.Cylinder(w.radius,w.radius,.3,16),new C.Vec3(),axle);
      b.collisionFilterGroup=8;b.collisionFilterMask=1;sim.world.addBody(b);w.detachedBody=b;
    }else if(!source.detached && w.detachedBody){sim.world.removeBody(w.detachedBody);w.detachedBody=null;}
    w.detached=source.detached;w.rotation=w.previousRotation=source.rotation;
    w.position.set(...source.p);w.previousPosition.copy(w.position);w.slip=source.slip;w.grounded=source.grounded;
    if(w.detachedBody)restoreBody(w.detachedBody,{p:source.p,...source.body});
  });
}

export function stateFromActor(actor) {
  return {p:actor.pose.slice(0,3),q:actor.pose.slice(3,7),v:actor.pose.slice(7,10),av:actor.pose.slice(10,13),
    steering:actor.steering,throttle:actor.throttle,damage:actor.damage,
    wheels:Array.from({length:4},(_,i)=>({p:actor.wheels.length?actor.wheels.slice(i*7,i*7+3):actor.pose.slice(0,3),rotation:actor.wheels[i*7+3]??0,
      slip:actor.wheels[i*7+4]??0,grounded:Boolean(actor.wheels[i*7+5]),detached:Boolean(actor.wheels[i*7+6]),
      body:actor.detached?.[i] ?? null}))};
}

export class PredictionWorld {
  constructor(colliders,localId=null) {
    this.owner=new CarSimulation({damage:false});this.world=this.owner.world;
    useSparseContacts(this.world);
    this.owner.disposeDamageListener();this.world.removeBody(this.owner.body);
    this.statics=[];
    for(const box of colliders.boxes)this.statics.push(this.owner.addStaticBox(box));
    for(const prism of colliders.prisms)this.statics.push(this.owner.addStaticConvex(prism));
    this.staticPool=this.statics.map(body=>{
      body.updateAABB();const lo=body.aabb.lowerBound,hi=body.aabb.upperBound;
      this.world.removeBody(body);return{body,minX:lo.x,maxX:hi.x,minZ:lo.z,maxZ:hi.z,active:false};
    });
    this.actors=new Map();this.tick=0;this.steps=0;this.localId=localId;
    this.props=new StreetPropPhysics(this.world,{materials:[this.owner.materials.chassis]});
    for(const p of colliders.props??[])this.props.register(p);
  }
  remove(id) {
    const actor=this.actors.get(id);if(!actor)return;
    actor.sim.disposeDamageListener();this.world.removeBody(actor.sim.body);
    for(const w of actor.sim.wheels)if(w.detachedBody)this.world.removeBody(w.detachedBody);
    this.actors.delete(id);
  }
  selected(frame) {
    // Predict the nearby interaction island, including chains across its edge.
    // Other players are always present; distant NPC remain on snapshots.
    const local=frame.actors.get(this.localId),physical=[...frame.actors.values()].filter(a=>a.physical||a.role==='player');
    const selected=new Set(physical.filter(a=>!local || Math.hypot(a.pose[0]-local.pose[0],a.pose[2]-local.pose[2])<42).map(a=>a.id));
    let changed=true;
    while(changed){changed=false;for(const a of physical){if(selected.has(a.id))continue;
      if(physical.some(b=>selected.has(b.id)&&Math.hypot(a.pose[0]-b.pose[0],a.pose[2]-b.pose[2])<7)){
        selected.add(a.id);changed=true;
      }
    }}
    return new Map([...frame.actors].filter(([id,a])=>a.role==='player'||(a.physical&&selected.has(id))));
  }
  checkpoint() {
    const checkpoint=new Map([...this.actors].map(([id,{sim,source}])=>[id,{generation:source.generation,
      pose:[...vec(sim.body.position),...quat(sim.body.quaternion),...vec(sim.body.velocity),...vec(sim.body.angularVelocity)],
      steering:sim.steering,throttle:sim.throttle,damage:sim.damage,detached:sim.wheels.map(w=>w.detached),
      wheelBodies:sim.wheels.map(w=>w.detachedBody?{p:vec(w.detachedBody.position),v:vec(w.detachedBody.velocity)}:null)}]));
    checkpoint.props=captureStreet(this.props);return checkpoint;
  }
  syncStatics() {
    const zones=[...this.actors.values()].map(({sim})=>({x:sim.body.position.x,z:sim.body.position.z,
      // A one-second travel envelope exceeds the half-second replay cap, plus
      // chassis/suspension/acceleration margin. Recheck every 100ms and rewind.
      radius:8+Math.hypot(sim.body.velocity.x,sim.body.velocity.z)}));
    for(const entry of this.staticPool){
      const active=zones.some(z=>entry.maxX>=z.x-z.radius&&entry.minX<=z.x+z.radius&&entry.maxZ>=z.z-z.radius&&entry.minZ<=z.z+z.radius);
      if(active===entry.active)continue;
      if(active)this.world.addBody(entry.body);else this.world.removeBody(entry.body);
      entry.active=active;
    }
  }
  restore(frame) {
    const selected=this.selected(frame),active=new Set();
    for(const actor of selected.values()){
      active.add(actor.id);let entry=this.actors.get(actor.id);
      if(!entry){
        const sim=new CarSimulation({world:this.world,materials:this.owner.materials,damage:false,allowWheelDetachment:false});
        entry={sim};this.actors.set(actor.id,entry);
      }
      entry.source=actor;entry.control=actor.control ?? idleControl();
      restoreCar(entry.sim,stateFromActor(actor));
      if(actor.role!=='player')entry.sim.syncWheelPositions();
    }
    for(const id of this.actors.keys())if(!active.has(id))this.remove(id);
    restoreStreet(this.props,frame.props??[],frame.tick*STEP);
    this.syncStatics();
    // Clear future contacts and spatial caches after rewind. Damage listeners are
    // absent here, so replay cannot repeat authoritative effects or damage.
    this.world.contacts.length=0;this.world.frictionEquations.length=0;
    this.world.collisionMatrix.reset();this.world.collisionMatrixPrevious.reset();
    this.world.bodyOverlapKeeper.current.length=0;this.world.bodyOverlapKeeper.previous.length=0;
    this.world.shapeOverlapKeeper.current.length=0;this.world.shapeOverlapKeeper.previous.length=0;
    this.world.broadphase.dirty=true;this.tick=frame.tick;this.world.time=frame.tick*STEP;
    this.world.stepnumber=frame.tick;
  }
  step(localId,input) {
    if(this.tick%12===0)this.syncStatics();
    for(const [id,a]of this.actors)a.sim.prepare(id===localId?input:a.control,STEP);
    this.props.beforeStep(STEP,[...this.actors.values()].map(a=>({body:a.sim.body,player:a.source.role==='player'})));
    this.world.step(STEP);
    this.props.afterStep(STEP);
    for(const a of this.actors.values())a.sim.postStep(STEP);
    this.tick++;this.steps++;
  }
  sample() {
    return [...this.actors].map(([id,{sim,source}])=>{
      const s=captureCar(sim);
      return {...source,id,pose:[...s.p,...s.q,...s.v,...s.av],steering:s.steering,damage:s.damage,
        wheels:s.wheels.flatMap(w=>[...w.p,w.rotation,w.slip,Number(w.grounded),Number(w.detached)])};
    });
  }
  dispose(){this.props.dispose();for(const id of this.actors.keys())this.remove(id);for(const b of [...this.world.bodies])this.world.removeBody(b);}
}
