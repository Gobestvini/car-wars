import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { startHostedServer } from '../../tools/multiplayer-spike/deploy/server.js';
import { JOIN_OPTIONS,mapReadyMessage } from '../../src/multiplayer/protocol.js';
import { listenSnapshots } from '../../src/multiplayer/transfers.js';
import { verifyMap } from '../../src/multiplayer/map-contract.js';
import { decodeFrame } from '../../src/multiplayer/frame-codec.js';
// Node's ws exposes the real receiving TCP socket for the slow-reader scenario.
const require=createRequire(new URL('../../tools/multiplayer-spike/package.json',import.meta.url));
globalThis.WebSocket=require('ws');
const {Client}=await import('@colyseus/sdk');
export {sleep,JOIN_OPTIONS,mapReadyMessage,Client};
export async function until(fn,ms=8000){const end=performance.now()+ms;while(!fn()){if(performance.now()>end)throw Error('Room fixture timeout');await sleep(15);}}
export async function service(options={}){
  const server=await startHostedServer({port:0,host:'127.0.0.1',...options});
  server.endpoint=`http://127.0.0.1:${server.server.transport.server.address().port}`;server.sdk=new Client(server.endpoint);server.peers=[];
  server.room=id=>[...server.rooms].find(r=>r.roomId===id);
  server.join=async(id,options={})=>attach(server,id?await server.sdk.joinById(id,JOIN_OPTIONS):await server.sdk.create('driving',JOIN_OPTIONS),options);
  server.cleanup=async()=>{for(const p of server.peers){p.reconnection.enabled=false;p.connection.transport.ws._socket?.resume();}
    await Promise.allSettled(server.peers.filter(p=>p.connection.isOpen).map(p=>p.leave()));await server.close();};
  return server;
}
export async function attach(server,peer,{autoReady=true}={}){
  server.peers.push(peer);peer.reconnection.enabled=false;
  listenSnapshots(peer,{welcome:async data=>{peer.welcome=data;await verifyMap(data.map,data.snapshot.mapSignature);
    if(autoReady)peer.send('map-ready',mapReadyMessage(data));},full:data=>peer.full=data,error:e=>peer.fixtureError=e});
  peer.onMessage('probe',()=>{});peer.onMessage('frame',bytes=>peer.frame=decodeFrame(bytes));peer.onMessage('gameplay',data=>peer.gameplay=data);
  peer.onMessage('ready',()=>peer.mapReady=true);peer.onMessage('pong',()=>{});peer.onMessage('shutdown',data=>peer.shutdown=data);
  peer.onMessage('respawned',data=>peer.respawned=data);peer.onMessage('epoch-required',()=>peer.epochRequired=true);peer.onMessage('epoch',data=>peer.epoch=data);
  peer.send('hello');await until(()=>peer.fixtureError||peer.welcome);if(peer.fixtureError)throw peer.fixtureError;
  if(autoReady)await until(()=>peer.mapReady);return peer;
}
