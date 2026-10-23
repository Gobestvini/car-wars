import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { SpikeWorld } from '../../../tools/multiplayer-spike/world.js';
import { RoomClient } from '../../../src/multiplayer/room-client.js';
import { startHostedServer } from '../../../tools/multiplayer-spike/deploy/server.js';
const require=createRequire(new URL('../../../tools/multiplayer-spike/package.json',import.meta.url));
const {matchMaker}=require('@colyseus/core');
const results=[];
const place=(a,p,dx=0)=>{a.sim.body.position.set(p.x+dx,.96,p.z);a.sim.body.velocity.setZero();a.sim.body.angularVelocity.setZero();a.sim.body.quaternion.setFromEuler(0,0,0);a.sim.body.aabbNeedsUpdate=true;};
const until=async check=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('timeout');await sleep(10);}};
for(const mode of ['detached-only','npc-excluded','different-ticks','swept-crossing']){
  const w=new SpikeWorld({seed:42,npcCount:mode==='npc-excluded'?1:0});
  try{
    const p=w.repairs.placements[0],a=w.addPlayer('z'),b=w.addPlayer('a');
    if(mode==='detached-only'){
      place(a,p);a.sim.syncWheelPositions();a.sim.detachWheelAtImpact({speed:25,point:a.sim.wheels[0].mount,normal:{x:1,y:0,z:0}});a.sim.damage=0;
      assert.ok(a.sim.wheels.some(x=>x.detached));w.step();assert.equal(a.repairRevision,1);assert.ok(a.sim.wheels.every(x=>!x.detached));
    }else if(mode==='npc-excluded'){
      place(w.npcs[0],p);w.npcs[0].sim.damage=.5;w.step();assert.equal(p.status,'available');
    }else if(mode==='different-ticks'){
      place(a,p);a.sim.damage=.5;b.sim.damage=.5;w.step();place(b,p);w.step();assert.equal(a.repairRevision,1);assert.equal(b.repairRevision,0);assert.equal(b.sim.damage,.5);
    }else{
      place(a,p,-3);a.sim.damage=.5;a.sim.body.collisionFilterMask=0;a.sim.body.velocity.set(720,0,0);w.step();
      assert.ok(a.sim.body.position.x>p.x+2);assert.equal(p.status,'consumed');assert.equal(a.sim.damage,0);
    }
    results.push({mode,passed:true});
  }finally{w.dispose();}
}
const service=await startHostedServer({port:0,host:'127.0.0.1'}),port=service.server.transport.server.address().port;
const client=new RoomClient({endpoint:`http://127.0.0.1:${port}`});
try{
  let room=await client.connect();await until(()=>client.gameplay);const id=room.roomId,host=matchMaker.getLocalRoomById(id),w=host.sim;
  await sleep(150); // First dirty patch for the just-joined player may follow welcome.
  let messages=0;room.onMessage('gameplay',()=>messages++);await sleep(250);assert.equal(messages,0);
  const a=w.players.get(room.sessionId),p=w.repairs.placements[0];place(a,p);a.sim.damage=.5;
  await until(()=>client.gameplay.pickups[0].status==='consumed');const changed=messages;assert.equal(changed,1);await sleep(250);assert.equal(messages,changed);
  // Keep one session so explicit leave/rejoin returns to the same existing world.
  const holder=new RoomClient({endpoint:`http://127.0.0.1:${port}`});
  try{await holder.connect(id);await client.leave();await client.connect(id);await until(()=>client.gameplay);assert.equal(client.gameplay.pickups[0].status,'consumed');results.push({mode:'dirty-reliable-state-and-explicit-leave-rejoin',passed:true});}
  finally{await holder.leave();}
}finally{await client.leave();await service.close();}
fs.writeFileSync(new URL('extra-report.json',import.meta.url),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
