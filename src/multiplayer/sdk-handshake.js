import { listenSnapshots } from './transfers.js';
import { mapReadyMessage } from './protocol.js';
import { verifyMap } from './map-contract.js';
import { decodeFrame } from './frame-codec.js';

// Raw SDK operator probes use the same map verification and activation gate as the 3D client.
export async function prepareRoom(room){
  let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});
  const timer=setTimeout(()=>reject(Error('Map-ready timeout')),25000);
  listenSnapshots(room,{welcome:async data=>{await verifyMap(data.map,data.snapshot.mapSignature);
    room.welcome=data;room.serverRoundId=data.roundId;room.send('map-ready',mapReadyMessage(data));},
    full:data=>{room.fullSnapshot=data;},error:reject});
  room.onMessage('frame',bytes=>{room.motionFrame=decodeFrame(bytes);});room.onMessage('gameplay',data=>{room.gameplay=data;});
  room.onMessage('ready',()=>{clearTimeout(timer);resolve(room);});room.onMessage('pong',()=>{});
  room.onMessage('respawned',()=>{});room.onMessage('shutdown',()=>{room.reconnection.enabled=false;});
  room.onMessage('epoch-required',()=>{});room.onMessage('epoch',()=>{});
  room.onLeave(()=>{clearTimeout(timer);reject(Error('Room closed before map-ready'));});
  room.send('hello');return promise.finally(()=>clearTimeout(timer));
}
