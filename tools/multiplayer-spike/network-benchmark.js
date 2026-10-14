import { mkdir,writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { startServer } from './server.js';
import { startProxy } from './tcp-proxy.js';
import { summary } from './protocol.js';

const results=[];
for(const rttMs of [0,50,100,150]) {
  const server=await startServer({npcCount:102});
  const proxy=await startProxy({targetPort:server.port,rttMs,jitterMs:20});
  const client=new Client(`http://127.0.0.1:${proxy.port}`),rooms=[];
  try {
    rooms.push(await client.create('driving',{protocolVersion:1}));
    for(let i=0;i<2;i++)rooms.push(await client.joinById(rooms[0].roomId,{protocolVersion:1}));
    const samples=[],tickSamples=[];
    for(const room of rooms){room.onMessage('full',()=>{});room.onMessage('welcome',()=>{});}
    for(let seq=0;seq<40;seq++) {
      const begin=performance.now();
      for(const room of rooms)room.send('input',{roundId:'round-1',seq,steer:seq%2?.5:-.5,throttle:.4,brake:0});
      while(!rooms.every(r=>r.state.actors?.get(r.sessionId)?.ack===seq)) {
        if(performance.now()-begin>3000)throw new Error('Ack timeout');await sleep(2);
      }
      samples.push(performance.now()-begin);tickSamples.push(rooms.map(r=>r.state.tick));
      await sleep(80);
    }
    results.push({rttMs,jitterMs:20,packetLossPercent:0,metric:'input send -> authoritative applied ack decoded by all 3 SDK clients; not visible rendering',
      latencyMs:summary(samples),rawLatencyMs:samples,tickSamples,proxy:proxy.metrics});
    console.log(JSON.stringify({rttMs,latency:summary(samples)}));
  } finally {for(const r of rooms)await r.leave();await proxy.close();await server.close();}
}
const output=new URL('../../docs/knowledge/multiplayer/',import.meta.url);await mkdir(output,{recursive:true});
await writeFile(new URL('network-latency.json',output),JSON.stringify({date:new Date().toISOString(),results,
  missing:'1% real packet loss/retransmission unavailable: no Linux netem/WinDivert driver configured. Delay-only results cannot close this acceptance scenario.'},null,2));
