import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { matchMaker } from '@colyseus/core';
import { startHostedServer } from '../deploy/server.js';
import { RoomClient } from '../../../src/multiplayer/room-client.js';

async function until(check){const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw Error('Shared repair timeout');await sleep(15);}}

test('real SDK clients share server repair, reject forged repair, and recover state on late join/reconnect',{timeout:20000},async()=>{
  const service=await startHostedServer({port:0,host:'127.0.0.1'}),port=service.server.transport.server.address().port;
  const clients=Array.from({length:3},()=>new RoomClient({endpoint:`http://127.0.0.1:${port}`}));
  try{
    const first=await clients[0].connect();await until(()=>clients[0].gameplay);
    const room=matchMaker.getLocalRoomById(first.roomId),world=room.sim,actor=world.players.get(first.sessionId);
    actor.sim.damage=.5;first.send('repair',{playerId:first.sessionId,pickupId:0});await sleep(100);
    assert.equal(actor.sim.damage,.5);assert.ok(room.metrics.invalidInputs>0);
    const pickup=world.repairs.placements[0];
    actor.sim.body.position.set(pickup.x,.96,pickup.z);actor.sim.body.velocity.setZero();actor.sim.body.aabbNeedsUpdate=true;
    await until(()=>clients[0].gameplay.pickups[0].status==='consumed');
    assert.equal(actor.sim.damage,0);assert.equal(actor.repairRevision,1);
    await clients[1].connect(first.roomId);await clients[2].connect(first.roomId);
    await until(()=>clients.every(c=>c.gameplay?.players.length===3));
    assert.ok(clients.every(c=>c.gameplay.pickups[0].status==='consumed'));
    assert.ok(clients.every(c=>c.gameplay.players.find(p=>p.id===first.sessionId).repairRevision===1));
    await until(()=>clients[0].latestFrame?.actors.get(first.sessionId)?.damage===0);
    await sleep(5100); // SDK intentionally disables auto-reconnect in a room's first five seconds.
    const reconnected=new Promise(resolve=>first.onReconnect(resolve));room.clients.find(c=>c.sessionId===first.sessionId).ref.terminate();
    await reconnected;await until(()=>world.players.get(first.sessionId)?.connected);
    await until(()=>clients[0].gameplay?.pickups[0].status==='consumed');
    clients[0].respawn();await until(()=>actor.generation===2);
    assert.equal(pickup.status,'consumed');assert.equal(world.players.size,3);
  }finally{await Promise.all(clients.map(c=>c.leave()));await service.close();}
});
