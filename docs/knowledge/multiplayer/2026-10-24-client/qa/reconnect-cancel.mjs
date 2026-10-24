import {pathToFileURL} from 'node:url';
import path from 'node:path';
const {RoomClient}=await import(pathToFileURL(path.resolve('src/multiplayer/room-client.js')).href);
const {service,until,sleep}=await import(pathToFileURL(path.resolve('tests/helpers/hosted-room.mjs')).href);
import fs from 'node:fs';
const server=await service();const c=new RoomClient({endpoint:server.endpoint});
let old;
try{
 await c.connect();old=c.room;old.reconnection.minUptime=0;old.reconnection.minDelay=1000;old.reconnection.maxDelay=1000;
 const r=server.room(old.roomId),id=old.sessionId;
 r.clients.find(p=>p.sessionId===id).ref.terminate();await until(()=>c.phase==='reconnecting');
 await c.leave();const afterCancel={phase:c.phase,room:c.room,oldOpen:old.connection.isOpen,enabled:old.reconnection.enabled};
 await sleep(1800);
 const afterDelay={phase:c.phase,room:c.room,oldOpen:old.connection.isOpen,oldReconnecting:old.reconnection.isReconnecting,serverConnected:r.sim.players.get(id)?.connected,serverPlayers:r.sim.players.size};
 const result={afterCancel,afterDelay,defect:old.connection.isOpen||r.sim.players.get(id)?.connected};
 fs.mkdirSync('docs/knowledge/multiplayer/2026-10-24-client/qa',{recursive:true});fs.writeFileSync('docs/knowledge/multiplayer/2026-10-24-client/qa/reconnect-cancel.json',JSON.stringify(result,null,2));console.log(result);
}finally{old.reconnection.enabled=false;if(old.connection.isOpen)await old.leave();await c.leave();await server.cleanup();}

