import test from 'node:test';
import assert from 'node:assert/strict';
import { SpikeWorld, STEP } from '../tools/multiplayer-spike/world.js';
import { edgeProgress } from '../src/traffic-planner.js';
import { sidewalkImpact, greenSignals } from './npc-sidewalk-fixture.js';
import { offlineImpact } from './offline-npc-fixture.js';

const step=(w,seconds)=>{for(let i=0;i<Math.round(seconds/STEP);i++)w.step();};
const along=f=>edgeProgress(f.actor.sim.body.position,f.edge)-edgeProgress(f.initial,f.edge);

test('real bin and lamp breaking impacts leave the NPC and its queue moving, with continuous LOD',()=>{
  for(const type of ['bin','lamp']) {
    const w=new SpikeWorld({seed:42,npcCount:2,playerCount:1});w.signals=greenSignals;
    try {
      const f=sidewalkImpact(w,{type,follower:true}),follower=w.npcs[1],start={...follower.sim.body.position};
      let broken=false,maxStep=0,previous={...f.actor.sim.body.position};
      for(let i=0;i<1200;i++) {
        w.step();broken ||= f.prop.state!=='intact';const p=f.actor.sim.body.position;
        maxStep=Math.max(maxStep,Math.hypot(p.x-previous.x,p.z-previous.z));previous={...p};
        assert.equal(w.buildingIndex.overlaps(w.occupancy(f.actor)),false);
      }
      assert.equal(broken,true);assert.ok(along(f)>3);assert.ok(maxStep<.3,`LOD jump ${type}: ${maxStep}`);
      assert.ok(Math.hypot(follower.sim.body.position.x-start.x,follower.sim.body.position.z-start.z)>3);
      assert.ok(f.actor.sim.wheels.every(w=>!w.detached));
      for(const p of w.players.values())p.sim.body.position.set(500,1,500);
      step(w,10);assert.equal(f.actor.physical,false,`${type} should regain logical simulation`);
      const p=[...w.players.values()][0];p.sim.body.position.set(f.actor.sim.body.position.x+10,1,f.actor.sim.body.position.z);
      step(w,.2);assert.equal(f.actor.physical,true);assert.equal(w.world.bodies.includes(f.actor.sim.body),true);
    } finally {w.dispose();}
  }
});

test('weak real contact keeps the prop intact and takes a safe retreat, never a power increase',()=>{
  const w=new SpikeWorld({seed:42,npcCount:1,playerCount:1});w.signals=greenSignals;
  try {
    const f=sidewalkImpact(w,{speed:2,choice:3});let contact=false,recoveryAt=null,maxStep=0,previous={...f.initial};
    for(let i=0;i<1200;i++) {
      w.step();contact ||= w.world.contacts.some(c=>c.bi===f.prop.body||c.bj===f.prop.body);
      if(f.actor.waitReason==='prop-recovery'&&recoveryAt===null)recoveryAt=w.tick*STEP;
      const p=f.actor.sim.body.position;maxStep=Math.max(maxStep,Math.hypot(p.x-previous.x,p.z-previous.z));previous={...p};
      assert.equal(w.buildingIndex.overlaps(w.occupancy(f.actor)),false);
    }
    assert.equal(contact,true);assert.equal(f.prop.state,'intact');assert.ok(recoveryAt<=3,`recovery ${recoveryAt}`);
    assert.ok(along(f)>3,`progress ${along(f)}`);assert.ok(maxStep<.2);assert.equal(f.actor.propManeuver,null);
  }finally{w.dispose();}
});

test('a rear blocker prevents retreat; removal enables recovery without destroying the weak-hit prop',()=>{
  const w=new SpikeWorld({seed:42,npcCount:1,playerCount:1});w.signals=greenSignals;
  try {
    const f=sidewalkImpact(w,{speed:2,choice:3}),player=[...w.players.values()][0],b=player.sim.body;
    b.position.set(f.initial.x-Math.sin(f.edge.heading)*6,1,f.initial.z-Math.cos(f.edge.heading)*6);
    b.quaternion.setFromEuler(0,f.edge.heading,0);b.velocity.setZero();b.aabbNeedsUpdate=true;
    step(w,4);assert.equal(f.actor.waitReason,'prop-no-safe-corridor');assert.equal(f.actor.propManeuver,null);
    assert.ok(Math.hypot(f.actor.sim.body.position.x-f.initial.x,f.actor.sim.body.position.z-f.initial.z)<1.5);
    b.position.set(f.initial.x+15,1,f.initial.z-15);b.aabbNeedsUpdate=true;
    step(w,10);assert.equal(f.prop.state,'intact');assert.ok(along(f)>3);
  }finally{w.dispose();}
});

test('a physically blocked sidewalk waits truthfully and resumes when the prop is actually cleared',()=>{
  const w=new SpikeWorld({seed:42,npcCount:1,playerCount:1});w.signals=greenSignals;
  try {
    const f=sidewalkImpact(w,{speed:2});step(w,5);
    assert.equal(f.actor.waitReason,'prop-no-safe-corridor');assert.equal(f.prop.state,'intact');assert.ok(along(f)<.5);
    w.props.detach(f.prop,{body:f.actor.sim.body},{x:0,z:1},60);step(w,10);
    assert.ok(along(f)>3);assert.equal(f.actor.propBlocker,null);
  }finally{w.dispose();}
});

test('red signal and occupied exit remain lawful stops after the breaking contact, then resume on clearance',()=>{
  for(const mode of ['red','exit']) {
    const w=new SpikeWorld({seed:42,npcCount:1,playerCount:1});
    try {
      const f=sidewalkImpact(w,{speed:6,choice:3});
      w.signals=mode==='red'?{phase:()=>({color:'red',canEnter:false,controlled:true})}:greenSignals;
      if(mode==='exit') {
        const e=f.actor.outgoing,b=[...w.players.values()][0].sim.body;
        b.position.set(e.start.x+Math.sin(e.heading)*12.5,1,e.start.z+Math.cos(e.heading)*12.5);b.aabbNeedsUpdate=true;
      }
      step(w,12);assert.notEqual(f.prop.state,'intact');assert.equal(f.actor.waitReason,mode==='red'?'signal-red':'blocked-junction-exit');
      assert.notEqual(w.junctionOwners.get(f.edge.to),f.actor.id);
      const before={...f.actor.sim.body.position};w.signals=greenSignals;
      for(const player of w.players.values())player.sim.body.position.set(500,1,500);
      step(w,3);assert.ok(Math.hypot(f.actor.sim.body.velocity.x,f.actor.sim.body.velocity.z)>.3);
      step(w,7);assert.ok(Math.hypot(f.actor.sim.body.position.x-before.x,f.actor.sim.body.position.z-before.z)>3);
    }finally{w.dispose();}
  }
});

test('offline uses the same measured contact recovery, including a tall lamp and intact weak-hit prop',()=>{
  for(const options of [{type:'bin',speed:16},{type:'lamp',speed:16},{type:'bin',speed:2,choice:3}]) {
    const f=offlineImpact(options);let recovered=false;
    try {
      for(let i=0;i<1200;i++){f.step();recovered ||= f.state.ai.waitReason==='prop-recovery';}
      const distance=edgeProgress(f.state.simulation.body.position,f.edge)-edgeProgress(f.initial,f.edge);
      assert.ok(distance>3,`${JSON.stringify(options)}: ${distance}`);
      assert.equal(f.prop.state,options.speed===2?'intact':'removed');
      if(options.speed===2)assert.equal(recovered,true);
      assert.equal(f.traffic.states.length,1);assert.ok(f.state.simulation.wheels.every(w=>!w.detached));
    }finally{f.dispose();}
  }
});

test('an unentered reservation behind the queue cannot keep its own leader waiting forever',()=>{
  const w=new SpikeWorld({seed:42,npcCount:2});w.signals=greenSignals;
  try {
    const f=sidewalkImpact(w,{choice:3,follower:true}),leader=f.actor,follower=w.npcs[1];
    for(const [a,progress]of [[leader,39.5],[follower,33]]) {
      const b=a.sim.body;b.position.set(f.edge.start.x+Math.sin(f.edge.heading)*progress,.96,f.edge.start.z+Math.cos(f.edge.heading)*progress);
      b.velocity.setZero();b.angularVelocity.setZero();b.aabbNeedsUpdate=true;
    }
    w.junctionOwners.set(f.edge.to,follower.id);const initial={...leader.sim.body.position};
    step(w,3);assert.ok(Math.hypot(leader.sim.body.position.x-initial.x,leader.sim.body.position.z-initial.z)>3);
    assert.notEqual(w.junctionOwners.get(f.edge.to),follower.id);
  }finally{w.dispose();}
});

test('the weak-contact fallback itself cannot bypass a red signal',()=>{
  const w=new SpikeWorld({seed:42,npcCount:1,playerCount:1});
  try {
    const f=sidewalkImpact(w,{speed:2,choice:3});w.signals={phase:()=>({color:'red',canEnter:false,controlled:true})};
    step(w,5);assert.equal(f.actor.waitReason,'signal-red');assert.equal(f.actor.propManeuver,null);assert.ok(along(f)<1);
    w.signals=greenSignals;step(w,10);assert.equal(f.prop.state,'intact');assert.ok(along(f)>3);
  }finally{w.dispose();}
});
