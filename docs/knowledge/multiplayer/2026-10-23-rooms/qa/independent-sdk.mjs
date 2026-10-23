import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { service,until,sleep } from '../../../../../tests/helpers/hosted-room.mjs';
import { RoomClient } from '../../../../../src/multiplayer/room-client.js';

const report={date:new Date().toISOString(),node:process.version,scope:'independent actual SDK loopback authority and event history'};
const s=await service();let late;
try{
  const peers=[await s.join()];peers.push(await s.join(peers[0].roomId),await s.join(peers[0].roomId));
  const room=s.room(peers[0].roomId),actors=peers.map(p=>room.sim.players.get(p.sessionId));
  await until(()=>actors.every(a=>!a.sim.appearing));
  const controls=[{steer:-.5,throttle:.3,brake:0},{steer:.5,throttle:.8,brake:0},{steer:0,throttle:-.6,brake:.1}];
  const starts=actors.map(a=>[a.sim.body.position.x,a.sim.body.position.z]);
  for(let seq=1;seq<=15;seq++){
    peers.forEach((p,i)=>p.send('input',{roundId:room.roundId,generation:actors[i].generation,seq,...controls[i]}));
    await sleep(40);
  }
  await until(()=>actors.every(a=>a.lastSeq===15));
  actors.forEach((a,i)=>{assert.equal(a.control.throttle,controls[i].throttle);assert.equal(a.control.steer,controls[i].steer);assert.ok(a.lastAppliedTick>0);});
  assert.equal(new Set(actors.map(a=>a.sim.body)).size,3);
  report.threeControls=actors.map((a,i)=>({id:a.id,lastSeq:a.lastSeq,appliedTick:a.lastAppliedTick,control:a.control,moved:Math.hypot(a.sim.body.position.x-starts[i][0],a.sim.body.position.z-starts[i][1])}));
  assert.ok(report.threeControls.every(a=>a.moved>.01));
  await peers[2].leave();await until(()=>room.sim.players.size===2);
  room.sim.event('qa-historical',actors[0].id);
  late=new RoomClient({endpoint:s.endpoint});await late.connect(room.roomId);
  assert.equal(late.events.filter(e=>e.type==='qa-historical').length,0);
  assert.ok([...late.seenEvents].some(id=>id.startsWith(room.roundId+':')));
  room.sim.event('qa-new',actors[0].id);await until(()=>late.events.some(e=>e.type==='qa-new'));
  const expected=late.events.find(e=>e.type==='qa-new').id;
  room.clients.find(c=>c.sessionId===late.room.sessionId).send('gameplay',room.gameplay());await sleep(100);
  assert.equal(late.events.filter(e=>e.id===expected).length,1);
  const removed=room.sim.props.entries[0];room.sim.props.remove(removed);
  late.room.send('full');await until(()=>late.fullSnapshot);
  const full=late.fullSnapshot;
  assert.equal(full.players.length,3);assert.equal(full.mapSignature,room.sim.signature);
  assert.ok(Number.isFinite(full.signalTime));assert.ok(full.props.some(p=>p[0]===removed.index&&p[1]===-1));assert.ok(full.players.every(p=>p.wheels.length===4));
  report.events={historicalReplay:false,newEventExactlyOnce:true,fullResyncNoReplay:true};
  report.full={players:full.players.length,props:full.props.length,signalTime:full.signalTime,mapSignature:full.mapSignature};
  report.passed=true;
}finally{await late?.leave();await s.cleanup();await writeFile(new URL('independent-sdk.json',import.meta.url),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
