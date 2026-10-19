import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { startHostedServer } from '../deploy/server.js';

test('hosted ghost lifecycle requires the current presentation version',async()=>{
  const service=await startHostedServer({port:0,host:'127.0.0.1'});
  const sdk=new Client(`http://127.0.0.1:${service.server.transport.server.address().port}`);
  let room;
  try{
    await assert.rejects(sdk.create('driving',{protocolVersion:1,presentationVersion:4}),/outdated|reload/i);
    room=await sdk.create('driving',{protocolVersion:1,presentationVersion:5});
    assert.ok(room.sessionId);
  }finally{if(room)await room.leave();await service.close();}
});
