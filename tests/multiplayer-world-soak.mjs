import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameWorld, STEP } from '../src/simulation/game-world.js';
const out=process.env.ARTIFACT_DIR??'docs/knowledge/multiplayer/2026-10-23-core';await mkdir(out,{recursive:true});
const w=createGameWorld({seed:42,npcCount:102});await w.ready;
const players=['a','b','c'].map(id=>w.addPlayer(id));
const run=w.world.step.bind(w.world);let calls=0;w.world.step=(dt)=>{calls++;return run(dt);};
const samples=[],begin=performance.now();
try{
  for(let i=0;i<36000;i++){
    if(i===14400)for(const p of players)for(let star=0;star<3;star++)p.wanted.update(.51,[{type:'property-collision'}]);
    w.step();
    if(i%120===119){
      const s=w.snapshot();assert.equal(s.players.length,3);
      assert.ok([...s.players,...s.actors].every(a=>[...a.p,...a.q,...a.v].every(Number.isFinite)));
      assert.equal(s.actors.filter(a=>a.role==='civilian').length,102);
      samples.push({seconds:(i+1)*STEP,civilians:w.runtime.roleCount('civilian'),police:w.runtime.roleCount('police'),
        physical:w.runtime.physicalActors().length,bodies:w.world.bodies.length,
        wanted:s.gameplay.players.map(p=>p.wanted.level),arrest:s.gameplay.players.map(p=>p.arrest.state),
        targets:w.runtime.debug().filter(a=>a.role==='police').map(a=>a.targetId)});
    }
  }
  assert.equal(calls,36000);assert.equal(w.steps,36000);assert.equal(samples[119].police,3);assert.equal(samples[120].police,6);
  const sorted=[...w.metrics.stepMs].sort((a,b)=>a-b),quantile=p=>sorted[Math.ceil(sorted.length*p)-1];
  const report={date:'2026-10-23',node:process.version,seed:42,simulationSeconds:300,ticks:w.tick,solverCalls:calls,
    durationMs:performance.now()-begin,stepP50:quantile(.5),stepP95:quantile(.95),stepP99:quantile(.99),samples,
    scope:'accelerated shared production core; 3 players, 102 civilians, 3 then 6 police; not WAN/render/VPS capacity acceptance'};
  await writeFile(out+'/soak.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,samples:report.samples.length}));
}finally{w.dispose();assert.equal(w.world.bodies.length,0);}
