import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCityScene } from '../city-scene.js';
import { ART, ART_LIGHT } from '../art-direction.js';
import { PLAYER_MODEL_URL, preparePlayerModel, offsetPlayerWheel } from '../player-model.js';
import { createPlayerLights } from '../player-lights.js';
import { TRAFFIC_MODEL_URLS, createConceptTrafficAssets, makeConceptTrafficCar } from '../traffic-models.js';
import { createTrafficSignals } from '../traffic-signals.js';
import { createMiniatureBlur } from '../miniature-blur.js';
import { updateShadowCoverage } from '../shadow-coverage.js';
import { joystickVector } from '../joystick.js';
import { directionalInput } from '../driving-input.js';
import { FrameRateLimiter } from '../game-loop.js';
import { CarDamageEffects } from '../car-damage-effects.js';
import { RoomClient, roomError, neutralInput } from './room-client.js';
import '../style.css';
import '../start-screen.css';
import './style.css';

// Online owns presentation only. No cannon world, traffic controller or local
// gameplay solver is constructed: every car/wheel pose comes from the room.
export async function startGame(loadingScreen) {
  const $ = id => document.getElementById(id);
  document.body.dataset.online = 'true'; document.body.dataset.screen = 'playing';
  $('start-screen').hidden = true; $('start-screen').inert = true;
  const lobby = document.createElement('section'); lobby.id = 'multiplayer-lobby';
  lobby.setAttribute('aria-label','Игра с друзьями');
  lobby.innerHTML = `<div class="multiplayer-card"><h1>Игра с друзьями</h1>
    <p>Общий город, три машины.<br>Создайте комнату и пригласите друзей.</p>
    <button id="online-create" type="button">Создать комнату</button>
    <label for="online-room">Код комнаты</label><input id="online-room" maxlength="128" autocomplete="off" spellcheck="false" placeholder="Код из приглашения">
    <button id="online-join" type="button">Войти в комнату</button>
    <p id="online-message" role="status" aria-live="polite"></p>
    <label for="online-invite">Ссылка для друзей</label><input id="online-invite" readonly placeholder="Появится после подключения">
    <button id="online-continue" type="button" hidden>Продолжить игру</button>
    <button id="online-leave" type="button" hidden>Выйти из комнаты</button>
    <p><a id="online-offline" href="?offline=1">Одиночная игра</a></p></div>`;
  document.body.append(lobby);
  const toolbar=document.createElement('div'); toolbar.id='online-toolbar'; toolbar.hidden=true;
  toolbar.innerHTML='<button id="online-share" type="button">Пригласить</button><button id="online-respawn" type="button">Вернуть машину</button><button id="online-quality" type="button">Качество: высокое</button>';
  document.body.append(toolbar);
  const status=document.createElement('div'); status.id='online-status'; status.setAttribute('role','status'); document.body.append(status);
  const canvas=$('scene');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=ART_LIGHT.exposure; renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  let quality='high',disposed=false,city=null,signals=null,ready=false,busy=false,lastTime=performance.now(),request=null;
  const scene=new THREE.Scene();scene.background=new THREE.Color(ART.fog);scene.fog=new THREE.Fog(ART.fog,100,260);
  const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.1,220);
  const follow=new THREE.Vector3(),cameraGoal=new THREE.Vector3(),sunOffset=new THREE.Vector3().fromArray(ART_LIGHT.offset);
  scene.add(new THREE.HemisphereLight(ART_LIGHT.sky,ART_LIGHT.ground,ART_LIGHT.ambient));
  const sun=new THREE.DirectionalLight(ART_LIGHT.sun,ART_LIGHT.intensity);sun.castShadow=true;
  sun.shadow.camera.near=.1;sun.shadow.camera.far=150;sun.shadow.bias=-.0008;sun.shadow.normalBias=.03;sun.shadow.radius=3;
  scene.add(sun,sun.target);
  const blur=createMiniatureBlur(renderer);blur.setFocusSize(.58);
  const resize=()=>{
    const dpr=Math.min(devicePixelRatio,quality==='low'?1:1.75);renderer.setPixelRatio(dpr);renderer.setSize(innerWidth,innerHeight);
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();blur.setQuality(quality);blur.resize(innerWidth,innerHeight,dpr);
    sun.shadow.mapSize.setScalar(quality==='low'?512:1024);sun.shadow.map?.dispose();sun.shadow.map=null;
  };
  resize();window.addEventListener('resize',resize);
  const models=new Map(),keys=new Set();let playerTemplate,trafficAssets,driveDirection=1,expectedSignature=null;
  const pointer={active:false,id:null,startX:0,startY:0,x:0,y:0};
  const stop=()=>{keys.clear();pointer.active=false;$('touch-marker').style.display='none';network.stop();};
  const message=text=>{$('online-message').textContent=text;};
  const readOnlyCity={ addStaticBox:()=>null,addStaticConvex:()=>null,removeStaticBox:()=>{} };
  function clearModels(){for(const visual of models.values())disposeVisual(visual);models.clear();}
  const network=new RoomClient({
    endpoint:import.meta.env.VITE_GAME_SERVER_URL || undefined,
    onStatus:message,
    onWelcome(data){
      const plan=data.map?.plan;
      if(!plan?.roadNetwork || data.snapshot?.protocolVersion!==1 || !Number.isSafeInteger(plan.seed)) {
        message('Обновите игру: сервер ещё не поддерживает 3D-карту.');ready=false;void network.leave();return;
      }
      if(expectedSignature!==data.snapshot.mapSignature){
        city?.dispose();clearModels();city=createCityScene(scene,readOnlyCity,plan);
        signals=createTrafficSignals(plan.roadNetwork);expectedSignature=data.snapshot.mapSignature;
      }
      ready=true;message('Комната готова. Отправьте ссылку друзьям.');
      lobby.hidden=true;toolbar.hidden=false;stop();canvas.focus({preventScroll:true});
    },
    onLeave(){ready=false;stop();clearModels();lobby.hidden=false;toolbar.hidden=true;setButtons();message('Соединение закрыто. Можно создать комнату или войти снова.');},
  });
  function setButtons(){
    $('online-create').disabled=$('online-join').disabled=busy || Boolean(network.room);
    $('online-continue').hidden=$('online-leave').hidden=!network.room;
    $('online-room').disabled=busy || Boolean(network.room);
  }
  async function connect(id){
    if(busy || network.room)return;
    if(id && !/^[a-zA-Z0-9_-]{1,128}$/.test(id)){message('Введите код комнаты из ссылки.');return;}
    busy=true;setButtons();message('Подключение к комнате…');
    try{
      const room=await network.connect(id);$('online-room').value=room.roomId;
      const invite=new URL(location.href);invite.search='';invite.hash='';invite.searchParams.set('online','1');invite.searchParams.set('room',room.roomId);
      $('online-invite').value=invite.href;
    }catch(error){message(roomError(error));}
    finally{busy=false;setButtons();}
  }
  $('online-create').onclick=()=>connect();
  $('online-join').onclick=()=>{const id=$('online-room').value.trim();if(id)void connect(id);else message('Введите код комнаты.');};
  $('online-room').onkeydown=e=>{if(e.key==='Enter')$('online-join').click();};
  $('online-continue').onclick=()=>{if(ready){lobby.hidden=true;stop();canvas.focus({preventScroll:true});}};
  $('online-leave').onclick=async()=>{await network.leave();ready=false;clearModels();lobby.hidden=false;toolbar.hidden=true;setButtons();message('Вы вышли из комнаты.');};
  $('online-share').onclick=()=>{stop();lobby.hidden=false;setButtons();$('online-invite').focus();$('online-invite').select();};
  $('online-invite').onclick=()=>$('online-invite').select();
  $('online-respawn').onclick=()=>{network.respawn();canvas.focus({preventScroll:true});};
  $('online-quality').onclick=()=>{quality=quality==='high'?'low':'high';$('online-quality').textContent=`Качество: ${quality==='high'?'высокое':'лёгкое'}`;resize();canvas.focus({preventScroll:true});};
  function makeVisual(actor){
    if(actor.role!=='player'){
      const group=makeConceptTrafficCar(trafficAssets,Number(actor.id.split('-').at(-1))||0,'civilian');scene.add(group);
      return{group,player:false};
    }
    const group=new THREE.Group(),model=playerTemplate.model.clone(true);group.add(model);scene.add(group);
    const body=model.getObjectByName('body');body.material=body.material.clone();
    const lights=createPlayerLights(body);group.add(lights.glow);
    const wheels=playerTemplate.wheels.map(source=>{
      const node=model.getObjectByName(source.name);node.removeFromParent();node.position.set(0,0,0);
      const pivot=new THREE.Group(),spin=new THREE.Group();spin.add(node);pivot.add(spin);scene.add(pivot);return{pivot,spin};
    });
    const labelCanvas=document.createElement('canvas');labelCanvas.width=256;labelCanvas.height=64;
    const labelCtx=labelCanvas.getContext('2d');labelCtx.fillStyle=actor.id===network.room?.sessionId?'#ffe29c':'#9ddfff';
    labelCtx.beginPath();labelCtx.roundRect(0,0,256,64,20);labelCtx.fill();labelCtx.fillStyle='#071c3e';labelCtx.font='bold 28px system-ui';labelCtx.textAlign='center';
    labelCtx.fillText(actor.id===network.room?.sessionId?'Вы':`Друг ${[...models.values()].filter(v=>v.player).length+1}`,128,43);
    const texture=new THREE.CanvasTexture(labelCanvas),material=new THREE.SpriteMaterial({map:texture,depthTest:false});
    const label=new THREE.Sprite(material);label.position.y=3;label.scale.set(4.8,1.2,1);group.add(label);
    return{group,wheels,lights,body,label,texture,effects:new CarDamageEffects(scene),generation:actor.generation,player:true};
  }
  function disposeVisual(visual){
    scene.remove(visual.group);
    if(visual.player){for(const {pivot}of visual.wheels)scene.remove(pivot);visual.effects.dispose();visual.lights.glow.geometry.dispose();visual.lights.glow.material.dispose();visual.body.material.dispose();visual.label.material.dispose();visual.texture.dispose();}
  }
  function applyActor(visual,actor){
    const p=actor.pose;visual.group.position.fromArray(p);visual.group.quaternion.fromArray(p,3);
    if(!visual.player){visual.group.translateY(-.96);visual.group.traverse(node=>{if(node.isLOD)node.update(camera);});return;}
    for(let i=0;i<visual.wheels.length;i++){
      const {pivot,spin}=visual.wheels[i],offset=i*7,detached=Boolean(actor.wheels[offset+6]);
      pivot.position.fromArray(actor.wheels,offset);pivot.quaternion.copy(visual.group.quaternion);
      if(i<2&&!detached)pivot.rotateY(actor.steering*.5);
      spin.rotation.x=actor.wheels[offset+3] || 0;
      offsetPlayerWheel(pivot,{radius:.45},visual.group,detached);
    }
    const forward=new THREE.Vector3(0,0,1).applyQuaternion(visual.group.quaternion);
    const signed=(p[7]||0)*forward.x+(p[9]||0)*forward.z;
    visual.lights.update({signedSpeed:signed,throttle:actor.id===network.room?.sessionId?network.input.throttle:0});
  }
  const right=new THREE.Vector3(),up=new THREE.Vector3(),direction=new THREE.Vector3();
  function inputFor(actor){
    if(!ready || !lobby.hidden || document.hidden || !actor)return neutralInput();
    const q=new THREE.Quaternion().fromArray(actor.pose,3),forward=new THREE.Vector3(0,0,1).applyQuaternion(q);
    const signed=(actor.pose[7]||0)*forward.x+(actor.pose[9]||0)*forward.z;
    if(keys.size){
      const forwardKey=keys.has('KeyW')||keys.has('ArrowUp'),back=keys.has('KeyS')||keys.has('ArrowDown');
      const brake=(back&&signed>.5)||(forwardKey&&signed<-.5);
      return{steer:Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft')),
        throttle:brake?0:Number(forwardKey)-Number(back),brake:brake?1:(!forwardKey&&!back ? .18 : 0),handbrake:keys.has('Space')};
    }
    if(pointer.active){
      const stick=joystickVector(pointer.startX,pointer.startY,pointer.x,pointer.y);
      right.setFromMatrixColumn(camera.matrixWorld,0).setY(0).normalize();up.setFromMatrixColumn(camera.matrixWorld,1).setY(0).normalize();
      direction.copy(right).multiplyScalar(stick.x).addScaledVector(up,-stick.y);
      const result=directionalInput(Math.atan2(direction.x,direction.z),Math.atan2(forward.x,forward.z),signed,stick.strength,driveDirection);
      driveDirection=result.direction;return{steer:result.steer,throttle:result.throttle,brake:result.brake};
    }
    return{steer:0,throttle:0,brake:.18};
  }
  const down=e=>{
    if(!ready || !lobby.hidden)return;e.preventDefault();pointer.active=true;pointer.id=e.pointerId;
    pointer.startX=pointer.x=e.clientX;pointer.startY=pointer.y=e.clientY;canvas.setPointerCapture(e.pointerId);
    const marker=$('touch-marker');marker.style.display='block';marker.style.left=`${e.clientX}px`;marker.style.top=`${e.clientY}px`;
  };
  const move=e=>{if(pointer.active&&pointer.id===e.pointerId){pointer.x=e.clientX;pointer.y=e.clientY;}};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);
  canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);
  const keydown=e=>{
    if(['INPUT','TEXTAREA','BUTTON'].includes(e.target.tagName)||!lobby.hidden)return;
    if(e.code.startsWith('Arrow')||e.code==='Space')e.preventDefault();
    if(e.code==='KeyR'&&!e.repeat){network.respawn();return;}
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))keys.add(e.code);
  };
  const keyup=e=>keys.delete(e.code);
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',stop);
  document.addEventListener('visibilitychange',stop);
  const limiter=new FrameRateLimiter();
  function frame(now){
    if(disposed)return;request=requestAnimationFrame(frame);if(!limiter.shouldRender(now))return;
    const dt=Math.min(.1,(now-lastTime)/1000);lastTime=now;
    const room=network.room,actors=network.buffer.sample(now,room?.sessionId),own=actors.find(a=>a.id===room?.sessionId);
    const activeIds=new Set(actors.map(a=>a.id));
    for(const [id,visual]of models)if(!activeIds.has(id)){disposeVisual(visual);models.delete(id);}
    for(const actor of actors){
      if(!models.has(actor.id))models.set(actor.id,makeVisual(actor));
      const visual=models.get(actor.id);applyActor(visual,actor);
      if(visual.player){
        if(visual.generation!==actor.generation){visual.effects.reset();visual.generation=actor.generation;}
        visual.effects.update({damage:actor.damage,car:visual.group,camera,dt,quality});
      }
    }
    const stale=network.buffer.age!==null&&now-network.buffer.age>500;
    network.input=stale?neutralInput():inputFor(own);
    const focus=own?models.get(own.id).group:null;
    if(focus){
      const speed=Math.hypot(own.pose[7],own.pose[9]),scale=1+Math.min(.3,speed/100);
      follow.lerp(focus.position,1-Math.exp(-10*dt));cameraGoal.set(12,20,-17).multiplyScalar(scale).add(follow);
      if(camera.position.lengthSq()<1)camera.position.copy(cameraGoal);else camera.position.lerp(cameraGoal,1-Math.exp(-8*dt));
      camera.lookAt(follow.x,follow.y+.6,follow.z);$('speed').textContent=String(Math.round(speed*3.6));
      city?.occlusion.update(camera,focus,dt);
    }else{camera.position.set(12,22,-20);camera.lookAt(0,0,0);$('speed').textContent='0';}
    sun.position.copy(follow).add(sunOffset);sun.target.position.copy(follow);camera.updateMatrixWorld();updateShadowCoverage(sun,camera);
    if(city&&signals)city.updateSignals(signals,(room?.state?.tick||0)/120,camera,quality);
    trafficAssets?.animate(now/1000,quality);
    blur.render(scene,camera,{mode:'follow',car:focus});
    const count=actors.filter(a=>a.role==='player'&&a.connected).length;
    status.textContent=room?(stale?'Соединение нестабильно. Ожидаем сервер…':`Комната ${room.roomId} · ${count}/3 · WASD / стрелки · R — вернуть машину${own?.damage>.7?' · Машина повреждена':''}`):'';
  }
  async function load(){
    loadingScreen.update(15,'Загружаем машины…');
    const loader=new GLTFLoader();
    const loaded=await Promise.all([PLAYER_MODEL_URL,...Object.values(TRAFFIC_MODEL_URLS)].map(url=>loader.loadAsync(`${import.meta.env.BASE_URL}${url}`)));
    playerTemplate=preparePlayerModel(loaded[0].scene);
    trafficAssets=createConceptTrafficAssets(Object.fromEntries(Object.keys(TRAFFIC_MODEL_URLS).map((key,i)=>[key,loaded[i+1].scene])));
    loadingScreen.update(80,'Готовим игру с друзьями…');await loadingScreen.paint();await blur.compile();
    request=requestAnimationFrame(frame);loadingScreen.finish();setButtons();
    const invited=new URL(location.href).searchParams.get('room');
    if(invited){$('online-room').value=invited;await connect(invited);}
  }
  await load();
  // Small read-only diagnostics for acceptance; no client authority setters.
  window.__multiplayer={snapshot:()=>({roomId:network.room?.roomId,playerId:network.room?.sessionId,ready,
    tick:network.room?.state?.tick,signature:expectedSignature,actors:network.buffer.sample(performance.now(),network.room?.sessionId),
    meshes:models.size,localPhysicsSteps:0,citySeed:network.room?.state?.seed}),renderer:()=>renderer.info.render};
  window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(request);void network.leave();clearModels();city?.dispose();trafficAssets?.dispose();blur.dispose();renderer.dispose();},{once:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  return{retry:()=>location.reload()};
}
