import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { startHostedServer } from './server.js';
import { decodeFrame } from '../../../src/multiplayer/frame-codec.js';

const duration=Number(process.env.PROBE_SECONDS || 60),warmup=5;
process.env.CARWARS_FIXED_SEED??='20261005';
const service=await startHostedServer({port:0,host:'127.0.0.1'});
const port=service.server.transport.server.address().port;
const sdk=new Client(`http://127.0.0.1:${port}`),clients=[],gaps=[],ackMs=[];
const sent=new Map(),inside=new Set();let timer,lastPatch,seq=0,measuring=false;
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]??null;};
const join=async id=>{
  const room=id?await sdk.joinById(id,{protocolVersion:1,presentationVersion:5}):await sdk.create('driving',{protocolVersion:1,presentationVersion:5});
  room.onMessage('welcome',()=>{});room.onMessage('gameplay',()=>{});room.onMessage('full',()=>{});room.onMessage('frame',()=>{});clients.push(room);return room;
};
try{
  const first=await join();await join(first.roomId);await join(first.roomId);
  const room=await matchMaker.getLocalRoomById(first.roomId);
  let binary=false;
  const observe=state=>{
    const now=performance.now();if(!measuring)return;
    if(lastPatch!==undefined)gaps.push(now-lastPatch);lastPatch=now;
    const ack=state.actors.get(first.sessionId)?.ack;
    if(sent.has(ack)){ackMs.push(now-sent.get(ack));for(const key of sent.keys())if(key<=ack)sent.delete(key);}
    for(const actor of room.sim.runtime.states.filter(a=>a.role==='civilian')){
      const p=actor.simulation.body.position;
      if(room.sim.plan.buildings.concat(room.sim.plan.boundaryBuildings).some(b=>
        Math.abs(p.x-b.x)<b.width/2-.5&&Math.abs(p.z-b.z)<b.depth/2-.5))inside.add(actor.id);
    }
  };
  first.onStateChange(state=>{if(!binary)observe(state);});
  first.onMessage('frame',bytes=>{binary=true;observe(decodeFrame(bytes));});
  timer=setInterval(()=>{seq++;const now=performance.now();if(measuring)sent.set(seq,now);
    for(const [i,client]of clients.entries())client.send('input',{roundId:'round-1',seq,steer:Math.sin(seq/180+i)*.2,throttle:.35,brake:0});
    if(sent.size>300)sent.delete(sent.keys().next().value);
  },1000/30);
  await sleep(warmup*1000);
  const begin=performance.now(),tick=room.sim.tick,dropped=room.metrics.droppedSeconds,wire=room.metrics.wireBytes;measuring=true;
  await sleep(duration*1000);measuring=false;
  const seconds=(performance.now()-begin)/1000;
  console.log(JSON.stringify({node:process.version,execArgv:process.execArgv,seconds,seed:room.sim.plan.seed,signature:room.sim.signature,players:3,npcCount:room.sim.runtime.roleCount('civilian'),police:room.sim.runtime.roleCount('police'),
    physicsHz:(room.sim.tick-tick)/seconds,patchHz:gaps.length/seconds,patchGapP95:percentile(gaps,.95),patchGapP99:percentile(gaps,.99),
    patchGapMax:Math.max(0,...gaps),ackP95:percentile(ackMs,.95),droppedSeconds:room.metrics.droppedSeconds-dropped,
    outboundKiBPerClient:(room.metrics.wireBytes-wire)/seconds/3/1024,
    npcCentersInsideBuildings:[...inside],physicalNPC:room.sim.runtime.states.filter(a=>a.role==='civilian'&&!a.logical).length}));
}finally{clearInterval(timer);await Promise.allSettled(clients.map(r=>r.leave()));await service.close();}
