import fs from 'node:fs';
import assert from 'node:assert/strict';
import { SpikeWorld, STEP } from '../../../tools/multiplayer-spike/world.js';
import { sidewalkImpact, npcTrace } from '../../../tests/npc-sidewalk-fixture.js';
import { followingLimit, occupiesJunction, edgeProgress } from '../../../src/traffic-planner.js';
import { footprintsOverlap } from '../../../src/traffic-spawn.js';

const w = new SpikeWorld({seed:42,npcCount:102,playerCount:3});
const impacts = [sidewalkImpact(w,{type:'bin',choice:3}),sidewalkImpact(w,{type:'lamp',actorIndex:1})];
const report = {date:'2026-10-19',seed:42,seconds:300,population:[102,3],
  collisions:impacts.map(f=>({id:f.actor.id,prop:f.prop.id,edge:[f.edge.from,f.edge.to],p:f.initial})),
  maxStep:0,houseOverlaps:[],unverifiedContinuous:[],longWaitEvidence:[],trace:[]};
const stats = new Map(w.npcs.map(a=>[a.id,{id:a.id,distance:0,maxStop:0,stop:0,unverified:0,maxUnverified:0,
  reasons:{},transitions:0,physical:a.physical,previous:{...a.sim.body.position}}]));
function proof(a,d,occupants) {
  const car=w.occupancy(a), blocker=[...w.players.values(),...w.npcs].find(o=>o.id===d.blocker);
  const blockerPose=blocker&&w.occupancy(blocker);
  if(d.reason?.startsWith('signal-'))return {valid:!d.phase.canEnter,kind:'signal',phase:d.phase};
  if(d.reason==='intersection-reservation') {
    const owner=w.npcs.find(o=>o.id===d.owner),node=w.graph.nodes.get(a.edge.to);
    return {valid:Boolean(owner&&owner!==a&&owner.edge.to===a.edge.to),kind:'reservation',
      owner:owner?.id,p:owner&&w.occupancy(owner),entered:owner&&occupiesJunction(w.occupancy(owner),node,w.plan.roadWidth),
      ownerReason:owner?.waitReason,ownerBlocker:owner?.blocker};
  }
  if(d.reason==='blocked-junction-exit') {
    const e=a.outgoing,exit=e&&{x:e.start.x+Math.sin(e.heading)*(w.plan.roadWidth/2+5),
      z:e.start.z+Math.cos(e.heading)*(w.plan.roadWidth/2+5),heading:e.heading};
    return {valid:Boolean(exit&&blockerPose&&footprintsOverlap(exit,blockerPose,1)),kind:'exit',exit,blocker:blockerPose};
  }
  if(d.reason==='blocked-by-leader') {
    const limits=occupants.filter(o=>o.id!==a.id).map(o=>({id:o.id,limit:followingLimit(car,o,Math.sin(car.heading),Math.cos(car.heading)),p:o}));
    const best=limits.sort((x,y)=>x.limit-y.limit)[0];
    const laneLeader=blocker&&blocker.edge?.from===a.edge.from&&blocker.edge?.to===a.edge.to
      &&edgeProgress(blocker.sim.body.position,blocker.edge)>edgeProgress(a.sim.body.position,a.edge)+.5;
    return {valid:best.limit<.4||Boolean(laneLeader),kind:'leader',best,laneLeader,blocker:blockerPose};
  }
  if(d.reason?.startsWith('prop-'))return {valid:Boolean(a.propBlocker?.state==='intact'),kind:'prop',prop:a.propBlocker?.id};
  return {valid:d.contacts.length>0,kind:'contact',contacts:d.contacts};
}
try {
  for(let i=0;i<36000;i++) {
    w.step();
    for(const a of w.npcs) {
      const s=stats.get(a.id),p=a.sim.body.position,delta=Math.hypot(p.x-s.previous.x,p.z-s.previous.z);
      s.distance+=delta;s.previous={...p};report.maxStep=Math.max(report.maxStep,delta);
      if(a.physical!==s.physical){s.transitions++;s.physical=a.physical;}
    }
    if(i%12!==11)continue;
    const diagnostics=w.npcDiagnostics(),occupants=w.occupants();
    for(const d of diagnostics) {
      const a=w.npcs.find(a=>a.id===d.id),s=stats.get(a.id),slow=Math.hypot(d.v[0],d.v[2])<.3,p=proof(a,d,occupants);
      s.stop=slow?s.stop+.1:0;s.maxStop=Math.max(s.maxStop,s.stop);
      s.unverified=slow&&!p.valid?s.unverified+.1:0;s.maxUnverified=Math.max(s.maxUnverified,s.unverified);
      if(slow)s.reasons[d.reason||'physical-contact']=(s.reasons[d.reason||'physical-contact']||0)+.1;
      if(s.unverified>10)report.unverifiedContinuous.push({time:w.tick*STEP,...d,proof:p});
      if(s.stop>10&&i%1200===1199)report.longWaitEvidence.push({time:w.tick*STEP,...d,proof:p});
      if(w.buildingIndex.overlaps(w.occupancy(a)))report.houseOverlaps.push({time:w.tick*STEP,id:a.id,p:d.p});
    }
    if(i%120===119)report.trace.push(impacts.map(f=>({...npcTrace(w,f.actor),prop:f.prop.state})));
  }
  report.npcs=[...stats.values()].map(({previous,physical,stop,unverified,...s})=>s);
  report.final=w.npcDiagnostics().map(d=>({...d,proof:proof(w.npcs.find(a=>a.id===d.id),d,w.occupants())}));
  report.owners=[...w.junctionOwners];
  report.collisionFinal=impacts.map(f=>({id:f.actor.id,prop:f.prop.state,trace:npcTrace(w,f.actor)}));
  assert.equal(w.npcs.length,102);assert.equal(w.players.size,3);
  assert.equal(report.houseOverlaps.length,0);assert.ok(report.maxStep<.3);
  assert.equal(report.unverifiedContinuous.length,0);
  for(const f of impacts)assert.equal(f.prop.state,'removed');
  report.pass=true;
  console.log(JSON.stringify({pass:true,maxStep:report.maxStep,longestStop:Math.max(...report.npcs.map(s=>s.maxStop)),
    maxUnverified:Math.max(...report.npcs.map(s=>s.maxUnverified)),longWaitEvidence:report.longWaitEvidence.length,
    reasons:[...new Set(report.longWaitEvidence.map(d=>d.reason||'physical-contact'))]}));
} catch(error) {report.failure=error.stack;throw error;}
finally {fs.writeFileSync(new URL('./soak-audit.json',import.meta.url),JSON.stringify(report,null,2));w.dispose();}
