import { Client } from '@colyseus/sdk';
import { decodeFrame } from '../../../src/multiplayer/frame-codec.js';
const $ = id => document.getElementById(id);
const sdk = new Client(new URL('.', location.href).href.replace(/\/$/, ''));
const canvas = $('scene'), ctx = canvas.getContext('2d'), keys = new Set();
let room = null, map = null, seq = 0, busy = false;
const status = text => { $('status').textContent = text; };
function buttons() { $('create').disabled = $('join').disabled = busy || Boolean(room); $('leave').disabled = !room; }
async function connect(id) {
  if (busy || room) return;
  busy = true; buttons(); status('Подключение…');
  try {
    const r = id ? await sdk.joinById(id, { protocolVersion: 1,presentationVersion:4 }) : await sdk.create('driving', { protocolVersion: 1,presentationVersion:4 });
    room = r; seq = 0;
    r.onMessage('welcome', data => { map = data.map; });
    r.onMessage('full', () => {});
    r.onMessage('frame',bytes=>{r.motionFrame=decodeFrame(bytes);});
    r.onError((code, message) => status(`Ошибка ${code}: ${message}`));
    r.onLeave(() => { if (room === r) { room = null; map = null; keys.clear(); buttons(); status('Соединение закрыто. Можно войти снова.'); } });
    r.send('hello');
    $('room').value = r.roomId;
    const invite = new URL(location.href); invite.search = ''; invite.searchParams.set('room', r.roomId);
    $('invite').value = invite.href;
    status(`Комната ${r.roomId}. Отправьте ссылку друзьям — до трёх игроков.`);
  } catch (error) { status(`Не удалось подключиться: ${error.message}`); }
  finally { busy = false; buttons(); }
}
$('create').onclick = () => connect();
$('join').onclick = () => { const id = $('room').value.trim(); if (id) connect(id); else status('Введите код комнаты.'); };
$('leave').onclick = async () => { keys.clear(); if (room) await room.leave(); };
$('invite').onclick = () => $('invite').select();
window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key.startsWith('Arrow')) e.preventDefault(); keys.add(e.key.toLowerCase());
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); keys.add(button.dataset.key); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => keys.delete(button.dataset.key));
}
setInterval(() => {
  if (!room?.connection?.isOpen) return;
  const throttle = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
  const steer = Number(keys.has('a') || keys.has('arrowleft')) - Number(keys.has('d') || keys.has('arrowright'));
  room.send('input', { roundId: 'round-1', seq: ++seq, throttle, steer, brake: throttle === 0 ? 1 : 0 });
}, 1000 / 30);
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const project = (x, z) => [500 + x * 1.25, 300 + z * 1.25];
  if (map) {
    ctx.strokeStyle = '#526776'; ctx.lineWidth = 9;
    for (const [x,z,xx,zz] of map.roads) { ctx.beginPath(); ctx.moveTo(...project(x,z)); ctx.lineTo(...project(xx,zz)); ctx.stroke(); }
    ctx.fillStyle = '#64756e';
    for (const [x,z,w,d] of map.buildings) ctx.fillRect(...project(x-w/2,z-d/2),w*1.25,d*1.25);
  }
  const state = room?.motionFrame || room?.state;
  if (state?.actors) {
    const players = [...state.actors.values()].filter(a => a.role === 'player');
    for (const a of state.actors.values()) {
      if (!a.pose?.length) continue;
      const p = a.pose, yaw = Math.atan2(2*(p[3]*p[5]+p[6]*p[4]),1-2*(p[3]**2+p[4]**2));
      ctx.save(); ctx.translate(...project(p[0],p[2])); ctx.rotate(-yaw);
      ctx.fillStyle = a.id === room.sessionId ? '#fff06b' : a.role === 'player' ? '#81d9ff' : '#abc9d4';
      ctx.fillRect(-2.5,-4.5,5,9); ctx.restore();
      if (a.role === 'player') { ctx.fillStyle = '#fff'; ctx.fillText(a.id === room.sessionId ? 'Вы' : 'Игрок',...project(p[0]+5,p[2])); }
    }
    $('metrics').textContent = `Игроков: ${players.filter(a => a.connected).length}/3 · Трафик: ${state.actors.size-players.length} · Тик: ${state.tick}`;
  } else $('metrics').textContent = '';
  requestAnimationFrame(draw);
}
const invited = new URL(location.href).searchParams.get('room');
if (invited) { $('room').value = invited; connect(invited); }
draw();
