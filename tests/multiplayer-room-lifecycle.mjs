// Real default grace boundaries and repeated service lifecycle. Operator acceptance, not a load benchmark.
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { service,attach,until,sleep } from './helpers/hosted-room.mjs';
const out=process.env.ARTIFACT_DIR??'docs/knowledge/multiplayer/2026-10-23-rooms';await mkdir(out,{recursive:true});
const report={date:'2026-10-23',node:process.version,scope:'loopback actual SDK/WebSocket; 102 civilians; not WAN/VPS sizing',cycles:[]};
const s=await service();
try{
  const a=await s.join(),b=await s.join(a.roomId),c=await s.join(a.roomId),r=s.room(a.roomId),actor=r.sim.players.get(a.sessionId),token=a.reconnectionToken;
  const before=r.sim.tick,start=performance.now();a.connection.close(4001);await until(()=>!actor.connected);assert.equal(actor.control.brake,1);
  await sleep(5000);const resumed=await attach(s,await s.sdk.reconnect(token));assert.equal(resumed.sessionId,a.sessionId);assert.equal(r.sim.players.get(a.sessionId),actor);
  report.reconnect5={waitMs:5000,sameIdentity:true,sameActor:true,neutralImmediately:true};
  const expired=resumed.reconnectionToken;resumed.connection.close(4001);await until(()=>!actor.connected);await sleep(16000);
  await until(()=>!r.sim.players.has(a.sessionId));await assert.rejects(s.sdk.reconnect(expired));
  const fresh=await s.join(b.roomId);assert.notEqual(fresh.sessionId,a.sessionId);assert.equal(fresh.welcome.snapshot.players.length,2);
  report.reconnect16={waitMs:16000,oldTokenRejected:true,newIdentity:true,fullSnapshot:true};
  const invalid=r.metrics.invalidInputs,tick=r.sim.tick;
  b.send('input',{roundId:r.roundId,generation:1,seq:4,steer:0,throttle:1,brake:0,wanted:6});
  await until(()=>r.metrics.invalidInputs>invalid&&c.frame.tick>tick+12);
  const hz=values=>values.length*1000/values.reduce((a,b)=>a+b,0),p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
  report.live={seconds:(performance.now()-start)/1000,physicsHz:(r.sim.tick-before)*1000/(performance.now()-start),
    schedulerHz:hz(r.metrics.schedulerIntervals),patchHz:hz(r.metrics.patchIntervals),schedulerIntervalP95:p95(r.metrics.schedulerIntervals),patchIntervalP95:p95(r.metrics.patchIntervals),
    droppedSeconds:r.metrics.droppedSeconds,maxDebtSeconds:r.metrics.maxDebtSeconds,wireBytes:r.metrics.wireBytes,
    maxSocketQueueBytes:r.metrics.maxQueueBytes,invalidInputs:r.metrics.invalidInputs,bodyCount:r.sim.world.bodies.length,npc:r.sim.runtime.roleCount('civilian')};
  assert.equal(report.live.npc,102);
  await Promise.all([b,c,fresh].map(p=>p.leave()));await until(()=>!s.rooms.size);assert.equal(r.sim.world.bodies.length,0);
  for(let i=0;i<20;i++){
    const peer=await s.join(),room=s.room(peer.roomId);assert.equal(room.sim.runtime.roleCount('civilian'),102);await peer.leave();await until(()=>!s.rooms.size);
    assert.equal(room.sim.world.bodies.length,0);assert.equal(room.pendingMaps.size,0);assert.equal(room.transfers.size,0);assert.equal(room.metrics.byClient.size,0);
    assert.equal(room._simulationInterval,undefined);report.cycles.push({cycle:i+1,bodies:0,pending:0,transfers:0,meters:0,schedulerDisposed:true});
  }
  report.passed=true;
}finally{await s.cleanup();await writeFile(out+'/lifecycle.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({...report,cycles:report.cycles.length}));
