import fs from 'node:fs';
import assert from 'node:assert/strict';
import { SpikeWorld, STEP } from '../../../tools/multiplayer-spike/world.js';
import { sidewalkImpact, greenSignals, npcTrace } from '../../../tests/npc-sidewalk-fixture.js';
const w=new SpikeWorld({seed:42,npcCount:1,playerCount:1});w.signals=greenSignals;
const f=sidewalkImpact(w,{speed:2,choice:3}),b=f.actor.sim.body;
// Explicit separate initial condition outside upright liveness acceptance.
b.quaternion.setFromEuler(Math.PI,f.edge.heading,0);b.aabbNeedsUpdate=true;
const report={seed:42,note:'Overturned initial operator pose; no automatic upright recovery is required by this task.',samples:[]};
try {
  for(let i=0;i<1200;i++) {
    w.step();if(f.actor.propManeuver)assert.ok(Math.abs(b.quaternion.x)<.15&&Math.abs(b.quaternion.z)<.15);
    if(i%120===119)report.samples.push(npcTrace(w,f.actor));
  }
  report.finalWheels=f.actor.sim.wheels.map(w=>w.detached);report.count=w.npcs.length;report.inWorld=w.world.bodies.includes(b);
  assert.equal(report.count,1);assert.equal(report.inWorld,true);assert.ok(report.finalWheels.every(d=>!d));
  report.pass=true;console.log(JSON.stringify(report.samples.at(-1)));
}finally{fs.writeFileSync(new URL('./orientation-audit.json',import.meta.url),JSON.stringify(report,null,2));w.dispose();}
