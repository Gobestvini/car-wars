import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RoomClient} from '../../../../../src/multiplayer/room-client.js';
import {service,until,sleep} from '../../../../../tests/helpers/hosted-room.mjs';
const server=await service(),client=new RoomClient({endpoint:server.endpoint});
try{
 await client.connect();const old=client.room,host=server.room(old.roomId);
 old.reconnection.minUptime=0;old.reconnection.minDelay=old.reconnection.maxDelay=1200;
 host.clients.find(p=>p.sessionId===old.sessionId).ref.terminate();await until(()=>client.phase==='reconnecting');
 old.send('input',{stale:true});assert.equal(old.reconnection.enqueuedMessages.length,1);
 old.connection.reconnect({reconnectionToken:old.reconnectionToken.split(':')[1],skipHandshake:true});
 const connectingState=old.connection.transport.ws.readyState;assert.equal(connectingState,0);
 await client.leave();await sleep(1800);
 const result={connectingState,afterDelayState:old.connection.transport.ws.readyState,oldOpen:old.connection.isOpen,reconnecting:old.reconnection.isReconnecting,buffered:old.reconnection.enqueuedMessages.length,phase:client.phase};
 assert.ok([2,3].includes(result.afterDelayState));assert.equal(result.oldOpen,false);assert.equal(result.reconnecting,false);assert.equal(result.buffered,0);assert.equal(result.phase,'idle');
 await client.connect();result.freshRoomId=client.room.roomId;assert.notEqual(client.room.roomId,old.roomId);
 fs.writeFileSync('docs/knowledge/multiplayer/2026-10-24-client/qa-rework/connecting-cancel.json',JSON.stringify(result,null,2));console.log(result);
}finally{await client.leave();await server.cleanup();}
