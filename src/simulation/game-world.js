import { CarSimulation, STEP } from '../vehicle.js';
import { createVehicleRuntimeCore } from './vehicle-runtime.js';
import { VehicleAppearance } from './spawn-phase.js';
import { createCityPlan } from '../city-generator.js';
import { containsCityPoint } from '../city-layout.js';
import { createRoadGraph } from '../traffic-ai.js';
import { createTrafficSpawnSlots, isTrafficSpawnSafe } from '../traffic-spawn.js';
import { createTrafficSignals } from '../traffic-signals.js';
import { createTrafficViolationDetector } from '../traffic-violations.js';
import { createWantedSystem } from '../wanted-system.js';
import { createArrestSystem } from '../arrest-system.js';
import { createPolicePursuit, corridorBlocked } from '../police-pursuit.js';
import { RepairPickupManager } from '../repair-pickups.js';
import { createSurfaceHeightSampler } from '../road-surface.js';
import { StreetPropPhysics } from '../street-prop-physics.js';
import { useSparseContacts } from '../multiplayer/contact-cache.js';
import { cityColliders, mapContract, mapBytes } from '../multiplayer/map-contract.js';
import { captureStreet } from '../multiplayer/street-world.js';
import { createSignalApproaches } from './signal-approaches.js';

export { STEP };
export const heading = q => Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y));
const vec=v=>[v.x,v.y,v.z],quat=q=>[q.x,q.y,q.z,q.w];
const neutral=()=>({steer:0,throttle:0,brake:1});
const controlsValid=c=>c && ['steer','throttle','brake'].every(k=>Number.isFinite(c[k])) &&
  Math.abs(c.steer)<=1 && Math.abs(c.throttle)<=1 && c.brake>=0 && c.brake<=1;

/** A single authority for physics, AI and gameplay. Presentation is injected. */
export class GameWorld {
  constructor({plan=createCityPlan(20261005),seed,npcCount=102,deferRuntime=false,
    spawnPhases=true,autoPolice=true,damageObstacles=[],disabledRepairs=false}={}) {
    this.owner=new CarSimulation({damage:false});this.world=this.owner.world;
    useSparseContacts(this.world);this.world.removeBody(this.owner.body);this.owner.disposeDamageListener();
    this.players=new Map();this.tick=0;this.steps=0;this.contacts=0;this.slotCursor=0;this.round=1;
    this.spawnPhases=spawnPhases;this.autoPolice=autoPolice;this.npcCount=npcCount;this.disabledRepairs=disabledRepairs;
    this.metrics={stepMs:[],aiMs:[],physicalCounts:[]};this.events=[];this.eventSerial=0;this.gameplayRevision=0;
    this.setMap(seed===undefined?plan:createCityPlan(seed),damageObstacles);
    if(!deferRuntime){
      this.setRuntime(createVehicleRuntimeCore({count:npcCount,roadNetwork:this.plan.roadNetwork,
        roadWidth:this.plan.roadWidth,obstacles:this.obstacles,mapBounds:this.bounds,spawnPhases}),true);
      this.runtime.initializePopulation();
    }
  }
  setMap(plan,damageObstacles=[]) {
    this.props?.dispose();
    for(const body of [...this.owner.staticBodies])this.owner.removeStaticBox(body);
    this.plan=plan;this.colliders=cityColliders(plan,damageObstacles);this.map=mapContract(plan,this.colliders,damageObstacles);
    for(const box of this.colliders.boxes)this.owner.addStaticBox(box);
    for(const prism of this.colliders.prisms)this.owner.addStaticConvex(prism);
    this.props=new StreetPropPhysics(this.world,{materials:[this.owner.materials.chassis]});
    for(const p of this.colliders.props)this.props.register(p);
    this.propById=new Map(this.props.entries.map(e=>[e.id,e]));
    this.obstacles=[...plan.buildings,...plan.boundaryBuildings].map(b=>({x:b.x,z:b.z,halfX:b.width/2,halfZ:b.depth/2}));
    this.obstacles.push(...damageObstacles.map(([x,z,w,d,,heading=0])=>({x,z,halfX:w/2,halfZ:d/2,heading})));
    this.bounds={minX:-plan.bounds,maxX:plan.bounds,minZ:-plan.bounds,maxZ:plan.bounds,contains:(x,z)=>containsCityPoint(plan,x,z)};
    this.surfaceHeight=createSurfaceHeightSampler(plan);this.signals=createTrafficSignals(plan.roadNetwork);
    this.approaches=createSignalApproaches(plan);
    this.repairs=new RepairPickupManager(plan,damageObstacles.concat(plan.boundaryBuildings.map(b=>[b.x,b.z,b.width,b.depth])),{disabled:this.disabledRepairs});
    this.graph=createRoadGraph(plan.roadNetwork,Math.min(5.2,plan.roadWidth*.25));this.slots=createTrafficSpawnSlots(this.graph.directed);
    const map=this.map;
    this.signature='';this.ready=globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(mapBytes(map)))
      .then(bytes=>{const hash=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');if(this.map===map)this.signature=hash;return hash;});
    if(this.runtime){this.runtime.setRoadNetwork(plan.roadNetwork,plan.roadWidth,this.obstacles,this.bounds);
      this.runtime.setStreetProps(this.props);this.runtime.setSignalController(this.signals);}
    this.gameplayRevision++;
  }
  bindProp(source) {
    const entry=this.propById.get(source.id);if(!entry)throw Error('Visual prop absent from authoritative manifest: '+source.id);
    for(const k of ['type','x','y','z','yaw'])if(entry[k]!==source[k])throw Error('Visual prop differs from authoritative manifest: '+source.id+':'+k);
    for(const k of ['sync','hide','restore','onDetach'])if(source[k])entry[k]=source[k];
    return entry;
  }
  setRuntime(runtime,attach=false) {
    if(this.runtime && this.runtime!==runtime)this.runtime.dispose();this.runtime=runtime;
    runtime.setPlayers(this.players);runtime.useSimulationScheduling();
    runtime.setStreetProps(this.props);runtime.setSignalController(this.signals);
    if(attach)runtime.attachPhysics(this.owner);
    if(this.autoPolice)runtime.registerRole('police',{maxCount:6,physicalOnly:true,
      create:({targetId})=>createPolicePursuit({targetId}),onContact:(c,time)=>c.onContact(time),
      update:(c,context)=>{
        const p=this.players.get(context.target?.id);
        return c.update({...context,wantedLevel:p && p.connected && p.arrest.snapshot().state!=='arrested'?p.wanted.snapshot().level:0});
      },reset:c=>c.reset()});
  }
  occupancy(a){const sim=a.sim??a.simulation,b=sim.body;return{id:a.id,x:b.position.x,z:b.position.z,
    heading:heading(b.quaternion),vx:b.velocity.x,vz:b.velocity.z,body:b};}
  occupants(){return [...this.players.values(),...(this.runtime?.states??[])].map(a=>this.occupancy(a));}
  spawnSlot() {
    const occupants=this.occupants();
    for(let i=0;i<this.slots.length;i++){
      const p=this.slots[this.slotCursor++%this.slots.length];
      if(isTrafficSpawnSafe(p,occupants,this.obstacles))return p;
    }
    throw Error('No safe spawn slot');
  }
  addPlayer(id,{spawn,systems={},appearance=this.spawnPhases}={}) {
    if(this.disposed||typeof id!=='string'||!id||id.length>64||/^(npc|police)-\d+$/.test(id)||this.players.has(id)||this.players.size>=3)throw Error('Invalid player or room full');
    const p=spawn??this.spawnSlot();
    const sim=new CarSimulation({world:this.world,materials:this.owner.materials,
      spawn:{x:p.x,y:p.y??.96,z:p.z,yaw:p.yaw??p.heading??0}});sim.ground=this.owner.ground;
    const actor={id,role:'player',sim,control:neutral(),pending:null,commands:new Map(),generation:1,
      dents:[],dentGeneration:1,repairRevision:0,lastSeq:-1,receivedSeq:-1,lastAppliedTick:0,lastInputTick:this.tick,
      connected:true,timed:false,enabled:true,wanted:systems.wanted??createWantedSystem(),
      arrest:systems.arrest??createArrestSystem(),violations:systems.violations??createTrafficViolationDetector()};
    if(appearance){actor.appearance=new VehicleAppearance();sim.appearing=true;this.world.removeBody(sim.body);sim.disposeDamageListener();}
    this.players.set(id,actor);this.gameplayRevision++;return actor;
  }
  removePlayer(id){const a=this.players.get(id);if(!a)return false;this.halt(id);this.removeSim(a.sim);this.players.delete(id);
    this.runtime?.forgetTarget(id);for(const unit of this.runtime?.states??[])if(unit.ai.targetId===id)this.runtime.retarget(unit.id,null);
    this.props.forgetPlayer(id);this.gameplayRevision++;return true;}
  removeSim(sim){sim.disposeDamageListener();this.world.removeBody(sim.body);for(const w of sim.wheels)if(w.detachedBody){this.world.removeBody(w.detachedBody);w.detachedBody=null;w.detached=false;}
    sim.impactEvents.length=0;sim.impactCooldowns.clear();}
  setPlayerInput(id,input){const a=this.players.get(id);if(!a||!a.connected||!controlsValid(input)||a.arrest.snapshot().state==='arrested')return false;
    const seq=input.seq??a.receivedSeq+1;if(!Number.isSafeInteger(seq)||seq<=a.receivedSeq||a.timed)return false;
    a.receivedSeq=seq;a.pending={seq,steer:input.steer,throttle:input.throttle,brake:input.brake,handbrake:Boolean(input.handbrake)};return true;}
  input(id,input){return this.setPlayerInput(id,input);}
  timedInput(id,packet){const a=this.players.get(id);
    if(!a||!a.connected||a.generation!==packet?.generation||a.arrest.snapshot().state==='arrested'||!Array.isArray(packet.commands)||packet.commands.length>120)return false;
    if(packet.commands.some(c=>!Array.isArray(c)||c.length!==5||!Number.isSafeInteger(c[0])||!controlsValid({steer:c[1],throttle:c[2],brake:c[3]})))return false;
    a.timed=true;a.pending=null;let added=0;
    for(const [tick,steer,throttle,brake,handbrake]of packet.commands)if(tick>this.tick&&tick<=this.tick+120&&!a.commands.has(tick)){
      a.commands.set(tick,{steer,throttle,brake,handbrake:Boolean(handbrake)});added++;
    }
    if(added)a.packetTick=this.tick;
    return added>0;
  }
  rotateInputEpoch(id){const a=this.players.get(id);if(!a)return;this.halt(id);a.generation++;a.lastSeq=a.receivedSeq=-1;a.lastAppliedTick=0;
    a.dentGeneration=a.generation;this.gameplayRevision++;}
  halt(id){const a=this.players.get(id);if(!a)return;a.commands.clear();a.pending=null;a.control=neutral();a.lastInputTick=this.tick;}
  disconnect(id){const a=this.players.get(id);if(a){a.connected=false;this.halt(id);}}
  respawn(id){const a=this.players.get(id);if(!a)return false;const p=this.spawnSlot();
    a.sim.spawn={x:p.x,y:.96+this.surfaceHeight(p.x,p.z),z:p.z,yaw:p.heading};a.sim.reset();a.generation++;
    a.wanted.reset();a.arrest.reset();a.violations.reset();a.dents=[];a.dentGeneration=a.generation;
    this.halt(id);a.lastSeq=a.receivedSeq=-1;a.lastAppliedTick=0;this.props.forgetPlayer(id);this.gameplayRevision++;return true;}
  event(type,playerId,data={}){this.events.push({id:`${this.round}:${++this.eventSerial}`,tick:this.tick,playerId,type,...data});if(this.events.length>64)this.events.shift();this.gameplayRevision++;}
  updatePolice(){
    if(!this.autoPolice)return;
    const eligible=[...this.players.values()].filter(p=>p.connected&&!p.sim.appearing&&p.arrest.snapshot().state!=='arrested'&&p.wanted.snapshot().level>0);
    const desired=Math.min(6,[...this.players.values()].reduce((n,p)=>n+(p.wanted.snapshot().level>=3?2:1),0));
    const units=this.runtime.states.filter(a=>a.role==='police'),specs=[];
    while(units.length>desired){const unit=units.find(u=>!eligible.some(p=>p.id===u.ai.targetId))??units.at(-1);
      this.runtime.remove(unit.id);units.splice(units.indexOf(unit),1);}
    for(let i=units.length;i<desired;i++){let p;try{p=this.spawnSlot();}catch{break;}
      specs.push({position:{x:p.x,y:this.surfaceHeight(p.x,p.z),z:p.z},yaw:p.heading});}
    this.runtime.setRoleCount('police',desired,specs);
    const counts=new Map();
    for(const unit of this.runtime.states.filter(a=>a.role==='police')){
      const available=eligible.filter(p=>(counts.get(p.id)??0)<(p.wanted.snapshot().level>=3?2:1));
      available.sort((a,b)=>b.wanted.snapshot().level-a.wanted.snapshot().level ||
        unit.simulation.body.position.distanceSquared(a.sim.body.position)-unit.simulation.body.position.distanceSquared(b.sim.body.position) || (a.id<b.id?-1:1));
      const current=available.find(p=>p.id===unit.ai.targetId),best=available[0];
      const target=current&&current.wanted.snapshot().level===best?.wanted.snapshot().level?current:best;
      this.runtime.retarget(unit.id,target?.id??null);if(target)counts.set(target.id,(counts.get(target.id)??0)+1);
    }
  }
  step() {
    if(this.disposed)throw Error('World disposed');
    const start=performance.now(),before=new Map(),velocities=new Map();
    for(const a of this.players.values()){
      const sim=a.sim;before.set(a.id,{x:sim.body.position.x,z:sim.body.position.z});
      if(a.appearance&&!a.appearance.finished){
        const safe=isTrafficSpawnSafe(this.occupancy(a),this.occupants().filter(o=>o.id!==a.id),this.obstacles,0);
        if(a.appearance.advance(STEP,safe)){sim.appearing=false;this.world.addBody(sim.body);sim.attachDamageListener();this.halt(a.id);}
      }
      if(a.timed){if(this.tick-(a.packetTick??-Infinity)>=30)this.halt(a.id);
        const c=a.commands.get(this.tick+1);if(c&&a.connected&&!sim.appearing){a.control=c;a.lastSeq=a.lastAppliedTick=this.tick+1;a.lastInputTick=this.tick;}
        for(const t of a.commands.keys())if(t<=this.tick+1)a.commands.delete(t);}
      if(a.pending&&a.connected&&!sim.appearing){const {seq,...c}=a.pending;a.control=c;a.lastSeq=seq;a.lastAppliedTick=this.tick+1;a.lastInputTick=this.tick;a.pending=null;}
      if(!a.enabled||!a.connected||sim.appearing||a.arrest.snapshot().state==='arrested'||this.tick-a.lastInputTick>=30)this.halt(a.id);
      if(!sim.appearing)sim.prepare(a.control,STEP);
    }
    if(this.tick%12===0)this.updatePolice();
    this.runtime.prepare(STEP);
    const physical=this.runtime.physicalActors(),actors=[...this.players.values()].filter(a=>!a.sim.appearing)
      .map(a=>({id:a.id,body:a.sim.body,player:true})).concat(physical.map(a=>({id:a.id,body:a.body,player:false})));
    for(const a of actors)velocities.set(a.body,{...a.body.velocity});
    this.props.beforeStep(STEP,actors);this.world.step(STEP);this.steps++;this.contacts+=this.world.contacts.length;
    this.runtime.postStep(STEP);for(const a of this.players.values())if(!a.sim.appearing)a.sim.postStep(STEP);
    const property=this.props.afterStep(STEP),police=this.runtime.physicalActors();
    for(const a of [...this.players.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
      const sim=a.sim,p=this.occupancy(a),enabled=a.enabled&&a.connected&&!sim.appearing;
      if(a.dentGeneration!==a.generation){a.dents=[];a.dentGeneration=a.generation;}
      a.lastImpacts=sim.drainImpactEvents();a.dents.push(...a.lastImpacts.filter(e=>e.impact.depth>0).slice(0,32-a.dents.length));
      const observed=a.violations.update({dt:STEP,enabled,player:p,actors:police,contacts:this.world.contacts,velocitiesBefore:velocities,
        approaches:this.approaches,phaseAt:t=>this.signals.phase(t.nodeId,t.fromId,this.runtime.simulationTime())});
      const offenses=observed.concat(property.filter(e=>e.playerId===a.id));
      if(enabled){a.wanted.update(STEP,offenses);for(const e of offenses)this.event(e.type,a.id,{actorId:e.actorId,propId:e.propId});}
      const pickup=this.repairs.collectSegment(before.get(a.id),p,{enabled:enabled&&a.arrest.snapshot().state!=='arrested',damaged:sim.damage>0,
        detachedWheels:sim.wheels.some(w=>w.detached),bodyY:sim.body.position.y,expectedBodyY:this.surfaceHeight(p.x,p.z)+.96});
      if(pickup&&sim.repair()){a.dents=[];a.lastImpacts=[];a.repairRevision++;this.gameplayRevision++;this.event('repair',a.id,{pickupId:pickup.id});}
      const arrest=a.arrest.update(STEP,{playerId:a.id,wantedLevel:a.wanted.snapshot().level,player:{...p,speed:Math.hypot(p.vx,p.vz)},
        police:police.map(u=>({...u,speed:Math.hypot(u.vx,u.vz),clearPath:!corridorBlocked(p,u,this.obstacles,.65)})),enabled,damage:sim.damage});
      if(arrest.completed){this.halt(a.id);this.event('arrested',a.id);}
    }
    this.tick++;
    this.metrics.stepMs.push(performance.now()-start);this.metrics.aiMs.push(this.runtime.performance().aiStepMs);
    if(this.tick%120===0)this.metrics.physicalCounts.push(this.runtime.physicalActors().length);
    for(const k of ['stepMs','aiMs','physicalCounts'])if(this.metrics[k].length>50000)this.metrics[k].splice(0,10000);
  }
  gameplaySnapshot(){
    const state={pickups:this.repairs.snapshot().pickups,players:[...this.players.values()].map(a=>({id:a.id,repairRevision:a.repairRevision,
      wanted:a.wanted.snapshot(),arrest:a.arrest.snapshot(),appearing:Boolean(a.sim.appearing)})),
      police:(this.runtime?.states??[]).filter(a=>a.role==='police').map(a=>({id:a.id,targetId:a.ai.targetId,state:a.ai.state}))};
    const key=JSON.stringify(state);if(key!==this.lastGameplay){this.gameplayRevision++;this.lastGameplay=key;}
    return {...state,tick:this.tick,revision:this.gameplayRevision};
  }
  snapshot(){
    const actor=a=>{const s=a.sim??a.simulation,b=s.body;return{id:a.id,generation:a.generation??1,role:a.role,targetId:a.ai?.targetId??null,state:a.ai?.state??null,physical:!a.logical&&!s.appearing&&a.appearance?.stage!=='appearing',appearing:Boolean(s.appearing||a.appearance?.stage==='appearing'),
      p:vec(b.position),q:quat(b.quaternion),v:vec(b.velocity),av:vec(b.angularVelocity),steering:s.steering,throttle:s.throttle,
      control:{...(a.control??a.ai.control)},damage:s.damage,dents:a.dentGeneration===a.generation?a.dents??[]:[],
      connected:a.connected??true,lastProcessedInputSeq:a.lastSeq??-1,lastAppliedTick:a.lastAppliedTick??0,
      wheels:s.wheels.map(w=>({p:vec(w.detachedBody?.position??w.position),rotation:w.rotation,slip:w.slip,grounded:w.grounded,
        detached:w.detached,body:w.detachedBody?{q:quat(w.detachedBody.quaternion),v:vec(w.detachedBody.velocity),av:vec(w.detachedBody.angularVelocity)}:null}))};};
    return{protocolVersion:1,buildId:'core-1',roundId:`round-${this.round}`,tick:this.tick,serverTime:this.tick*STEP,stepSeconds:STEP,
      seed:this.plan.seed,roadWidth:this.plan.roadWidth,mapSignature:this.signature,generatorVersion:'core-1',players:[...this.players.values()].map(actor),
      actors:(this.runtime?.states??[]).map(actor),props:captureStreet(this.props),signalTime:this.runtime?.simulationTime()??0,
      gameplay:this.gameplaySnapshot(),events:this.events.map(e=>({...e})),coverage:'shared core: physics, traffic, police, wanted, arrest, repair, street props'};
  }
  reset(){for(const a of this.players.values()){a.sim.reset();a.wanted.reset();a.arrest.reset();a.violations.reset();a.dents=[];a.generation++;this.halt(a.id);}
    this.runtime.reset();this.props.reset();this.repairs.reset();this.tick=0;this.events=[];this.round++;this.gameplayRevision++;}
  dispose(){if(this.disposed)return;this.disposed=true;this.runtime?.dispose();this.props.dispose();
    for(const a of this.players.values()){a.commands.clear();a.pending=null;this.removeSim(a.sim);}this.players.clear();this.propById.clear();
    for(const b of [...this.world.bodies])this.world.removeBody(b);this.owner.staticBodies=[];this.events=[];
    for(const values of Object.values(this.metrics))values.length=0;}
}
export const createGameWorld=options=>new GameWorld(options);
