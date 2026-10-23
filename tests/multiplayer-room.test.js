import test from 'node:test';
import assert from 'node:assert/strict';
import { service,attach,until,sleep,JOIN_OPTIONS,mapReadyMessage } from './helpers/hosted-room.mjs';

test('real map-ready gate, loading timeout, version rejection and atomic last-seat race',{timeout:25000},async()=>{
  const s=await service({roomOptions:{mapReadyMs:1800}});
  try{
    await assert.rejects(s.sdk.create('driving',{...JOIN_OPTIONS,buildId:'old'}),/outdated/);
    const a=await attach(s,await s.sdk.create('driving',{...JOIN_OPTIONS,npcCount:0,tuning:{power:999}}),{autoReady:false}),r=s.room(a.roomId);assert.equal(r.sim.players.size,0);
    assert.equal(r.sim.runtime.roleCount('civilian'),102);
    a.send('input',{roundId:r.roundId,generation:1,seq:1,steer:0,throttle:1,brake:0});await sleep(80);assert.equal(r.sim.players.size,0);
    a.send('map-ready',mapReadyMessage(a.welcome));await until(()=>r.sim.players.size===1);
    const b=await s.join(a.roomId);const race=await Promise.allSettled(Array.from({length:6},()=>s.sdk.joinById(a.roomId,JOIN_OPTIONS)));
    const winners=race.filter(x=>x.status==='fulfilled');assert.equal(winners.length,1);assert.equal(race.filter(x=>x.status==='rejected').length,5);
    const c=await attach(s,winners[0].value);await until(()=>r.sim.players.size===3);assert.equal(new Set(r.sim.players.values()).size,3);
    assert.equal(r.sim.runtime.roleCount('civilian'),102);assert.equal(a.state.signature,b.state.signature);
    await c.leave();await until(()=>r.sim.players.size===2);
    const loader=await s.join(a.roomId,{autoReady:false});await until(()=>!loader.connection.isOpen,3000);await until(()=>!r.pendingMaps.size);
    assert.equal(r.sim.players.size,2);assert.equal(r.metrics.loadingTimeouts,1);
    const bad=await s.join(a.roomId,{autoReady:false});bad.send('map-ready',{...mapReadyMessage(bad.welcome),signature:'forged'});
    await until(()=>!bad.connection.isOpen);assert.equal(r.sim.players.size,2);
    assert.ok(r.metrics.maxQueueBytes<=256*1024);
  }finally{await s.cleanup();}
});

test('authority, applied ack, silence braking, bounded future queue, epochs, durable full state and room isolation',{timeout:25000},async()=>{
  const s=await service();
  try{
    const a=await s.join(),b=await s.join(a.roomId),other=await s.join(),r=s.room(a.roomId),r2=s.room(other.roomId);
    const p=r.sim.players.get(a.sessionId);await until(()=>!p.sim.appearing);assert.notEqual(r.sim.world,r2.sim.world);
    const tickBefore=r2.sim.tick;r2.lastTime=performance.now()-1000;r2.advance();assert.equal(r2.sim.tick-tickBefore,10);assert.ok(r2.metrics.droppedSeconds>.9);
    await until(()=>a.frame?.tick===b.frame?.tick);assert.deepEqual([...a.frame.actors],[...b.frame.actors]);
    const input=seq=>({roundId:r.roundId,generation:p.generation,seq,steer:0,throttle:.7,brake:0});
    a.send('input',input(1));a.send('input',input(2));await until(()=>p.lastSeq===2);assert.ok(p.lastAppliedTick>0);
    a.send('input',input(1));a.send('input',{...input(3),actorId:b.sessionId});a.send('input',{...input(4),wanted:6});
    a.send('input',{...input(4),roundId:r2.roundId});await sleep(60);assert.equal(p.lastSeq,2);
    await sleep(300);assert.deepEqual(p.control,{steer:0,throttle:0,brake:1});
    const from=r.sim.tick+1;a.send('commands',{roundId:r.roundId,generation:p.generation,commands:Array.from({length:24},(_,i)=>[from+i*4,0,1,0,0])});
    await until(()=>p.commands.size>0);assert.ok(p.commands.size<=120);await sleep(380);assert.equal(p.commands.size,0);assert.equal(p.control.brake,1);
    // Operator sets durable world state; only input is accepted from the network.
    r.sim.repairs.placements[0].status='consumed';p.sim.damage=.4;r.sim.props.remove(r.sim.props.entries[0]);
    const late=await s.join(a.roomId);const dto=late.welcome.snapshot;
    assert.equal(dto.gameplay.pickups[0].status,'consumed');assert.equal(dto.players.find(x=>x.id===p.id).damage,.4);
    assert.ok(dto.props.some(x=>x[1]===-1));assert.equal(dto.roundId,r.roundId);assert.notEqual(dto.roundId,other.welcome.roundId);
    assert.equal(r2.sim.repairs.placements[0].status,'available');
    a.send('full');await until(()=>a.full);assert.equal(a.full.gameplay.pickups[0].status,'consumed');
    const gen=p.generation;const req={roundId:r.roundId,generation:gen,requestId:1};a.send('respawn',req);await until(()=>p.generation===gen+1);
    a.send('respawn',req);await sleep(80);assert.equal(p.generation,gen+1);a.send('input',{...input(50),generation:gen});await sleep(60);assert.equal(p.lastSeq,-1);
    p.receivedSeq=2147483000;a.send('input-epoch',{roundId:r.roundId,generation:p.generation});await until(()=>p.generation===gen+2);
    assert.equal(p.receivedSeq,-1);assert.equal(r.sim.repairs.placements[0].status,'consumed');
    const before=r2.sim.tick;for(let i=0;i<150;i++)a.send('unknown',{wanted:6});await until(()=>!a.connection.isOpen);
    await until(()=>r2.sim.tick>before+15);assert.ok(b.connection.isOpen);assert.equal(r2.sim.players.size,1);
  }finally{await s.cleanup();}
});

test('oversized application input, transport overflow and malformed frames cannot stop a healthy peer',{timeout:15000},async()=>{
  const s=await service();
  try{
    const a=await s.join(),b=await s.join(a.roomId),r=s.room(a.roomId),p=r.sim.players.get(a.sessionId);
    const before=r.metrics.invalidInputs;a.send('input',{roundId:r.roundId,generation:p.generation,seq:1,steer:0,throttle:1,brake:0,pad:'x'.repeat(1200)});
    await until(()=>r.metrics.invalidInputs>before);assert.equal(p.receivedSeq,-1);
    a.send('input',{pad:'x'.repeat(6000)});await until(()=>!a.connection.isOpen);await until(()=>!r.sim.players.has(a.sessionId));
    const bad=await s.join(b.roomId),tick=r.sim.tick;bad.connection.transport.ws.send(Buffer.from('0da5696e707574de0001a3736571','hex'));
    await until(()=>!bad.connection.isOpen);await until(()=>r.sim.tick>tick+10);assert.ok(b.connection.isOpen);
  }finally{await s.cleanup();}
});

test('reserved reconnect, explicit leave, expired token, isolated faults and complete empty-room cleanup',{timeout:20000},async()=>{
  const s=await service({roomOptions:{reconnectSeconds:3}});
  try{
    const a=await s.join(),b=await s.join(a.roomId),r=s.room(a.roomId),id=a.sessionId,sim=r.sim.players.get(id).sim,token=a.reconnectionToken;
    const other=await s.join(),r2=s.room(other.roomId);
    await until(()=>!sim.appearing);a.send('respawn',{roundId:r.roundId,generation:1,requestId:1});await until(()=>r.sim.players.get(id).generation===2);
    a.connection.close(4001);await until(()=>r.sim.players.get(id)?.connected===false);
    await assert.rejects(s.sdk.reconnect(other.roomId+':'+token.split(':')[1]));
    const resumed=await attach(s,await s.sdk.reconnect(token));assert.equal(resumed.sessionId,id);assert.equal(r.sim.players.get(id).sim,sim);
    resumed.send('respawn',{roundId:r.roundId,generation:2,requestId:2});await sleep(60);assert.equal(r.sim.players.get(id).generation,2);
    resumed.connection.close(4001);await until(()=>!r.sim.players.has(id));await assert.rejects(s.sdk.reconnect(resumed.reconnectionToken));
    const fresh=await s.join(a.roomId);assert.notEqual(fresh.sessionId,id);assert.equal(r.sim.players.size,2);
    const tick=r2.sim.tick;r.sim.step=()=>{throw Error('operator isolated failure');};
    await until(()=>!s.rooms.has(r));await until(()=>r2.sim.tick>tick+5);assert.equal(r.sim.world.bodies.length,0);
    assert.equal(r.transfers.size,0);assert.equal(r.pendingMaps.size,0);assert.equal(r.buckets.size,0);assert.equal(r.metrics.byClient.size,0);
    assert.equal(r.metrics.bodyCount,0);assert.equal(r.stopScheduler,null);assert.equal(r.stopPatches,null);
    await other.leave();await until(()=>!s.rooms.size);assert.equal(r2.sim.world.bodies.length,0);
  }finally{await s.cleanup();}
});

test('real paused TCP reader is disconnected at the socket budget; another client continues; shutdown warns clients',{timeout:20000},async()=>{
  const s=await service({roomOptions:{reconnectSeconds:.2}});
  try{
    const a=await s.join(),b=await s.join(a.roomId),r=s.room(a.roomId),socket=a.connection.transport.ws._socket;
    assert.ok(socket);socket.pause();const serverPeer=r.clients.find(c=>c.sessionId===a.sessionId),before=r.sim.tick;
    // Actual OS backpressure, not a fake bufferedAmount. Bounded burst accelerates filling loopback receive buffers.
    for(let i=0;i<2000&&serverPeer.ref.readyState===1;i++){serverPeer.sendBytes('probe',new Uint8Array(32768));if(i%8===0)await sleep(1);}
    await until(()=>r.metrics.slowDrops>0);socket.resume();await until(()=>r.sim.tick>before+10);assert.ok(b.connection.isOpen);
    assert.ok(r.metrics.maxQueueBytes<=256*1024);await s.close();await until(()=>Boolean(b.shutdown));assert.equal(b.shutdown.roomLost,true);
  }finally{await s.cleanup();}
});
