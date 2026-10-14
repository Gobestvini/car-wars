import { Client } from '@colyseus/sdk';
const $=id=>document.getElementById(id),canvas=$('scene'),ctx=canvas.getContext('2d');
const endpoint=new URLSearchParams(location.search).get('endpoint')||location.origin;
const sdk=new Client(endpoint),rooms=[],keys=new Set();let seq=0,token=null,map=null,pending=null;
let autoInterval=null;
const report={endpoint,sessions:0,fourth:null,mapSignatures:[],samples:[],movementSamples:[],collision:null,error:null};
window.spikeReport=report;
const status=t=>$('status').textContent=t;
const register=r=>{r.onMessage('welcome',data=>{map=data.map;report.mapSignatures.push(data.snapshot.mapSignature);});
  r.onMessage('full',()=>{});r.onError((code,msg)=>{report.error=`SDK error ${String(code)}: ${String(msg)}`;console.error(report.error);status(report.error);});
  r.send('hello');return r;};
async function connect(collision=false){
  clearInterval(autoInterval);for(const r of rooms.splice(0))if(r.connection?.isOpen)await r.leave();
  report.sessions=0;report.error=null;
  const a=register(await sdk.create('driving',{protocolVersion:1,collisionFixture:collision}));rooms.push(a);
  rooms.push(register(await sdk.joinById(a.roomId,{protocolVersion:1})),register(await sdk.joinById(a.roomId,{protocolVersion:1})));
  seq=0;report.sessions=rooms.length;status(`Комната ${a.roomId}: ${rooms.length}/3 · seed 20261005`);
  autoInterval=setInterval(()=>{
    if(pending)return;
    seq++;
    rooms.forEach((r,i)=>{if(!r?.connection?.isOpen)return;
      const throttle=i?(.35):(Number(keys.has('ArrowUp')||keys.has('w'))-Number(keys.has('ArrowDown')||keys.has('s')));
      const steer=i?0:(Number(keys.has('ArrowLeft')||keys.has('a'))-Number(keys.has('ArrowRight')||keys.has('d')));
      r.send('input',{roundId:'round-1',seq,steer,throttle,brake:throttle===0?1:0});
    });
  },1000/30);
}
function draw(){
  ctx.clearRect(0,0,1000,600);const project=(x,z)=>[500+x*1.25,300+z*1.25];
  if(map){ctx.strokeStyle='#526776';ctx.lineWidth=9;for(const [x,z,xx,zz] of map.roads){ctx.beginPath();ctx.moveTo(...project(x,z));ctx.lineTo(...project(xx,zz));ctx.stroke();}
    ctx.fillStyle='#64756e';for(const [x,z,w,d]of map.buildings){const [sx,sz]=project(x-w/2,z-d/2);ctx.fillRect(sx,sz,w*1.25,d*1.25);}}
  const state=rooms[0]?.state;
  if(state?.actors)for(const a of state.actors.values()){
    if(!a.pose?.length)continue;const p=a.pose,q=[p[3],p[4],p[5],p[6]],yaw=Math.atan2(2*(q[0]*q[2]+q[3]*q[1]),1-2*(q[0]**2+q[1]**2));
    const playerIndex=rooms.findIndex(r=>r.sessionId===a.id);
    ctx.save();ctx.translate(...project(p[0],p[2]));ctx.rotate(-yaw);
    ctx.fillStyle=a.role==='player'?['#fff06b','#fc9b88','#81d9ff'][Math.max(0,playerIndex)]:a.physical?'#abc9d4':'#799599';
    ctx.fillRect(-2,-4,4,8);ctx.strokeStyle='#fff';ctx.beginPath();ctx.moveTo(0,3);ctx.lineTo(a.steering*8,10);ctx.stroke();ctx.restore();
    if(a.role==='player'){ctx.fillStyle='#fff';ctx.fillText(`P${playerIndex+1}`, ...project(p[0]+4,p[2]));}
  }
  const own=state?.actors?.get(rooms[0]?.sessionId);
  if(pending&&own?.ack>=pending.seq){
    const moved=Math.hypot(own.pose[0]-pending.before[0],own.pose[2]-pending.before[2])>.001;
    const steerChanged=Math.abs(own.steering-pending.beforeSteer)>.001;
    if(moved||steerChanged){const result={seq:pending.seq,ms:performance.now()-pending.start,
      tick:state.tick,appliedTick:own.appliedTick,moved,steerChanged};report.samples.push(result);
      if(moved)report.movementSamples.push(result);const resolve=pending.resolve;pending=null;resolve(result);}
  }
  $('metrics').textContent=JSON.stringify({sessions:report.sessions,tick:state?.tick,signature:state?.signature,
    npcCount:state?.actors?.size?state.actors.size-3:0,physical:[...(state?.actors?.values()||[])].filter(a=>a.role==='civilian'&&a.physical).length,
    contactCount:state?.contactCount,fourth:report.fourth,samples:report.samples.length,lastResponse:report.samples.at(-1),latency:report.latency,
    connected:rooms.map(r=>Boolean(r.connection?.isOpen)),error:report.error},null,2);
  requestAnimationFrame(draw);
}
async function latency(){
  report.samples.length=report.movementSamples.length=0;
  for(let i=0;i<30;i++){
    const a=rooms[0].state.actors.get(rooms[0].sessionId);seq++;
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{pending=null;reject(new Error('Visible response timeout'));},3000);
      pending={seq,before:[...a.pose],beforeSteer:a.steering,start:performance.now(),resolve:r=>{clearTimeout(timeout);resolve(r);}};
      rooms[0].send('input',{roundId:'round-1',seq,steer:i%2?.6:-.6,throttle:.6,brake:0});
    });await new Promise(r=>setTimeout(r,100));
  }
  const values=report.samples.map(s=>s.ms).sort((a,b)=>a-b);
  report.latency={metric:'input -> Canvas frame containing changed position OR visible steering, after applied seq ack',
    count:values.length,movementCount:report.movementSamples.length,p50:values[14],p95:values[28],p99:values[29]};
  $('raw').textContent=JSON.stringify({...report,capturedAt:new Date().toISOString()},null,2);
  status('Замер завершён');
}
const action=fn=>async()=>{try{await fn();}catch(e){report.error=String(e?.message||e);console.error(e);status(report.error);}};
$('connect').onclick=action(()=>connect());
$('fourth').onclick=action(async()=>{try{const r=await sdk.joinById(rooms[0].roomId,{protocolVersion:1});await r.leave();report.fourth='UNEXPECTED accepted';}
  catch(e){report.fourth=e.message;status(`Четвёртый: ${e.message}`);}});
$('latency').onclick=action(latency);
$('disconnect').onclick=action(()=>{token=rooms[2].reconnectionToken;rooms[2].reconnection.enabled=false;rooms[2].connection.close(4001);status('Третий отключён; слот зарезервирован на15с');});
$('reconnect').onclick=action(async()=>{rooms[2]=register(await sdk.reconnect(token));status('Третий вернулся с прежним playerId');});
$('collision').onclick=action(()=>connect(true));
window.addEventListener('keydown',e=>{if(e.key.startsWith('Arrow'))e.preventDefault();keys.add(e.key);});
window.addEventListener('keyup',e=>keys.delete(e.key));
window.addEventListener('blur',()=>keys.clear());
draw();
