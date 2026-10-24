import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomClient,neutralInput} from '../src/multiplayer/room-client.js';
import {localHud,playerLabel} from '../src/multiplayer/hud.js';
import {hostedRoomType} from '../tools/multiplayer-spike/hosted-room.js';
import {service,until,sleep} from './helpers/hosted-room.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test('cancel before SDK admission rejects promptly and closes a late room without presentation',async()=>{
  const pending=deferred();let left=0,welcome=0;
  const client=new RoomClient({sdk:{create:()=>pending.promise},onWelcome:()=>welcome++});
  const result=client.connect();await sleep(0);assert.equal(client.phase,'connecting');
  await client.leave();await assert.rejects(result,{name:'AbortError'});
  pending.resolve({reconnection:{enabled:true},connection:{isOpen:true},leave:async()=>left++});await sleep(10);
  assert.equal(left,1);assert.equal(welcome,0);assert.equal(client.room,null);assert.equal(client.phase,'idle');
  assert.equal(client.timer,null);assert.equal(client.pingTimer,null);
});

test('cancel map loading suppresses stale map-ready; retry has one session and neutral leave',{timeout:12000},async()=>{
  const server=await service(),gate=deferred();let entered=false,leaves=0;
  const client=new RoomClient({endpoint:server.endpoint,onWelcome:async()=>{entered=true;await gate.promise;},onLeave:()=>leaves++});
  try{
    const first=client.connect();const rejected=assert.rejects(first,{name:'AbortError'});await until(()=>entered);const old=client.room,room=server.room(old.roomId);
    assert.equal(client.phase,'map-loading');assert.equal(room.sim.players.size,0);
    await client.leave();await rejected;gate.resolve();await sleep(60);
    assert.equal(room.sim.players.size,0);assert.equal(old.connection.isOpen,false);assert.equal(client.gameplay,null);
    client.onWelcome=()=>{};await client.connect();assert.equal(client.phase,'playing');assert.equal(client.active,true);
    const current=client.room,r=server.room(current.roomId),p=r.sim.players.get(current.sessionId);await until(()=>!p.sim.appearing);
    client.input={steer:0,throttle:1,brake:0};client.sendInput();await until(()=>p.control.throttle===1);
    client.stop();await until(()=>p.control.brake===1);assert.deepEqual(client.input,neutralInput());
    await client.leave();assert.equal(client.timer,null);assert.equal(client.pingTimer,null);assert.equal(client.removeListeners,null);
    assert.equal(client.prediction,null);assert.equal(client.gameplay,null);assert.deepEqual(client.events,[]);assert.equal(leaves,2);
  }finally{gate.resolve();await client.leave();await server.cleanup();}
});

test('overlapping connection attempts never replace a newer connection',async()=>{
  const a=deferred(),b=deferred();let n=0,closed=0;
  const c=new RoomClient({sdk:{create:()=>++n===1?a.promise:b.promise}});
  const first=c.connect();await sleep(0);const second=c.connect();await assert.rejects(first,{name:'AbortError'});await sleep(0);
  a.resolve({reconnection:{enabled:true},connection:{isOpen:true},leave:async()=>closed++});await sleep(0);assert.equal(closed,1);
  await c.leave();await assert.rejects(second,{name:'AbortError'});b.reject(Error('late network failure'));await sleep(0);assert.equal(c.phase,'idle');
});

test('full/version/offline phases keep retry possible',async()=>{
  for(const [message,phase]of [['room full','full'],['protocol version outdated','version-error'],['fetch failed','offline-error']]){
    const c=new RoomClient({sdk:{create:async()=>{throw Error(message);}}});
    await assert.rejects(c.connect());assert.equal(c.phase,phase);assert.equal(c.room,null);assert.equal(c.timer,null);
  }
});

test('local wanted/arrest HUD and bounded event history never borrow another player state',()=>{
  const c=new RoomClient({sdk:{}});c.roundId='round';
  const players=[{id:'a',repairRevision:0,wanted:{level:3,pendingStar:4},arrest:{state:'arresting',progress:.5,remainingSeconds:2.5}},
    {id:'b',repairRevision:1,wanted:{level:0},arrest:{state:'idle'}}];
  const dto={roundId:'round',revision:1,tick:100,pickups:[],players,events:[{id:'old'}]};c.acceptGameplay(dto,true);
  assert.deepEqual(c.events,[]);c.acceptGameplay({...dto,revision:2,events:[{id:'old'},{id:'new'}]});assert.deepEqual(c.events,[{id:'new'}]);
  assert.equal(localHud(c.gameplay,'a').level,3);assert.equal(localHud(c.gameplay,'a').progress,.5);assert.equal(localHud(c.gameplay,'b').state,'idle');
  c.acceptGameplay({...dto,roundId:'other',revision:99});assert.equal(c.gameplay.revision,2);
  assert.equal(localHud(null,'a').level,0);assert.equal(localHud(null,'a').state,'idle');
});

test('cancel reconnect retires a scheduled SDK retry and a connecting socket',{timeout:12000},async()=>{
  const server=await service(),client=new RoomClient({endpoint:server.endpoint});
  try{
    await client.connect();const old=client.room,room=server.room(old.roomId);
    old.reconnection.minUptime=0;old.reconnection.minDelay=1000;old.reconnection.maxDelay=1000;
    room.clients.find(p=>p.sessionId===old.sessionId).ref.terminate();await until(()=>client.phase==='reconnecting');
    await client.leave();await sleep(1400);
    assert.equal(old.connection.isOpen,false);assert.equal(old.reconnection.isReconnecting,false);assert.equal(client.phase,'idle');assert.equal(client.room,null);
    await client.connect(old.roomId);assert.equal(client.phase,'playing');assert.notEqual(client.room.sessionId,old.sessionId);
    await client.leave();
    let closed=0,retries=0;
    const connecting={reconnection:{enabled:true,enqueuedMessages:[1]},connection:{isOpen:false,close:()=>closed++,reconnect:()=>retries++},removeAllListeners:()=>{}};
    client.room=connecting;await client.leave();connecting.connection.reconnect();
    assert.equal(closed,1);assert.equal(retries,0);assert.deepEqual(connecting.reconnection.enqueuedMessages,[]);
  }finally{await client.leave();await server.cleanup();}
});

test('old snapshot failure cannot overwrite the phase or status of a fresh room',{timeout:15000},async()=>{
  const server=await service(),statuses=[],client=new RoomClient({endpoint:server.endpoint,onStatus:text=>statuses.push(text)});
  let socket;
  try{
    await client.connect();const old=client.room,room=server.room(old.roomId),peer=room.clients.find(p=>p.sessionId===old.sessionId);
    socket=peer.ref._socket;socket.pause(); // Delay acknowledgement of old leave, not client state delivery.
    peer.send('transfer-start',{id:999,kind:'welcome',bytes:0});await until(()=>client.room===null);
    await client.connect();const fresh=client.room;assert.equal(client.phase,'playing');const before=statuses.length;
    socket.resume();await until(()=>!old.connection.isOpen);await sleep(100);
    assert.equal(client.room,fresh);assert.equal(client.phase,'playing');assert.equal(client.active,true);assert.equal(statuses.length,before);
  }finally{socket?.resume();await client.leave();await server.cleanup();}
});

test('an older async welcome cannot activate an obsolete map nonce after another drop',{timeout:20000},async()=>{
  const server=await service(),client=new RoomClient({endpoint:server.endpoint}),gate=deferred();
  try{
    await client.connect();const peer=client.room,room=server.room(peer.roomId);
    peer.reconnection.minUptime=0;peer.reconnection.minDelay=peer.reconnection.maxDelay=100;
    let welcomes=0,blocked=false;client.onWelcome=async()=>{if(++welcomes===1){blocked=true;await gate.promise;}};
    room.clients.find(p=>p.sessionId===peer.sessionId).ref.terminate();await until(()=>blocked);
    room.clients.find(p=>p.sessionId===peer.sessionId).ref.terminate();await until(()=>welcomes===2&&client.phase==='playing');
    gate.resolve();await sleep(180);
    assert.equal(client.room,peer);assert.equal(client.active,true);assert.equal(client.phase,'playing');assert.equal(peer.connection.isOpen,true);
    assert.equal(room.sim.players.get(peer.sessionId).connected,true);
  }finally{gate.resolve();await client.leave();await server.cleanup();}
});

test('three players keep distinct labels/backgrounds after a friend leaves and a fresh one joins',()=>{
  const local=playerLabel('a','a'),first=playerLabel('b','a',[local.number]),second=playerLabel('c','a',[local.number,first.number]);
  const replacement=playerLabel('new-b','a',[local.number,second.number]);
  assert.equal(local.text,'Вы');assert.equal(replacement.number,first.number);
  assert.equal(new Set([local.text,second.text,replacement.text]).size,3);
  assert.equal(new Set([local.color,second.color,replacement.color]).size,3);
});

test('hosted cold create preserves the full loading deadline after a delayed map without premature callbacks',{timeout:20000},async()=>{
  const server=await service();let created,earlyPatches=0;
  const Slow=hostedRoomType({rooms:server.rooms,maxRooms:2},{mapReadyMs:1600}),make=Slow.prototype.createWorld,patch=Slow.prototype.onBeforePatch;
  Slow.prototype.createWorld=function(options){const world=make.call(this,options);created=this;
    world.ready=Promise.all([world.ready,sleep(2500)]);return world;};
  Slow.prototype.onBeforePatch=function(){if(!this.metrics?.patchIntervals)earlyPatches++;return patch.call(this);};
  server.server.define('delayed-driving',Slow);
  const client=new RoomClient({sdk:{create:(_,options)=>server.sdk.create('delayed-driving',options)},onWelcome:()=>sleep(250)});
  try{
    const connecting=client.connect();await until(()=>created);await sleep(100);
    assert.equal(created.sim.tick,0);assert.equal(earlyPatches,0);
    await connecting;assert.equal(client.phase,'playing');assert.equal(created.metrics.faults,0);assert.equal(earlyPatches,0);
    assert.equal(created.sim.runtime.roleCount('civilian'),102);await until(()=>created.sim.tick>0);
  }finally{await client.leave();await server.cleanup();}
});
