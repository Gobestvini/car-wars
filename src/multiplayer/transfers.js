import { ROOM_LIMITS } from './protocol.js';

// Exactly one bounded transfer per socket; TCP preserves order. No partial DTO is applied.
export function listenSnapshots(room,{welcome=()=>{},full=()=>{},error=()=>{}}={}){
  let active=null;
  room.onMessage('transfer-start',header=>{
    if(!header || !Number.isSafeInteger(header.id) || !['welcome','full'].includes(header.kind) ||
      !Number.isSafeInteger(header.bytes) || header.bytes<1 || header.bytes>ROOM_LIMITS.transferBytes){active=null;error(Error('Invalid snapshot transfer'));return;}
    active={...header,buffer:new Uint8Array(header.bytes),offset:0,index:0,started:performance.now()};
  });
  room.onMessage('transfer-chunk',bytes=>{
    try{
      const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),a=active;
      if(!a||data.length<9||data.length>ROOM_LIMITS.chunkBytes+8||performance.now()-a.started>10000)throw Error('Invalid snapshot chunk');
      const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
      if(view.getUint32(0)!==a.id||view.getUint32(4)!==a.index||a.offset+data.length-8>a.bytes)throw Error('Snapshot transfer out of order');
      a.buffer.set(data.subarray(8),a.offset);a.offset+=data.length-8;a.index++;
      if(a.offset===a.bytes){active=null;const dto=JSON.parse(new TextDecoder().decode(a.buffer));
        Promise.resolve((a.kind==='welcome'?welcome:full)(dto)).catch(error);}
    }catch(e){active=null;error(e);}
  });
  return ()=>{active=null;};
}
