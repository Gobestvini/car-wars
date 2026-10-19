import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SpikeWorld, STEP } from '../tools/multiplayer-spike/world.js';
import { sidewalkImpact, npcTrace } from './npc-sidewalk-fixture.js';

const out=process.env.ARTIFACT_DIR||'docs/knowledge/multiplayer/2026-10-19-npc-liveness';
fs.mkdirSync(out,{recursive:true});
const w=new SpikeWorld({seed:42,npcCount:102,playerCount:3});
const report={date:'2026-10-19',seed:42,seconds:300,population:[102,3],collisions:[],trace:[],longWaitEvidence:[],unexplained:[],maxStep:0,houseOverlaps:[]};
const first=sidewalkImpact(w,{type:'bin',choice:3}),second=sidewalkImpact(w,{type:'lamp',actorIndex:1});
report.collisions=[first,second].map(f=>({npc:f.actor.id,prop:f.prop.id,type:f.prop.type,speed:f.speed,edge:[f.edge.from,f.edge.to],p:f.initial}));
const stats=new Map(w.npcs.map(a=>[a.id,{id:a.id,distance:0,maxStop:0,stop:0,reasons:{},transitions:0,physical:a.physical,previous:{...a.sim.body.position}}]));
try {
  for(let i=0;i<36000;i++) {
    w.step();
    for(const a of w.npcs) {
      const s=stats.get(a.id),p=a.sim.body.position,d=Math.hypot(p.x-s.previous.x,p.z-s.previous.z);
      s.distance+=d;report.maxStep=Math.max(report.maxStep,d);s.previous={...p};
      if(a.physical!==s.physical){s.transitions++;s.physical=a.physical;}
    }
    if(i%12!==11)continue;
    const diagnostics=w.npcDiagnostics();
    for(const d of diagnostics) {
      const a=w.npcs.find(a=>a.id===d.id),s=stats.get(d.id),slow=Math.hypot(d.v[0],d.v[2])<.3;
      s.stop=slow?s.stop+.1:0;s.maxStop=Math.max(s.maxStop,s.stop);
      if(slow) {
        // Contacts are measured separately; a desired throttle is not evidence
        // of a free corridor, and a generic 'stall' label is not an explanation.
        const reason=d.reason || (d.contacts.length?'physical-contact':null);
        s.freeStop=reason?0:(s.freeStop||0)+.1;
        if(reason)s.reasons[reason]=(s.reasons[reason]||0)+.1;
        if(s.freeStop>10)report.unexplained.push({time:w.tick*STEP,...d});
        if(s.stop>10&&i%1200===1199)report.longWaitEvidence.push({time:w.tick*STEP,...d});
      } else s.freeStop=0;
      if(w.buildingIndex.overlaps(w.occupancy(a)))report.houseOverlaps.push({time:w.tick*STEP,id:a.id,p:d.p});
    }
    if(i%120===119)report.trace.push([first,second].map(f=>({...npcTrace(w,f.actor),prop:f.prop.state})));
  }
  report.npcs=[...stats.values()].map(({previous,physical,stop,...s})=>s);
  report.finalCollisions=[first,second].map(f=>({id:f.actor.id,state:f.prop.state,trace:npcTrace(w,f.actor)}));
  assert.equal(w.npcs.length,102);assert.equal(w.players.size,3);
  assert.equal(report.houseOverlaps.length,0,`house overlaps ${JSON.stringify(report.houseOverlaps.slice(0,2))}`);
  assert.ok(report.maxStep<.3,`jump ${report.maxStep}`);
  assert.equal(report.unexplained.length,0,`unexplained ${JSON.stringify(report.unexplained.slice(0,2))}`);
  for(const f of [first,second])assert.equal(f.prop.state,'removed');
  report.pass=true;console.log(JSON.stringify({pass:true,maxStep:report.maxStep,npcs:report.npcs.length,unexplained:report.unexplained.length,
    longestStop:Math.max(...report.npcs.map(n=>n.maxStop))}));
}catch(error){report.failure=error.stack;throw error;}
finally{fs.writeFileSync(path.join(out,'soak.json'),JSON.stringify(report,null,2));w.dispose();}
