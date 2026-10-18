import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { matchMaker } from '@colyseus/core';
import { startHostedServer } from '../deploy/server.js';
import { RoomClient } from '../../../src/multiplayer/room-client.js';

test('three SDK clients share dents and destroyed props through late join, respawn and reconnect',async()=>{
  const service=await startHostedServer({port:0,host:'127.0.0.1'}),port=service.server.transport.server.address().port,clients=[];
  const until=async condition=>{const end=Date.now()+7000;while(!condition()){if(Date.now()>end)throw Error('Destruction SDK timeout');await sleep(20);}};
  let timer,roomId;
  const join=async()=>{
    let c;c=new RoomClient({endpoint:`http://127.0.0.1:${port}`,onWelcome:data=>c.startPrediction(data.map.colliders)});
    clients.push(c);const r=await c.connect(roomId);roomId=r.roomId;await until(()=>c.prediction?.latest);return c;
  };
  try{
    await join();await join();
    timer=setInterval(()=>{for(const c of clients)c.prediction?.advance(performance.now(),{steer:0,throttle:0,brake:0});},1000/60);
    const room=matchMaker.getLocalRoomById(roomId),players=[...room.sim.players.values()];
    players.forEach((p,i)=>{
      p.sim.spawn={x:0,y:1,z:i?5:-5,yaw:i?Math.PI:0};p.sim.reset();p.generation++;
      p.sim.body.velocity.set(0,0,i?-15:15);room.sim.halt(p.id);
    });
    await until(()=>players.every(p=>p.dents.length>0));
    const bin=room.sim.props.entries.find(p=>p.type==='bin');
    const player=players[0],fx=Math.sin(bin.yaw),fz=Math.cos(bin.yaw);
    player.sim.spawn={x:bin.x-fx*2.5,y:bin.y+.65,z:bin.z-fz*2.5,yaw:bin.yaw};
    player.sim.reset();player.generation++;player.sim.body.velocity.set(fx*20,0,fz*20);room.sim.halt(player.id);
    await until(()=>bin.state==='detached');
    await until(()=>clients.every(c=>c.latestFrame?.props.some(s=>s[0]===room.sim.props.entries.indexOf(bin))));
    const third=await join(),thirdJoinedAt=Date.now(),damagedId=players[1].id;
    await until(()=>third.latestFrame?.actors.get(damagedId)?.dents.length>0);
    assert.ok(third.prediction.world.props.entries.some(e=>e.id===bin.id&&e.state!=='intact'));
    await until(()=>bin.state==='removed');
    const index=room.sim.props.entries.indexOf(bin);
    await until(()=>clients.every(c=>c.latestFrame?.props.some(s=>s[0]===index&&s[1]===-1)));
    const oldGeneration=players[1].generation;clients[1].respawn();
    await until(()=>clients.every(c=>c.latestFrame?.actors.get(damagedId)?.generation===oldGeneration+1));
    assert.ok(clients.every(c=>c.latestFrame.actors.get(damagedId).dents.length===0));
    await sleep(Math.max(0,5500-(Date.now()-thirdJoinedAt)));
    const sessionId=third.room.sessionId;room.clients.find(c=>c.sessionId===sessionId).ref.terminate();
    await until(()=>!room.sim.players.get(sessionId).connected);
    await until(()=>room.sim.players.get(sessionId).connected&&third.prediction?.latest);
    assert.equal(third.room.sessionId,sessionId);
    await until(()=>third.prediction.world.props.entries[index].state==='removed');
    assert.equal(clients.length,3);
    console.log(JSON.stringify({threeClients:true,lateJoin:true,reconnect:true,respawn:true,prop:index,removed:true}));
  }finally{clearInterval(timer);for(const c of clients)await c.leave();await service.close();}
});
