import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { matchMaker } from '@colyseus/core';
import { startHostedServer } from '../deploy/server.js';
import { RoomClient } from '../../../src/multiplayer/room-client.js';

test('three actual SDK prediction clients collide, respawn independently and recover after reconnect',async()=>{
  const service=await startHostedServer({port:0,host:'127.0.0.1'}),port=service.server.transport.server.address().port;
  const clients=[],errors=[];let interval;
  const until=async condition=>{const end=Date.now()+6000;while(!condition()){if(Date.now()>end)throw Error('Prediction SDK timeout');await sleep(20);}};
  let playerContacts=0,localContacts=0;
  try{
    let id;
    for(let i=0;i<3;i++){
      let client;client=new RoomClient({endpoint:`http://127.0.0.1:${port}`,onStatus:text=>errors.push(text),
        onWelcome:data=>client.startPrediction(data.map.colliders)});
      clients.push(client);const room=await client.connect(id);id=room.roomId;
    }
    await until(()=>clients.every(c=>c.latestFrame?.actors.size===105));
    const room=matchMaker.getLocalRoomById(id),players=clients.map(c=>room.sim.players.get(c.room.sessionId));
    // Test-only fixture through the in-process room, never a public pose command.
    players.forEach((a,i)=>{
      a.sim.spawn={x:i===2?8:0,y:1,z:i===0?-10:i===1?10:0,yaw:i===1?Math.PI:i===2?-Math.PI/2:0};
      a.sim.reset();a.sim.body.velocity.set(i===2?-6:0,0,i===0?8:i===1?-8:0);a.generation++;room.sim.halt(a.id);
    });
    const begin=performance.now(),frameMs=[],corrections=[];
    let last=begin;
    interval=setInterval(()=>{
      const now=performance.now(),elapsed=now-begin;frameMs.push(now-last);last=now;
      for(const client of clients){
        if(!client.prediction)continue;
        const steer=elapsed>2500&&elapsed<3500?.6:elapsed>3500&&elapsed<4500?-.6:0;
        client.prediction.advance(now,{steer,throttle:elapsed<2300?1:0,brake:elapsed<2300?0:.4});
        client.prediction.sample(now);
        const actors=[...client.prediction.world.actors.values()].filter(a=>a.source.role==='player');
        if(client.prediction.world.world.contacts.some(c=>actors.some(a=>a.sim.body===c.bi)&&actors.some(a=>a.sim.body===c.bj)))localContacts++;
      }
      if(room.sim.world.contacts.some(c=>players.some(a=>a.sim.body===c.bi)&&players.some(a=>a.sim.body===c.bj)))playerContacts++;
    },1000/60);
    await sleep(5500);
    assert.ok(playerContacts>0);assert.ok(localContacts>0,'client prediction must resolve player contacts');
    for(const client of clients){corrections.push({...client.prediction.metrics});assert.ok(client.prediction.world.actors.size>=3);}
    console.log(JSON.stringify({phase:'driving',elapsed:performance.now()-begin,playerContacts,localContacts,corrections}));
    assert.ok(clients.every(c=>c.prediction.metrics.steps>400),'clients must sustain the fixed physics timeline');
    const oldGeneration=players[0].generation;clients[0].respawn();
    await until(()=>clients.every(c=>c.prediction.latest.actors.get(players[0].id)?.generation===oldGeneration+1));
    assert.equal(players[1].generation,2);assert.equal(players[2].generation,2);
    assert.equal(clients[0].prediction.world.actors.get(players[0].id).source.generation,oldGeneration+1);
    const reconnectClient=clients[2],sessionId=reconnectClient.room.sessionId;
    room.clients.find(c=>c.sessionId===sessionId).ref.terminate();
    await until(()=>!players[2].connected);assert.equal(players[2].commands.size,0);
    await until(()=>players[2].connected&&reconnectClient.prediction?.latest);
    assert.equal(reconnectClient.room.sessionId,sessionId);
    assert.equal(reconnectClient.prediction.localId,sessionId);
    console.log(JSON.stringify({playerContacts,localContacts,frameP95:frameMs.sort((a,b)=>a-b)[Math.floor(frameMs.length*.95)],corrections,
      reconnect:true,independentRespawn:true,statusMessages:errors}));
  }finally{clearInterval(interval);for(const client of clients)await client.leave();await service.close();}
});
