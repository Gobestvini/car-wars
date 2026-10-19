import fs from 'node:fs';
import assert from 'node:assert/strict';
import { SpikeWorld, STEP } from '../../../tools/multiplayer-spike/world.js';
import { sidewalkImpact, npcTrace } from '../../../tests/npc-sidewalk-fixture.js';
const w=new SpikeWorld({seed:42,npcCount:102,playerCount:3});
sidewalkImpact(w,{type:'bin',choice:3});sidewalkImpact(w,{type:'lamp',actorIndex:1});
const report={seed:42,warmupSeconds:30,clearanceSeconds:10,samples:[]};
try {
  for(let i=0;i<3600;i++)w.step();
  const a=w.npcs.find(a=>a.id==='npc-58'),node=a.edge.to,p={...a.sim.body.position};
  report.before={trace:npcTrace(w,a),diagnostics:w.npcDiagnostics().find(d=>d.id===a.id),players:[...w.players.values()].map(a=>({id:a.id,p:{...a.sim.body.position}}))};
  assert.equal(a.blocker,'scripted-0');assert.equal(w.junctionOwners.get(node),a.id);
  for(const p of w.players.values()){p.sim.body.position.set(500,1,500);p.sim.body.velocity.setZero();p.sim.body.aabbNeedsUpdate=true;}
  let started=null,released=null;
  for(let i=0;i<1200;i++) {
    w.step();if(started===null&&Math.hypot(a.sim.body.velocity.x,a.sim.body.velocity.z)>.3)started=(i+1)*STEP;
    if(released===null&&w.junctionOwners.get(node)!==a.id)released=(i+1)*STEP;
    if(i%120===119)report.samples.push({after:(i+1)*STEP,trace:npcTrace(w,a),oldOwner:w.junctionOwners.get(node)??null});
  }
  report.started=started;report.released=released;report.distance=Math.hypot(a.sim.body.position.x-p.x,a.sim.body.position.z-p.z);
  assert.ok(started<=3&&started!==null);assert.ok(report.distance>3);assert.ok(released!==null&&released<=10);
  report.pass=true;console.log(JSON.stringify({pass:true,started,released,distance:report.distance}));
}catch(error){report.failure=error.stack;throw error;}
finally{fs.writeFileSync(new URL('./clearance-audit.json',import.meta.url),JSON.stringify(report,null,2));w.dispose();}
