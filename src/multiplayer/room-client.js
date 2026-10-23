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
export class RoomClient {
  constructor({ endpoint = DEFAULT_GAME_ENDPOINT, onStatus = () => {}, onWelcome = () => {}, onLeave = () => {} } = {}) {
    this.sdk = new Client(endpoint); this.onStatus = onStatus; this.onWelcome = onWelcome; this.onLeave = onLeave;
    this.buffer = new SnapshotBuffer(); this.room = null; this.input = neutralInput(); this.seq = 0;
  }
  async connect(roomId) {
    await this.leave();
    const options={protocolVersion:1,presentationVersion:5};
    const room = roomId ? await this.sdk.joinById(roomId,options) : await this.sdk.create('driving',options);
    this.room = room; this.seq = 0; this.buffer.clear(); this.input = neutralInput();
    this.gameplay = null;
    room.onMessage('gameplay',data=>{if(this.room===room)this.acceptGameplay(data);});
    room.onMessage('frame',bytes=>{
      if(this.room!==room)return;
      try { const now=performance.now(),frame=decodeFrame(bytes);frame.receivedAt=now;this.latestFrame=frame;
        this.buffer.push(frame,now);
        if(this.prediction){
          if(!this.prediction.latest)this.prediction.receive(frame,now);
          else this.prediction.pendingFrame=frame;
        } }
      catch { this.stop();this.onStatus('Получено неверное состояние мира. Перезагрузите игру.'); }
    });
    room.onMessage('full',()=>{});
    room.onMessage('pong',data=>{
      if(this.room!==room)return;
      const now=performance.now(),rtt=now-data.stamp;
      if(rtt<0||rtt>3000)return;
      this.rtts ??=[];this.rtts.push(rtt);if(this.rtts.length>10)this.rtts.shift();
      this.rtt=Math.min(...this.rtts);
      if(this.prediction){if(!this.clockSynced)this.prediction.clock=null;this.prediction.observeClock(data.tick,now,this.rtt);this.clockSynced=true;}
    });
    room.onMessage('welcome',data => {if(this.room===room){this.acceptGameplay(data.snapshot?.gameplay);this.onWelcome(data);}});
    room.onMessage('respawned',()=>{if(this.room===room)this.buffer.clear();});
    room.onError((code,message)=>{if(this.room===room)this.onStatus(roomError({message:message || `Ошибка ${code}`}));});
    room.onDrop(()=>{ if(this.room!==room)return;this.input = neutralInput(); this.onStatus('Переподключение… Машина сохранена на 15 секунд.'); });
    room.onReconnect(()=>{ if(this.room!==room)return;this.input=neutralInput(); this.buffer.clear(); room.send('hello'); this.onStatus('Соединение восстановлено'); });
    room.onLeave(()=>{ if(this.room===room) { this.room=null; clearInterval(this.timer);clearInterval(this.pingTimer);
      this.prediction?.dispose();this.prediction=null;this.latestFrame=null;this.gameplay=null;this.input=neutralInput(); this.onLeave(); } });
    room.send('hello');
    this.timer = setInterval(()=>{if(!this.prediction)this.sendInput();},1000/30);
    this.pingTimer=setInterval(()=>{if(room.connection.isOpen)room.send('ping',performance.now());},1000);
    room.send('ping',performance.now());
    return room;
  }
  startPrediction(colliders) {
    this.prediction?.dispose();this.clockSynced=false;
    this.prediction=new ClientPrediction({colliders,localId:this.room.sessionId,send:packet=>{
      if(this.room?.connection?.isOpen)this.room.send('commands',packet);
    }});
    if(this.rtt!==undefined)this.prediction.rtt=this.rtt;
    if(this.latestFrame)this.prediction.receive(this.latestFrame,this.latestFrame.receivedAt);
  }
  acceptGameplay(data) {
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
  }
  sendInput() {
    if(!this.prediction && this.room?.connection?.isOpen) this.room.send('input',{ roundId:'round-1',seq:++this.seq,...this.input });
  }
  stop() { this.input=neutralInput();
    if(this.prediction && this.room?.connection?.isOpen)this.room.send('halt',this.prediction.latest?.actors.get(this.room.sessionId)?.generation ?? 0);
    else this.sendInput(); }
  respawn() { this.stop(); if(this.room?.connection?.isOpen) this.room.send('respawn'); }
  async leave() {
    clearInterval(this.timer);clearInterval(this.pingTimer); this.stop();
    this.prediction?.dispose();this.prediction=null;this.latestFrame=null;this.gameplay=null;this.rtts=[];this.rtt=undefined;
    const room=this.room; this.room=null; this.buffer.clear();
    if(room) { room.reconnection.enabled=false; if(room.connection?.isOpen) await room.leave(); }
  }
}
