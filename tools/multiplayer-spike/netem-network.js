import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import { summary } from './protocol.js';

const cache = join(process.env.LOCALAPPDATA, 'carwars-netem');
const output = new URL('../../docs/knowledge/multiplayer/2026-10-16/', import.meta.url);
const samplesPerProfile = Number(process.env.NETEM_SAMPLES || 40);
if(!Number.isInteger(samplesPerProfile) || samplesPerProfile < 10 || samplesPerProfile > 1000) throw Error('Invalid sample count');
const results = [];
async function readStats() {
  const raw = await readFile(join(cache,'netem-stats.txt'),'utf8');
  const matches = raw.match(/\[\{[^\r\n]+\}\]/g);
  const qdisc = matches?.map(s=>{try{return JSON.parse(s);}catch{return null;}}).filter(Boolean).at(-1);
  const tcpLines = raw.split(/[\r\n]+/).filter(l=>/^Tcp:/.test(l));
  const headers = tcpLines.find(l=>l.includes('RetransSegs'))?.trim().split(/\s+/).slice(1);
  const data = tcpLines.find(l=>/^Tcp:\s+\d/.test(l))?.trim().split(/\s+/).slice(1).map(Number);
  if(!qdisc || !headers || !data) throw Error('Missing actual tc/TCP counters: '+raw.slice(-1000));
  return {qdisc,tcp:Object.fromEntries(headers.map((k,i)=>[k,data[i]])),capturedAt:new Date().toISOString()};
}
for(const rttMs of [0,50,100,150]) {
  const profile = {id:randomUUID(),rttMs,jitterMs:20,lossPercent:1};
  await writeFile(join(cache,'netem-control.json'), JSON.stringify(profile));
  const waitStart = performance.now();
  while(true) {
    try{const applied=JSON.parse(await readFile(join(cache,'netem-applied.json'),'utf8'));if(applied.id===profile.id)break;}catch{}
    if(performance.now()-waitStart>10000)throw Error('VM did not acknowledge profile; run netem-vm.py first');
    await sleep(100);
  }
  await sleep(1500);const before=await readStats();
  const configured=before.qdisc.find(q=>q.kind==='netem');
  if(!configured || Math.abs((configured.options?.['loss-random']?.loss ?? -1)-.01)>.0001)
    throw Error('Actual kernel qdisc does not have 1% random packet loss');
  if(Math.abs((configured.options?.delay?.delay ?? 0)-rttMs/2000)>.001)
    throw Error('Stale kernel qdisc delay stats; retry after next telemetry update');
  const sdk=new Client('http://127.0.0.1:2581'), rooms=[];
  const samples=[],ticks=[];
  try {
    rooms.push(await sdk.create('driving',{protocolVersion:1}));
    for(let i=0;i<2;i++)rooms.push(await sdk.joinById(rooms[0].roomId,{protocolVersion:1}));
    for(const room of rooms){room.onMessage('welcome',()=>{});room.onMessage('full',()=>{});}
    for(let seq=0;seq<samplesPerProfile;seq++) {
      const start=performance.now();
      for(const room of rooms)room.send('input',{roundId:'round-1',seq,steer:seq%2?.5:-.5,throttle:.4,brake:0});
      while(!rooms.every(r=>r.state.actors?.get(r.sessionId)?.ack===seq)) {
        if(performance.now()-start>10000)throw Error('Applied ack timeout on packet-loss path');
        await sleep(2);
      }
      samples.push(performance.now()-start);ticks.push(rooms.map(r=>r.state.tick));
      await sleep(80);
    }
  } finally {for(const room of rooms)await room.leave();}
  // Stats are emitted every 10s by the VM console, not estimated from SDK traffic.
  await sleep(10500);const after=await readStats();
  results.push({profile,metric:'input -> applied ack decoded by all three real SDK sessions',
    latencyMs:summary(samples),rawLatencyMs:samples,ticks,before,after,
    tcpRetransmittedSegments:after.tcp.RetransSegs-before.tcp.RetransSegs});
  console.log(JSON.stringify({profile,latencyMs:summary(samples),tcpRetransmittedSegments:results.at(-1).tcpRetransmittedSegments}));
  await mkdir(output,{recursive:true});
  await writeFile(new URL('netem-network.json',output),JSON.stringify({date:new Date().toISOString(),node:process.version,
    topology:'Windows SDK -> QEMU SLIRP hostfwd -> Alpine Linux kernel TCP/socat -> QEMU SLIRP -> Windows Colyseus; netem on guest eth0 egress',
    note:'1% configured IP packet loss on Linux qdisc; both proxy TCP legs affected. No JS application messages discarded. Delay/jitter configured per guest egress; measured round trip also includes software-emulator scheduling and TCP recovery.',
    results},null,2));
}
if(!results.some(r=>r.tcpRetransmittedSegments>0))throw Error('No TCP retransmission observed; cannot claim loss validation');
