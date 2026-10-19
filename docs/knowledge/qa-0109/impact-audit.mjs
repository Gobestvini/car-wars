import fs from 'node:fs';
import assert from 'node:assert/strict';
import { SpikeWorld, STEP } from '../../../tools/multiplayer-spike/world.js';
import { sidewalkImpact, greenSignals, npcTrace } from '../../../tests/npc-sidewalk-fixture.js';
import { offlineImpact } from '../../../tests/offline-npc-fixture.js';
import { edgeProgress } from '../../../src/traffic-planner.js';
const report={date:'2026-10-19',isolation:'Diagnostic A/B: only contact-recovery input disabled; current TASK-0108 physics, route and collisions retained. Not a historical revision.',weak:[],strong:[]};
for(const runtime of ['online','offline'])for(const enabled of [false,true]) {
  const f=runtime==='online'?(()=>{const world=new SpikeWorld({seed:42,npcCount:1,playerCount:1});world.signals=greenSignals;
    return {world,...sidewalkImpact(world,{speed:2,choice:3}),step:()=>world.step(),dispose:()=>world.dispose()};})():offlineImpact({speed:2,choice:3});
  if(!enabled) {
    if(runtime==='offline')f.traffic.setStreetProps(null);
    else {const original=f.world.think.bind(f.world);f.world.think=()=>{const map=f.world.props.byBody,get=map.get;
      map.get=()=>undefined;try {original();}finally {map.get=get;}};}
  }
  const body=runtime==='online'?f.actor.sim.body:f.state.simulation.body;
  const row={runtime,enabled,id:runtime==='online'?f.actor.id:f.state.id,prop:f.prop.id,edge:[f.edge.from,f.edge.to],initial:f.initial,
    contact:false,recoveryAt:null,samples:[]};
  try {
    for(let i=0;i<1200;i++) {
      f.step();row.contact ||= f.world.world.contacts.some(c=>c.bi===f.prop.body||c.bj===f.prop.body);
      const ai=runtime==='online'?f.actor:f.state.ai;
      if(ai.waitReason==='prop-recovery'&&row.recoveryAt===null)row.recoveryAt=(i+1)*STEP;
      if(i%120===119)row.samples.push({time:(i+1)*STEP,p:[body.position.x,body.position.y,body.position.z],
        v:[body.velocity.x,body.velocity.y,body.velocity.z],q:[body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w],
        reason:ai.waitReason,targetSpeed:ai.targetSpeed,control:ai.control,progress:edgeProgress(body.position,f.edge)-edgeProgress(f.initial,f.edge)});
    }
    row.distance=edgeProgress(body.position,f.edge)-edgeProgress(f.initial,f.edge);row.propState=f.prop.state;
    assert.equal(row.contact,true);assert.equal(row.propState,'intact');
    if(enabled){assert.ok(row.recoveryAt<=3);assert.ok(row.distance>3);}
    else assert.ok(row.distance<.5);
    report.weak.push(row);
  } finally {f.dispose();}
}
for(const type of ['bin','lamp']) {
  const w=new SpikeWorld({seed:42,npcCount:2,playerCount:1});w.signals=greenSignals;
  const f=sidewalkImpact(w,{type,follower:true}),follower=w.npcs[1],start={...follower.sim.body.position};
  const row={type,id:f.actor.id,follower:follower.id,prop:f.prop.id,contact:false,maxStep:0,samples:[]};let previous={...f.initial};
  try {
    for(let i=0;i<1200;i++) {
      w.step();row.contact ||= w.world.contacts.some(c=>c.bi===f.prop.body||c.bj===f.prop.body)||f.prop.state!=='intact';
      const p=f.actor.sim.body.position;row.maxStep=Math.max(row.maxStep,Math.hypot(p.x-previous.x,p.z-previous.z));previous={...p};
      if(i%120===119)row.samples.push({time:(i+1)*STEP,actor:npcTrace(w,f.actor),follower:npcTrace(w,follower),prop:f.prop.state});
    }
    row.progress=edgeProgress(f.actor.sim.body.position,f.edge)-edgeProgress(f.initial,f.edge);
    row.followerProgress=Math.hypot(follower.sim.body.position.x-start.x,follower.sim.body.position.z-start.z);
    assert.ok(row.progress>3);assert.ok(row.followerProgress>3);assert.ok(row.maxStep<.3);assert.equal(f.prop.state,'removed');
    report.strong.push(row);
  }finally {w.dispose();}
}
report.pass=true;fs.writeFileSync(new URL('./impact-audit.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({pass:true,weak:report.weak.map(({samples,...row})=>row),strong:report.strong.map(({samples,...row})=>row)}));
