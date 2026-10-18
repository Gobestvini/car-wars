import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { startHostedServer } from '../deploy/server.js';
import { RoomClient } from '../../../src/multiplayer/room-client.js';
import { verifyMap } from '../../../src/multiplayer/map-contract.js';

test('switching hosted rooms replaces both the server map and motion actors',async()=>{
  const service=await startHostedServer({port:0,host:'127.0.0.1'}),port=service.server.transport.server.address().port;
  const welcomes=[],errors=[],client=new RoomClient({endpoint:`http://127.0.0.1:${port}`,
    onWelcome:data=>welcomes.push(data),onStatus:error=>errors.push(error)});
  const until=async condition=>{const deadline=Date.now()+5000;while(!condition()){if(Date.now()>deadline)throw Error('Hosted map timeout');await sleep(20);}};
  let previous;
  try{
    for(let i=0;i<3;i++){
      const room=await client.connect();await until(()=>welcomes.length===i+1&&client.buffer.frames.length>2);
      const map=welcomes.at(-1);assert.equal(map.roomId,room.roomId);await verifyMap(map.map,room.state.signature);
      assert.ok(client.buffer.frames.every(frame=>[...frame.actors.values()].filter(a=>a.role==='player').every(a=>a.id===room.sessionId)));
      assert.ok(client.buffer.frames.at(-1).actors.has(room.sessionId));
      if(previous)assert.notEqual(room.roomId,previous);
      previous=room.roomId;await client.leave();assert.equal(client.buffer.frames.length,0);
    }
    assert.deepEqual(errors,[]);
  }finally{await client.leave();await service.close();}
});
