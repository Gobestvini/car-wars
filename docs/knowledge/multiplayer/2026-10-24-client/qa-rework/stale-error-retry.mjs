import fs from 'node:fs';
import {RoomClient} from '../../../../../src/multiplayer/room-client.js';
import {service,until,sleep} from '../../../../../tests/helpers/hosted-room.mjs';
const server=await service(),statuses=[],client=new RoomClient({endpoint:server.endpoint,onStatus:m=>statuses.push(m)});
let peer;
try{
 await client.connect();const old=client.room,host=server.room(old.roomId);peer=host.clients.find(p=>p.sessionId===old.sessionId);
 peer.ref._socket.pause();peer.send('transfer-start',{id:333,kind:'full',bytes:0});
 await until(()=>client.room===null);await client.connect();const fresh=client.room;
 const beforeRelease={phase:client.phase,roomId:fresh.roomId,oldRoomId:old.roomId,active:client.active};
 peer.ref._socket.resume();await sleep(300);
 const afterRelease={phase:client.phase,roomId:client.room?.roomId,active:client.active,statuses};
 const result={beforeRelease,afterRelease,defect:client.phase!=='playing'&&client.room===fresh};fs.writeFileSync('docs/knowledge/multiplayer/2026-10-24-client/qa-rework/stale-error-retry.json',JSON.stringify(result,null,2));console.log(result);
}finally{peer?.ref._socket?.resume();await client.leave();await server.cleanup();}
