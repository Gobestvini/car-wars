// Independent QA supplement: dev-response-only pose/time hooks, no source edits.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=__dirname,root=process.cwd(),base='http://127.0.0.1:5173';
const report={date:'2026-10-19',environment:'Windows Edge headless WebGL; viewport/touch emulation; DPR 1',pairs:[],compositionMismatches:[],effects:[],gestures:[],errors:[]};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const common=`function projection(group){const a=new THREE.Vector3(0,0,2.2).applyQuaternion(group.quaternion).add(group.position).project(camera),b=new THREE.Vector3(0,0,-2.2).applyQuaternion(group.quaternion).add(group.position).project(camera),p=group.position.clone().project(camera);return {x:(p.x+1)/2,y:(1-p.y)/2,length:Math.hypot((a.x-b.x)*innerWidth/2,(a.y-b.y)*innerHeight/2)};}`;
const offlineHook=common+`
window.__qa={sim,car,camera,city:()=>cityState,input:()=>getInput(),quality(value){settings.values.quality=value==='low'?'Лёгкая':'Высокая';applyQuality();},
  pose(p,speed,yaw=0){cancelPlayerAppearance();sim.spawn={x:p[0],y:p[1],z:p[2],yaw};sim.reset();sim.body.velocity.set(0,0,speed/3.6);cameraDistanceScale=targetCameraScale(speed);},
  read:()=>({camera:{...carLab.camera(),fov:camera.fov},screen:projection(car),blur:miniatureBlur.snapshot(),shadow:carLab.shadow(),occlusion:buildingEntries.filter(e=>e.opacity<.99).map(e=>({id:e.id,opacity:e.opacity})),pose:car.position.toArray()})};
stepper.advance=()=>({alpha:1,steps:0});
`;
const onlineHook=common+`
window.__qa={network,city:()=>city,input:()=>network.input,fixed:null,
  pose(p,speed,yaw=0){const own=lastRenderedActors.find(a=>a.id===network.room.sessionId);this.fixed=JSON.parse(JSON.stringify(own));const old=new THREE.Vector3().fromArray(own.pose),destination=new THREE.Vector3().fromArray(p),delta=new THREE.Quaternion(0,Math.sin(yaw/2),0,Math.cos(yaw/2)).multiply(new THREE.Quaternion().fromArray(own.pose,3).invert());for(let i=0;i<this.fixed.wheels.length;i+=7)new THREE.Vector3().fromArray(this.fixed.wheels,i).sub(old).applyQuaternion(delta).add(destination).toArray(this.fixed.wheels,i);this.fixed.pose.splice(0,10,...p,0,Math.sin(yaw/2),0,Math.cos(yaw/2),0,0,speed/3.6);followCamera.scale=targetScale(speed);network.prediction.advance=()=>{};network.prediction.sample=()=>[this.fixed];network.prediction.world.sample=()=>[this.fixed];},
  read:()=>({camera:__multiplayer.camera(),screen:projection(models.get(network.room.sessionId).group),blur:blur.snapshot(),shadow:{enabled:renderer.shadowMap.enabled,mapSize:sun.shadow.mapSize.toArray()},occlusion:city.entries.filter(e=>e.opacity<.99).map(e=>({id:e.id,opacity:e.opacity})),pose:models.get(network.room.sessionId).group.position.toArray()})};
function targetScale(speed){const t=Math.max(0,Math.min(1,(speed-15)/95));return 1+.7*t*t*(3-2*t);}
`;
async function open(browser,viewport,online){
 const p=await browser.newPage({viewport,hasTouch:true});
 p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await p.addInitScript(()=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{quality:'Высокая',trafficCount:0,policeCount:0,roadWidth:15}})));
 await p.route(online?'**/src/multiplayer/game.js*':'**/src/main.js*',async route=>{const r=await route.fetch();const text=await r.text();await route.fulfill({response:r,body:online?text.replace('window.__multiplayer={snapshot:',onlineHook+'window.__multiplayer={snapshot:'):text.replace('window.carLab = {',offlineHook+'window.carLab = {')});});
 await p.goto(`${base}/?${online?'online=1&netdebug=1':'offline=1&play=1&seed=42#debug'}`);
 if(online){await p.locator('#online-create').click();await p.waitForFunction(()=>window.__multiplayer?.snapshot().ready&&__multiplayer.camera().subject!==null,null,{timeout:120000});}
 else await p.waitForFunction(()=>window.carLab?.modelReady&&document.body.dataset.loading==='false'&&!carLab.startScreen().open,null,{timeout:120000});
 await p.waitForFunction(()=>document.body.dataset.loading==='false');return p;
}
(async()=>{
 process.env.CARWARS_FIXED_SEED='42';const {startHostedServer}=await import('../../../tools/multiplayer-spike/deploy/server.js');
 const service=await startHostedServer({port:2577,host:'127.0.0.1'}),browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
 try{
  for(const [width,height] of [[1440,900],[390,844],[844,390]]){
   const viewport={width,height},on=await open(browser,viewport,true),off=await open(browser,viewport,false);
   const pos=await on.evaluate(()=>__multiplayer.snapshot().actors.find(a=>a.id===__multiplayer.snapshot().playerId).pose.slice(0,3));
   for(const speed of [0,110]){
    for(const page of [off,on])await page.evaluate(({pos,speed})=>__qa.pose(pos,speed),{pos,speed});
    await on.waitForTimeout(300);const a=await off.evaluate(()=>__qa.read()),b=await on.evaluate(()=>__qa.read());
    report.pairs.push({viewport,speedKmh:speed,position:pos,offline:a,online:b,loadingOverlay:false});
    a.camera.position.forEach((x,i)=>near(x,b.camera.position[i]));a.camera.target.forEach((x,i)=>near(x,b.camera.target[i]));
    if(['x','y','length'].some(k=>Math.abs(a.screen[k]-b.screen[k])>=1e-5))report.compositionMismatches.push({viewport,speedKmh:speed,offlineFov:a.camera.fov,onlineFov:b.camera.fov,offlineScreen:a.screen,onlineScreen:b.screen,lengthRatio:b.screen.length/a.screen.length});
    near(a.camera.scale,speed===0?1:1.7);near(b.camera.scale,a.camera.scale);
    for(const [mode,page]of [['offline',off],['online',on]])await page.screenshot({path:path.join(out,`paired-${mode}-${width}x${height}-${speed}kmh.png`)});
   }
   // Yaw changes the car orientation but must leave the camera world direction fixed.
   await on.evaluate(pos=>__qa.pose(pos,0,1.2),pos);await on.waitForTimeout(80);const yaw=await on.evaluate(()=>__qa.read());
   near(yaw.camera.position[0]-yaw.camera.target[0],16.8*(width<700?1.05:height<500?.82:1));
   if(width===1440){
    const blocking=await on.evaluate(()=>{const e=__qa.city().entries.find(e=>e.height>10&&e.width>8&&e.depth>8);return[e.bounds.min.x-2,.96,e.bounds.max.z+2];});
    for(const page of [off,on])await page.evaluate(p=>__qa.pose(p,0),blocking);
    await on.waitForTimeout(650);
    for(const quality of ['high','low']){
     if(quality==='low'){await on.locator('#online-quality').click();await off.evaluate(()=>__qa.quality('low'));await on.waitForTimeout(100);}
     const a=await off.evaluate(()=>__qa.read()),b=await on.evaluate(()=>__qa.read());
     assert.ok(a.occlusion.length&&b.occlusion.length);assert.ok(a.blur.enabled&&b.blur.enabled);assert.equal(a.blur.failure,null);assert.equal(b.blur.failure,null);assert.ok(a.shadow.enabled&&b.shadow.enabled);
     report.effects.push({quality,offline:a,online:b});await on.screenshot({path:path.join(out,`occlusion-online-${quality}.png`)});await off.screenshot({path:path.join(out,`occlusion-offline-${quality}.png`)});
    }
   }
   if(width===390){
    for(const page of [off,on])await page.evaluate(p=>__qa.pose(p,0),pos);
    for(const [direction,end]of [['up',[195,540]],['right',[285,630]]]){
     const inputs=[];
     for(const page of [off,on]){
      const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:630}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:end[0],y:end[1]}]});await page.waitForTimeout(100);inputs.push(await page.evaluate(()=>__qa.input()));await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
     }
     for(const key of ['steer','throttle','brake'])near(inputs[0][key],inputs[1][key]);report.gestures.push({direction,offline:inputs[0],online:inputs[1]});
    }
   }
   await on.evaluate(()=>__qa.network.leave());await on.close();await off.close();console.log(`QA paired camera ${width}x${height} recorded`);
  }
  assert.deepEqual(report.errors,[]);
 }finally{await browser.close();await service.close();fs.writeFileSync(path.join(out,'camera-spot-report.json'),JSON.stringify(report,null,2));}
})().catch(e=>{report.failure=e.stack;fs.writeFileSync(path.join(out,'camera-spot-report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
