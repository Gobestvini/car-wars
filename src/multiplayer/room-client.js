import { JOIN_OPTIONS,mapReadyMessage } from './protocol.js';
import { listenSnapshots } from './transfers.js';
import { verifyMap } from './map-contract.js';
import { Client } from '@colyseus/sdk';
import { SnapshotBuffer } from './snapshot-buffer.js';
import { decodeFrame } from './frame-codec.js';
import { ClientPrediction } from './prediction.js';
export const DEFAULT_GAME_ENDPOINT = 'https://api.plusvibegames.com/carwars';
export const neutralInput = () => ({ steer: 0, throttle: 0, brake: 1, handbrake: false });
export function roomError(error) {
  const message = String(error?.message || error);
  if (/locked|full/i.test(message)) return 'Комната заполнена — максимум три игрока.';
  if (/not found|expired|invalid room/i.test(message)) return 'Комната закрыта или не найдена. Попросите новую ссылку.';
  if (/protocol|version/i.test(message)) return 'Версия игры обновилась. Перезагрузите страницу.';
  return `Не удалось подключиться: ${message}`;
}
export const connectionErrorPhase = error => /locked|full/i.test(String(error?.message)) ? 'full' : /protocol|version|Версия/i.test(String(error?.message)) ? 'version-error' : 'offline-error';
const cancelledError=()=>Object.assign(Error('Подключение отменено'),{name:'AbortError'});
// SDK0.18.5 does not expose its retry timer and the scheduled callback does not
// recheck reconnection.enabled. Retire the public reconnect entry point too, so
// that one pending SDK callback cannot reopen a departed room. Close CONNECTING
// transports as well as OPEN ones; no SDK internals or global timers are patched.
async function retireRoom(room){
  room.reconnection.enabled=false;room.reconnection.isReconnecting=false;
  room.reconnection.enqueuedMessages?.splice(0);
  const connection=room.connection;
  if(connection)connection.reconnect=()=>{};
  try{if(connection?.isOpen)await room.leave();else connection?.close();}
  finally{room.removeAllListeners?.();}
}
export class RoomClient {
  constructor({ endpoint = DEFAULT_GAME_ENDPOINT, onStatus = () => {}, onWelcome = () => {}, onLeave = () => {}, onPhase = () => {}, sdk } = {}) {
    this.sdk = sdk ?? new Client(endpoint); this.onPhase=onPhase;this.phase='idle';this.connectionEpoch=0;this.welcomeEpoch=0; this.onStatus = onStatus; this.onWelcome = onWelcome; this.onLeave = onLeave;
    this.buffer = new SnapshotBuffer(); this.room = null; this.input = neutralInput(); this.seq = 0;
  }
  setPhase(phase){this.phase=phase;this.onPhase(phase);}
  async connect(roomId) {
    const attempt=++this.connectionEpoch;
    await this.leave({invalidate:false});
    if(attempt!==this.connectionEpoch)throw cancelledError();
    this.setPhase('connecting');
    const cancelled=new Promise((_,reject)=>{this.cancelConnect=()=>reject(cancelledError());});
    try{return await Promise.race([this.open(roomId,attempt),cancelled]);}
    catch(error){if(attempt===this.connectionEpoch){await this.leave({invalidate:false});if(attempt===this.connectionEpoch)this.setPhase(error.name==='AbortError'?'idle':connectionErrorPhase(error));}throw error;}
  }
  async open(roomId,attempt) {
    const options={...JOIN_OPTIONS};
    const room = roomId ? await this.sdk.joinById(roomId,options) : await this.sdk.create('driving',options);
    if(attempt!==this.connectionEpoch){await retireRoom(room);throw cancelledError();}
    this.setPhase('map-loading');
    this.room = room; this.seq = 0; this.buffer.clear(); this.input = neutralInput();
    this.gameplay = null;this.fullSnapshot=null;this.active=false;this.roundId=null;this.requestId=0;this.seenEvents=new Set();this.events=[];
    const listeners=[];this.removeListeners=()=>{for(const remove of listeners.splice(0))remove();};
    const onMessage=(type,callback)=>listeners.push(room.onMessage(type,callback));
    const signal=(name,callback)=>{room[name](callback);listeners.push(()=>room[name].remove(callback));};
    onMessage('gameplay',data=>{if(this.room===room)this.acceptGameplay(data);});
    onMessage('frame',bytes=>{
      if(this.room!==room)return;
      try { const now=performance.now(),frame=decodeFrame(bytes);frame.receivedAt=now;this.latestFrame=frame;
        this.buffer.push(frame,now);
        if(this.prediction){
          if(!this.prediction.latest)this.prediction.receive(frame,now);
          else this.prediction.pendingFrame=frame;
        } }
      catch { this.stop();this.onStatus('Получено неверное состояние мира. Перезагрузите игру.'); }
    });
    this.cancelTransfer=listenSnapshots(room,{welcome:async data=>{
      if(this.room!==room)return;
      const welcome=++this.welcomeEpoch,current=()=>this.room===room&&welcome===this.welcomeEpoch;
      this.setPhase('map-loading');
      try{
      if(Object.entries(JOIN_OPTIONS).some(([k,v])=>data[k]!==v))throw Error('Версия игры изменилась. Обновите страницу.');
      await verifyMap(data.map,data.snapshot.mapSignature);if(!current())return;
      this.roundId=data.roundId;this.acceptGameplay({...data.snapshot.gameplay,roundId:data.roundId,events:data.snapshot.events},true);
      await this.onWelcome(data);if(current())room.send('map-ready',mapReadyMessage(data));
      }catch(error){if(current())throw error;}
    },full:data=>{if(this.room===room){this.acceptGameplay({...data.gameplay,roundId:data.roundId,events:data.events},true);this.fullSnapshot=data;}},
      error:error=>{if(this.room!==room)return;const leaving=this.leave(),departure=this.connectionEpoch;void leaving.then(()=>{if(departure!==this.connectionEpoch||this.room)return;this.setPhase(connectionErrorPhase(error));this.onStatus(error.message);});}});
    let resolveReady,rejectReady;const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
    const readyTimeout=setTimeout(()=>rejectReady(Error('Map loading timed out')),25000);
    const cancelPending=this.cancelConnect;
    this.cancelConnect=()=>{cancelPending?.();clearTimeout(readyTimeout);rejectReady(cancelledError());};
    onMessage('ready',data=>{if(this.room===room&&data.roundId===this.roundId){this.active=true;this.setPhase('playing');clearTimeout(readyTimeout);resolveReady();}});
    onMessage('shutdown',()=>{if(this.room!==room)return;this.setPhase('offline-error');this.active=false;room.reconnection.enabled=false;this.onStatus('Сервер закрывает комнату. Создайте новую после запуска.');});
    onMessage('epoch-required',()=>{if(this.room===room&&this.active)room.send('input-epoch',{roundId:this.roundId,generation:this.latestFrame?.actors.get(room.sessionId)?.generation});});
    onMessage('epoch',()=>{if(this.room===room)this.seq=0;});
    onMessage('pong',data=>{
      if(this.room!==room)return;
      const now=performance.now(),rtt=now-data.stamp;
      if(rtt<0||rtt>3000)return;
      this.rtts ??=[];this.rtts.push(rtt);if(this.rtts.length>10)this.rtts.shift();
      this.rtt=Math.min(...this.rtts);
      if(this.prediction){if(!this.clockSynced)this.prediction.clock=null;this.prediction.observeClock(data.tick,now,this.rtt);this.clockSynced=true;}
    });
    onMessage('respawned',()=>{if(this.room===room)this.buffer.clear();});
    signal('onError',(code,message)=>{if(this.room===room)this.onStatus(roomError({message:message || `Ошибка ${code}`}));});
    signal('onDrop',()=>{ if(this.room!==room)return;++this.welcomeEpoch;this.active=false;this.setPhase('reconnecting');this.cancelTransfer?.();this.input = neutralInput(); this.onStatus('Переподключение… Машина сохранена на 15 секунд.'); });
    signal('onReconnect',()=>{ if(this.room!==room)return;this.input=neutralInput(); this.buffer.clear(); room.send('hello'); this.onStatus('Соединение восстановлено'); });
    signal('onLeave',()=>{clearTimeout(readyTimeout);rejectReady(Error('Connection closed before map-ready'));if(this.room===room){void this.leave();this.onStatus('Соединение закрыто. Можно войти снова.');}});
    room.send('hello');
    this.timer = setInterval(()=>{if(!this.prediction)this.sendInput();},1000/30);
    this.pingTimer=setInterval(()=>{if(room.connection.isOpen)room.send('ping',performance.now());},1000);
    room.send('ping',performance.now());
    await readyPromise;return room;
  }
  startPrediction(colliders) {
    this.prediction?.dispose();this.clockSynced=false;
    this.prediction=new ClientPrediction({colliders,localId:this.room.sessionId,send:packet=>{
      if(this.active&&this.room?.connection?.isOpen)this.room.send('commands',{...packet,roundId:this.roundId});
    }});
    if(this.rtt!==undefined)this.prediction.rtt=this.rtt;
    if(this.latestFrame)this.prediction.receive(this.latestFrame,this.latestFrame.receivedAt);
  }
  acceptGameplay(data,initial=false) {
    if(this.roundId&&data?.roundId!==this.roundId)return;
    if(!data || !Number.isSafeInteger(data.revision) || data.revision<0 ||
      !Number.isSafeInteger(data.tick) || data.tick<0 ||
      !Array.isArray(data.pickups) || data.pickups.length>12 || !Array.isArray(data.players) || data.players.length>3)return;
    if(this.gameplay && data.revision<=this.gameplay.revision)return;
    const ids=new Set();
    for(const p of data.pickups){
      if(!Number.isSafeInteger(p.id)||p.id<0||ids.has(p.id)||!Number.isFinite(p.x)||!Number.isFinite(p.z)||
        !['available','consumed'].includes(p.status))return;
      ids.add(p.id);
    }
    ids.clear();
    for(const p of data.players){
      if(typeof p.id!=='string'||!p.id||p.id.length>64||ids.has(p.id)||!Number.isSafeInteger(p.repairRevision)||p.repairRevision<0)return;
      ids.add(p.id);
    }
    this.gameplay=data;
    for(const e of data.events??[]){if(typeof e.id!=='string'||this.seenEvents?.has(e.id))continue;
      this.seenEvents??=new Set();this.events??=[];this.seenEvents.add(e.id);if(!initial)this.events.push(e);}
    while(this.seenEvents?.size>128)this.seenEvents.delete(this.seenEvents.values().next().value);
    if(this.events?.length>64)this.events.splice(0,this.events.length-64);
  }
  sendInput() {
    if(this.active&&!this.prediction&&this.room?.connection?.isOpen)this.room.send('input',{roundId:this.roundId,generation:this.latestFrame?.actors.get(this.room.sessionId)?.generation??1,seq:++this.seq,...this.input});
  }
  stop() { this.input=neutralInput();
    if(this.prediction && this.room?.connection?.isOpen)this.room.send('halt',this.prediction.latest?.actors.get(this.room.sessionId)?.generation ?? 0);
    else this.sendInput(); }
  respawn() {this.stop();if(this.active&&this.room?.connection?.isOpen)this.room.send('respawn',{roundId:this.roundId,generation:this.latestFrame?.actors.get(this.room.sessionId)?.generation??1,requestId:++this.requestId});}
  async leave({invalidate=true}={}) {
    if(invalidate)++this.connectionEpoch;++this.welcomeEpoch;
    const room=this.room,hadSession=Boolean(room);
    if(hadSession)this.setPhase('leaving');
    this.stop();this.active=false;
    this.cancelConnect?.();this.cancelConnect=null;
    this.cancelTransfer?.dispose?.();this.cancelTransfer=null;
    this.removeListeners?.();this.removeListeners=null;
    clearInterval(this.timer);clearInterval(this.pingTimer);this.timer=this.pingTimer=null;
    this.prediction?.dispose();this.prediction=null;this.latestFrame=null;this.gameplay=null;this.fullSnapshot=null;
    this.events=[];this.seenEvents=new Set();this.roundId=null;this.rtts=[];this.rtt=undefined;this.clockSynced=false;
    this.room=null;this.buffer.clear();
    if(hadSession)this.onLeave();
    this.setPhase('idle');
    if(room)await retireRoom(room);
  }
}
