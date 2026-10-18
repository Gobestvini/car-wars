// Operator-only acceptance fixture. Binds localhost, has no remote control API,
// and is never imported by the deployed entrypoint. Rebuild dist with
// VITE_GAME_SERVER_URL=http://127.0.0.1:2582, then set GAME_STATIC_DIR to dist.
import { startHostedServer } from './server.js';
import { matchMaker } from '@colyseus/core';
process.env.CARWARS_FIXED_SEED='42';
const service=await startHostedServer({port:2582,host:'127.0.0.1'});
console.log('Local browser fixture ready');
let phase=0,phaseAt=0;
setInterval(async()=>{
 const rooms=await matchMaker.query({name:'driving'});
 const room=rooms.map(r=>matchMaker.getLocalRoomById(r.roomId)).find(r=>r?.sim?.players.size===3);if(!room)return;
 const players=[...room.sim.players.values()];
 if(phase===0){
  players.forEach((p,i)=>{p.sim.spawn={x:i===2?8:0,y:1,z:i===1?5:-5,yaw:i===1?Math.PI:0};p.sim.reset();p.generation++;p.sim.body.velocity.set(0,0,i===0?15:i===1?-15:0);room.sim.halt(p.id);});
  phase=1;phaseAt=Date.now();console.log('Head-on fixture',players.map(p=>p.id));
 }else if(phase===1&&Date.now()-phaseAt>4000){
  const p=players[0],bin=room.sim.props.entries.find(p=>p.type==='bin');
  const fx=Math.sin(bin.yaw),fz=Math.cos(bin.yaw);p.sim.spawn={x:bin.x-fx*2.5,y:bin.y+.65,z:bin.z-fz*2.5,yaw:bin.yaw};p.sim.reset();p.generation++;p.sim.body.velocity.set(fx*20,0,fz*20);room.sim.halt(p.id);
  phase=2;console.log('Bin fixture',bin.id);
 }
},100);
