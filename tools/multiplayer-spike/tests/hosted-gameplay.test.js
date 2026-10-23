import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { matchMaker } from '@colyseus/core';
import { startHostedServer } from '../deploy/server.js';
import { RoomClient } from '../../../src/multiplayer/room-client.js';
async function until(check){const end=Date.now()+15000;while(!check()){if(Date.now()>end)throw Error('Gameplay SDK timeout');await sleep(20);}}
test('hosted production core replicates personal wanted/arrest, role-safe police and independent respawn',{timeout:30000},async()=>{
  const service=await startHostedServer({port:0,host:'127.0.0.1'}),port=service.server.transport.server.address().port;
  const clients=Array.from({length:3},()=>new RoomClient({endpoint:`http://127.0.0.1:${port}`}));
  try{
    const first=await clients[0].connect(),second=await clients[1].connect(first.roomId);
    const room=matchMaker.getLocalRoomById(first.roomId),world=room.sim,a=world.players.get(first.sessionId),b=world.players.get(second.sessionId);
    await until(()=>!a.sim.appearing&&!b.sim.appearing);
    // These are private operator fixtures; none of these commands exist on the public wire.
    a.wanted.update(.51,[{type:'property-collision'}]);b.wanted.update(.51,[{type:'property-collision'}]);
    await until(()=>clients.slice(0,2).every(c=>c.gameplay?.players.every(p=>p.wanted.level===1)));
    first.send('wanted',{playerId:second.sessionId,level:6});first.send('arrest',{playerId:second.sessionId});await sleep(80);
    assert.equal(b.wanted.snapshot().level,1);assert.equal(b.arrest.snapshot().state,'idle');
    await until(()=>world.runtime.states.some(u=>u.role==='police'&&u.ai.targetId===a.id));
    a.sim.body.position.set(0,.96,0);a.sim.body.quaternion.setFromEuler(0,0,0);a.sim.body.velocity.setZero();a.sim.body.angularVelocity.setZero();
    const unit=world.runtime.states.find(u=>u.role==='police'&&u.ai.targetId===a.id);
    unit.simulation.body.position.set(0,.96,-5);unit.simulation.body.velocity.setZero();unit.simulation.body.angularVelocity.setZero();
    unit.simulation.body.aabbNeedsUpdate=true;
    world.runtime.registerRole('police',{maxCount:6,physicalOnly:true,update:()=>({state:'holding',control:{steer:0,throttle:0,brake:1}})});
    await until(()=>a.arrest.snapshot().state==='arrested');
    await until(()=>clients[0].gameplay?.players.find(p=>p.id===a.id).arrest.state==='arrested');
    await clients[2].connect(first.roomId);
    await until(()=>clients[2].gameplay?.players.find(p=>p.id===a.id)?.arrest.state==='arrested');
    assert.equal(b.arrest.snapshot().state,'idle');
    assert.ok(!clients[2].events.some(e=>e.type==='arrested'&&e.playerId===a.id),'late join seeds event history without replay');
    const generations=[a.generation,b.generation],signature=world.signature;
    clients[0].respawn();await until(()=>a.generation===generations[0]+1);
    await until(()=>clients.every(c=>c.gameplay?.players.find(p=>p.id===a.id).wanted.level===0));
    assert.equal(a.arrest.snapshot().state,'idle');assert.equal(b.wanted.snapshot().level,1);
    assert.equal(b.generation,generations[1]);assert.equal(world.signature,signature);
    assert.equal(world.runtime.roleCount('civilian'),102);assert.equal(world.players.size,3);
  }finally{await Promise.all(clients.map(c=>c.leave()));await service.close();}
});
