// Isolated acceptance harness. Never started by the hosted production entrypoint.
import { readFile,writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { matchMaker } from '@colyseus/core';
import { startHostedServer } from './server.js';
import { RoomClient } from '../../../src/multiplayer/room-client.js';

const role=process.env.PROBE_ROLE??'leader',seconds=Number(process.env.PROBE_SECONDS??45);
const share=process.env.PROBE_SHARE??'/results',endpoint=process.env.PROBE_ENDPOINT??'http://server:2577';
const percentile=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.ceil(b.length*p)-1)]??null;};
async function roomId(){for(let i=0;i<600;i++){try{return JSON.parse(await readFile(`${share}/room.json`,'utf8')).roomId;}catch{await sleep(100);}}throw Error('room timeout');}
if(role==='server'){
  const service=await startHostedServer();let fixture=false,contacts=0,start,tick,dropped;
  const interval=setInterval(async()=>{
    let id;try{id=JSON.parse(await readFile(`${share}/room.json`,'utf8')).roomId;}catch{return;}
    const room=matchMaker.getLocalRoomById(id);if(!room)return;
    if(room.sim.players.size===3 && !fixture){
      fixture=true;start=performance.now();tick=room.sim.tick;dropped=room.metrics.droppedSeconds;
      [...room.sim.players.values()].forEach((a,i)=>{
        a.sim.spawn={x:i===2?8:0,y:1,z:i===0?-10:i===1?10:0,yaw:i===1?Math.PI:i===2?-Math.PI/2:0};
        a.sim.reset();a.sim.body.velocity.set(i===2?-6:0,0,i===0?8:i===1?-8:0);a.generation++;room.sim.halt(a.id);
      });
    }
    const players=[...room.sim.players.values()];
    if(room.sim.world.contacts.some(c=>players.some(a=>a.sim.body===c.bi)&&players.some(a=>a.sim.body===c.bj)))contacts++;
    if(start&&performance.now()-start>(seconds-3)*1000){
      clearInterval(interval);const elapsed=(performance.now()-start)/1000;
      const result={role,elapsed,physicsHz:(room.sim.tick-tick)/elapsed,droppedSeconds:room.metrics.droppedSeconds-dropped,
        contacts,npc:room.sim.npcs.length,players:room.sim.players.size,schedulerP95:percentile(room.metrics.schedulerMs,.95)};
      await writeFile(`${share}/server.json`,JSON.stringify(result));console.log(JSON.stringify(result));
    }
  },20);
  setTimeout(async()=>{clearInterval(interval);await service.close();process.exit(0);},(seconds+30)*1000);
}else{
  let client,timer;
  const errors=[],intervals=[],corrections=[],states=[];let last,first,previousCorrections=0;
  client=new RoomClient({endpoint,onStatus:text=>errors.push(text),onWelcome:data=>client.startPrediction(data.map.colliders)});
  try{
    for(let i=0;i<300;i++){
      try{if((await fetch(`${endpoint}/health`)).ok)break;}catch{}
      if(i===299)throw Error('server readiness timeout');await sleep(100);
    }
    const room=await client.connect(role==='leader'?undefined:await roomId());
    if(role==='leader')await writeFile(`${share}/room.json`,JSON.stringify({roomId:room.roomId}));
    first=last=performance.now();
    timer=setInterval(()=>{
      const now=performance.now(),elapsed=now-first;intervals.push(now-last);last=now;
      if(!client.prediction)return;
      client.prediction.advance(now,{steer:elapsed<3000?0:Math.sin(elapsed/1300)*.35,throttle:elapsed<3000?.6:.25,brake:0});
      client.prediction.sample(now);
      if(client.prediction.metrics.corrections!==previousCorrections){previousCorrections=client.prediction.metrics.corrections;corrections.push(client.prediction.metrics.lastCorrection);}
      if(states.length<2&&elapsed>1000)states.push(client.prediction.world.tick);
    },1000/60);
    await sleep(seconds*1000);clearInterval(timer);
    const result={role,elapsed:(performance.now()-first)/1000,rtt:client.rtt,frameP95:percentile(intervals,.95),frameP99:percentile(intervals,.99),
      correctionP95:percentile(corrections,.95),prediction:client.prediction?.metrics,physical:client.prediction?.world.actors.size,
      players:client.latestFrame?[...client.latestFrame.actors.values()].filter(a=>a.role==='player').length:0,errors};
    await writeFile(`${share}/${role}.json`,JSON.stringify(result));console.log(JSON.stringify(result));
    if(result.players!==3||!result.prediction?.steps)process.exitCode=1;
    // All three collect while everyone is still connected, regardless of join order.
    await sleep(5000);
  }finally{clearInterval(timer);await client.leave();}
}
