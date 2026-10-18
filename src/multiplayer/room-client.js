import { Client } from '@colyseus/sdk';
import { SnapshotBuffer } from './snapshot-buffer.js';
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
    const room = roomId ? await this.sdk.joinById(roomId,{ protocolVersion: 1 }) : await this.sdk.create('driving',{ protocolVersion: 1 });
    this.room = room; this.seq = 0; this.buffer.clear(); this.input = neutralInput();
    room.onStateChange(state => this.buffer.push(state,performance.now()));
    room.onMessage('full',()=>{});
    room.onMessage('welcome',data => this.onWelcome(data));
    room.onMessage('respawned',()=>this.buffer.clear());
    room.onError((code,message)=>this.onStatus(roomError({message:message || `Ошибка ${code}`})));
    room.onDrop(()=>{ this.input = neutralInput(); this.onStatus('Переподключение… Машина сохранена на 15 секунд.'); });
    room.onReconnect(()=>{ this.input=neutralInput(); this.buffer.clear(); room.send('hello'); this.onStatus('Соединение восстановлено'); });
    room.onLeave(()=>{ if(this.room===room) { this.room=null; clearInterval(this.timer); this.input=neutralInput(); this.onLeave(); } });
    room.send('hello');
    this.timer = setInterval(()=>this.sendInput(),1000/30);
    return room;
  }
  sendInput() {
    if(this.room?.connection?.isOpen) this.room.send('input',{ roundId:'round-1',seq:++this.seq,...this.input });
  }
  stop() { this.input=neutralInput(); this.sendInput(); }
  respawn() { this.stop(); if(this.room?.connection?.isOpen) this.room.send('respawn'); }
  async leave() {
    clearInterval(this.timer); this.stop();
    const room=this.room; this.room=null; this.buffer.clear();
    if(room) { room.reconnection.enabled=false; if(room.connection?.isOpen) await room.leave(); }
  }
}
