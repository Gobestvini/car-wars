import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const base = pathToFileURL(process.cwd() + '/');
const { DrivingSpikeRoom, startServer } = await import(new URL('tools/multiplayer-spike/server.js', base));
const { summary } = await import(new URL('tools/multiplayer-spike/protocol.js', base));
const schedulerHz = 120, patchHz = Number(process.env.SPIKE_PATCH_HZ || 30);
if (![30,60].includes(patchHz)) throw Error('Probe supports patch30 or60 only');
const sourceHashes = {};
for (const path of ['tools/multiplayer-spike/server.js','tools/multiplayer-spike/world.js','tools/multiplayer-spike/state.js']) {
 sourceHashes[path] = createHash('sha256').update(await readFile(new URL(path,base))).digest('hex');
}
const samples=[], rooms=[];
const original=DrivingSpikeRoom.prototype.onCreate;
DrivingSpikeRoom.prototype.onCreate=function(options) {
 original.call(this,options);
 this.patchRate=1000/patchHz;
 this.setSimulationInterval(()=>this.advance(),1000/schedulerHz);
 rooms.push(this);
};
const server=await startServer({port:2577,browser:true,npcCount:102});
console.log('CADENCE_PROBE',JSON.stringify({schedulerHz,patchHz,node:process.version,sourceHashes}));
const start=performance.now();
const timer=setInterval(()=>{
 for(const room of rooms)if(room.clients.length) {
 const row={seconds:(performance.now()-start)/1000,tick:room.sim.tick,
 schedulerCount:room.metrics.schedulerMs.length,patchCount:room.metrics.encodingMs.length,
 stepMs:summary(room.sim.metrics.stepMs),encodingMs:summary(room.metrics.encodingMs),wireBytes:room.metrics.wireBytes};
 samples.push(row);console.log(JSON.stringify(row));
 }
},5000);
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;
 clearInterval(timer);
 await writeFile(new URL('docs/knowledge/multiplayer/2026-10-16/cadence-probe-server-'+patchHz+'.json',base),
 JSON.stringify({date:new Date().toISOString(),node:process.version,schedulerHz,patchHz,sourceHashes,samples,
 note:'Process-local Room.onCreate override, same SpikeWorld and input/state. Short experiment, not five-minute acceptance. No default server source edits.'},null,2));
 await server.close();process.exit(0);
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
process.stdin.setEncoding('utf8');process.stdin.on('data',text=>{if(text.includes('quit'))void shutdown();});
setTimeout(shutdown,120000).unref();
