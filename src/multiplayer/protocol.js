// Shared wire contract. Simulation dt/configuration are never client inputs.
export const JOIN_OPTIONS=Object.freeze({protocolVersion:1,presentationVersion:6,buildId:'carwars-ws-6',mapVersion:3,generatorVersion:'city-1'});
export const ROOM_LIMITS=Object.freeze({inputBytes:1024,transportBytes:4096,inputPerSecond:60,messagesPerSecond:120,
  socketBytes:256*1024,transferBytes:2*1024*1024,chunkBytes:32*1024,mapReadyMs:20000,reconnectSeconds:15});
export function validMapReady(data,expected){
  return data && typeof data==='object' && !Array.isArray(data) &&
    Object.keys(data).length===5 && ['nonce','roundId','signature','buildId','mapVersion'].every(k=>data[k]===expected[k]);
}
export const mapReadyMessage=data=>({nonce:data.nonce,roundId:data.roundId,signature:data.snapshot.mapSignature,
  buildId:JOIN_OPTIONS.buildId,mapVersion:JOIN_OPTIONS.mapVersion});
