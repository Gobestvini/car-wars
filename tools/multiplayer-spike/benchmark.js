import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { cpus, totalmem, platform, release } from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { SpikeWorld, STEP } from './world.js';
import { startServer } from './server.js';
import { summary } from './protocol.js';

export const outputDir = new URL('../../docs/knowledge/multiplayer/', import.meta.url);
export async function metadata() {
  const sources = {};
  for(const name of ['src/vehicle.js','src/traffic-ai.js','src/traffic-planner.js','src/city-generator.js',
    'src/city-boundary.js','src/road-surface.js','src/traffic-signals.js','src/city-broadphase.js']) {
    sources[name] = createHash('sha256').update(await readFile(new URL(`../../${name}`,import.meta.url))).digest('hex');
  }
  return { date: new Date().toISOString(), node:process.version, os:`${platform()} ${release()}`,
    cpu:cpus()[0].model, logicalCpus:cpus().length, memoryBytes:totalmem(), sourceHashes:sources,execArgv:process.execArgv,
    packages:JSON.parse(await readFile(new URL('package.json',import.meta.url),'utf8')).dependencies,
    gitBaseline:'dc9eb0603b82bd3db4d1accbc7dda214efa9bb0c plus pre-existing working changes',
    seed:20261005, physicsHz:120,schedulerHz:60,AIHz:10,patchHz:20,
    limitations:['reduced AI harness, not full production junction/reservation/evasion/police/gameplay',
      'server-only physics; physics LOD is harness union-of-players approximation',
      'plain WS on loopback, no TLS; wire counts WS framing, excludes TCP/IP overhead'] };
}
async function offline(playerCount,npcCount,seconds,allPhysical=false) {
  const w = new SpikeWorld({playerCount,npcCount,allPhysical});
  const start=performance.now();
  for(let tick=0;tick<seconds/STEP;tick++) {
    if(tick%4===0)for(const a of w.players.values()) w.input(a.id,{seq:tick,steer:Math.sin(tick/300)*.25,throttle:.5,brake:0});
    w.step();
    if(tick%120===0)await sleep(0); // yields without pretending this is real-time
  }
  const result={type:'accelerated-simulation',playerCount,npcCount,allPhysical,simulatedSeconds:seconds,
    wallSeconds:(performance.now()-start)/1000,stepMs:summary(w.metrics.stepMs),aiMs:summary(w.metrics.aiMs),
    physicalCounts:summary(w.metrics.physicalCounts),transitions:w.metrics.transitions,
    raw:structuredClone(w.metrics),mapSignature:w.signature,bodyCount:w.world.bodies.length,contacts:w.contacts};
  w.dispose();return result;
}
async function online(seconds,warmupSeconds) {
  const s=await startServer(); const sdk=new Client(`http://127.0.0.1:${s.port}`);
  const clients=[];let timer;
  try {
    const a=await sdk.create('driving',{protocolVersion:1});clients.push(a);
    clients.push(await sdk.joinById(a.roomId,{protocolVersion:1}),await sdk.joinById(a.roomId,{protocolVersion:1}));
    for(const c of clients){c.onMessage('welcome',()=>{});c.onMessage('full',()=>{});}
    const room=await matchMaker.getLocalRoomById(a.roomId);
    let seq=0;
    timer=setInterval(()=>{seq++;for(const c of clients)c.send('input',{
      roundId:'round-1',seq,steer:Math.sin(seq/60)*.25,throttle:.5,brake:0});},1000/30);
    await sleep(warmupSeconds*1000);
    room.sim.metrics.stepMs.length=room.sim.metrics.aiMs.length=room.sim.metrics.physicalCounts.length=0;
    room.metrics.schedulerMs.length=room.metrics.snapshotMs.length=room.metrics.encodingMs.length=0;
    const begin=performance.now(),tickStart=room.sim.tick,wireStart=room.metrics.wireBytes;
    const perClientStart=new Map(room.metrics.byClient),droppedStart=room.metrics.droppedSeconds;
    const memory=[]; const cpuStart=process.cpuUsage();
    while(performance.now()-begin<seconds*1000){await sleep(1000);global.gc?.();
      memory.push({elapsedSeconds:(performance.now()-begin)/1000,...process.memoryUsage(),tick:room.sim.tick});
      if(memory.length%30===0)console.log(`online ${memory.length}s tick=${room.sim.tick} steps p95=${summary(room.sim.metrics.stepMs).p95.toFixed(3)}ms`);
    }
    const actualSeconds=(performance.now()-begin)/1000;
    const clientsWire=clients.map(c=>({id:c.sessionId,KiBPerSecond:
      ((room.metrics.byClient.get(c.sessionId)||0)-(perClientStart.get(c.sessionId)||0))/1024/actualSeconds}));
    const result={type:'real-time-actual-SDK',playerCount:3,npcCount:102,seconds:actualSeconds,warmupSeconds,
      ticks:room.sim.tick-tickStart,expectedTicks:actualSeconds/STEP,stepMs:summary(room.sim.metrics.stepMs),
      aiMs:summary(room.sim.metrics.aiMs),schedulerMs:summary(room.metrics.schedulerMs),snapshotMs:summary(room.metrics.snapshotMs),encodingMs:summary(room.metrics.encodingMs),
      wireBytes:room.metrics.wireBytes-wireStart,clientsWire,droppedSeconds:room.metrics.droppedSeconds-droppedStart,
      maxDebtSeconds:room.metrics.maxDebtSeconds,bodyCount:room.sim.world.bodies.length,contacts:room.sim.contacts,
      physicalCounts:summary(room.sim.metrics.physicalCounts),cpu:process.cpuUsage(cpuStart),memory,
      raw:structuredClone({...room.sim.metrics,schedulerMs:room.metrics.schedulerMs,snapshotMs:room.metrics.snapshotMs,encodingMs:room.metrics.encodingMs})};
    const tail=memory.filter(m=>m.elapsedSeconds>actualSeconds-120);
    result.heapGrowthLast120Seconds=tail.length>1?(tail.at(-1).heapUsed/tail[0].heapUsed-1):null;
    result.budget={stepP95:result.stepMs.p95<=6,stepP99:result.stepMs.p99<=8.33,
      wire:clientsWire.every(c=>c.KiBPerSecond<=150),heap:result.heapGrowthLast120Seconds<=.10,
      noDroppedDebt:result.droppedSeconds===0,productionCoverage:false};
    return result;
  }finally{clearInterval(timer);for(const c of clients)await c.leave();await s.close();}
}
const seconds=Number(process.env.BENCH_SECONDS||300),warmup=Number(process.env.WARMUP_SECONDS||15);
if(!Number.isFinite(seconds)||seconds<=0||!Number.isFinite(warmup)||warmup<0)throw new Error('Invalid duration');
await mkdir(outputDir,{recursive:true});
const meta=await metadata();
const result={metadata:meta,baseline:await offline(1,102,30),threePlayers:await offline(3,102,30),
  stress:await offline(3,300,30),allPhysicalStress:await offline(3,102,5,true)};
await writeFile(new URL('simulation-preliminary.json',outputDir),JSON.stringify(result,null,2));
console.log('Accelerated baselines saved; starting real-time benchmark');
result.online=await online(seconds,warmup);
await writeFile(new URL('benchmark.json',outputDir),JSON.stringify(result,null,2));
console.log(JSON.stringify({stepMs:result.online.stepMs,clientsWire:result.online.clientsWire,
  budgets:result.online.budget,coverage:meta.limitations},null,2));
