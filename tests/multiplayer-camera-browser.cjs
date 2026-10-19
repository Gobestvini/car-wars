// Real WebGL acceptance. Operator hooks exist only in intercepted dev responses.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const spikeRequire=createRequire(path.resolve('tools/multiplayer-spike/package.json'));
const {matchMaker}=spikeRequire('@colyseus/core');
const out=process.env.ARTIFACT_DIR||'docs/knowledge/multiplayer/2026-10-19-camera';
const base=process.env.CARWARS_BASE_URL||'http://127.0.0.1:5173';
const report={date:'2026-10-19',matrix:[],lifecycle:[],errors:[],device:'Windows Edge headless WebGL; touch emulation'};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(condition){const end=Date.now()+15000;while(!condition()){if(Date.now()>end)throw Error('Operator fixture timeout');await delay(30);}}
async function inspect(page){
  const data=await page.evaluate(()=>{const s=__multiplayer.snapshot();return{camera:__multiplayer.camera(),own:s.actors.find(a=>a.id===s.playerId),roomId:s.roomId,playerId:s.playerId};});
  const {camera:c,own:a}=data;assert.ok(a);assert.equal(c.subject,`${a.id}:${a.generation}`);
  const {width,height}=page.viewportSize(),v=width<700?1.05:height<500?.82:1;
  near(c.target[0],a.pose[0]);near(c.target[1],.5);near(c.target[2],a.pose[2]);
  near(c.position[0]-c.target[0],16.8*v*c.scale);near(c.position[1]-.5,28*v*c.scale);near(c.position[2]-c.target[2],-23.8*v*c.scale);
  assert.equal(c.fov,50);return data;
}
async function openOnline(browser,viewport,roomId){
  const page=await browser.newPage({viewport,hasTouch:true});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/src/multiplayer/game.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('window.__multiplayer={snapshot:',`window.__cameraHarness={network};window.__multiplayer={snapshot:`)});});
  await page.goto(`${base}/?online=1&netdebug=1`);
  await page.waitForSelector('#online-create',{timeout:120000});
  if(roomId){await page.locator('#online-room').fill(roomId);await page.locator('#online-join').click();}else await page.locator('#online-create').click();
  await page.waitForFunction(()=>window.__multiplayer?.snapshot().ready&&__multiplayer.camera().subject!==null,null,{timeout:120000});return page;
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});process.env.CARWARS_FIXED_SEED='42';
  const {startHostedServer}=await import('../tools/multiplayer-spike/deploy/server.js');
  const server=await startHostedServer({port:2577,host:'127.0.0.1'});
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
  try{
    for(const [width,height]of [[1440,900],[390,844],[844,390]]){
      const viewport={width,height},offline=await browser.newPage({viewport});
      offline.on('pageerror',e=>report.errors.push(e.message));
      await offline.addInitScript(()=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{quality:'Высокая',trafficCount:0,policeCount:0}})));
      await offline.goto(`${base}/?offline=1&play=1&seed=42#debug`);await offline.waitForFunction(()=>window.carLab?.modelReady&&document.body.dataset.loading==='false'&&document.getElementById('loading-screen').hidden,null,{timeout:120000});
      const offlineCamera=await offline.evaluate(()=>carLab.camera());
      await offline.screenshot({path:path.join(out,`after-offline-${width}x${height}.png`)});await offline.close();
      const page=await openOnline(browser,viewport),initial=await inspect(page);
      near(initial.camera.scale,1);
      near(initial.camera.fov,offlineCamera.fov);
      const v=width<700?1.05:height<500?.82:1;
      near(initial.camera.position[1],offlineCamera.position[1]);near(initial.camera.position[0]-initial.camera.target[0],offlineCamera.position[0]-offlineCamera.target[0]);
      await page.screenshot({path:path.join(out,`after-online-${width}x${height}.png`)});
      await page.keyboard.down('KeyW');await page.waitForTimeout(1300);await page.keyboard.down('KeyD');await page.waitForTimeout(300);await page.keyboard.up('KeyD');await page.keyboard.up('KeyW');
      const driving=await inspect(page);assert.ok(driving.own.pose.slice(7,10).some(x=>Math.abs(x)>.1));
      await page.keyboard.down('KeyS');await page.waitForTimeout(600);await page.keyboard.up('KeyS');await inspect(page);
      await page.locator('#online-quality').click();await inspect(page);await page.locator('#online-quality').click();
      await page.setViewportSize({width:width===1440?390:1440,height:width===1440?844:900});await page.waitForTimeout(100);await inspect(page);await page.setViewportSize(viewport);
      const generation=driving.own.generation;await page.keyboard.press('KeyR');
      await page.waitForFunction(g=>__multiplayer.snapshot().actors.find(a=>a.id===__multiplayer.snapshot().playerId)?.generation>g,generation);
      const respawn=await inspect(page);near(respawn.camera.scale,1);
      if(width===390){
        const session=await page.context().newCDPSession(page);
        await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:650}]});
        await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y:560}]});await page.waitForTimeout(700);
        const gesture=await page.evaluate(()=>({knob:document.getElementById('touch-marker').firstElementChild.style.transform,throttle:__cameraHarness.network.input.throttle}));
        assert.notEqual(gesture.knob,'translate(0px, 0px)');assert.notEqual(gesture.throttle,0);
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();await inspect(page);
      }
      report.matrix.push({viewport,viewportFactor:v,offlineCamera,initial,driving,respawn});
      await page.evaluate(()=>__cameraHarness.network.leave());await page.close();console.log(`camera ${width}x${height} passed`);
    }
    const pages=[await openOnline(browser,{width:1440,height:900})];
    const roomId=(await inspect(pages[0])).roomId;
    pages.push(await openOnline(browser,{width:390,height:844},roomId),await openOnline(browser,{width:844,height:390},roomId));
    for(const p of pages)await p.keyboard.down('KeyW');await delay(500);for(const p of pages)await p.keyboard.up('KeyW');
    const three=await Promise.all(pages.map(inspect));assert.equal(new Set(three.map(s=>s.playerId)).size,3);report.lifecycle.push({threePlayers:three});
    const room=matchMaker.getLocalRoomById(roomId),first=three[0].playerId;
    // Real side-on contact; the camera must keep its own displayed subject.
    [...room.sim.players.values()].forEach((p,i)=>{p.sim.spawn={x:0,y:1,z:i===1?5:i===0?-5:15,yaw:i===1?Math.PI:0};p.sim.reset();p.generation++;p.sim.body.velocity.set(0,0,i===0?15:i===1?-15:0);room.sim.halt(p.id);});
    await until(()=>[...room.sim.players.values()].some(p=>p.dents.length));for(const p of pages)await inspect(p);
    // Colyseus reconnect requires a connection older than five seconds.
    await delay(5500);room.clients.find(c=>c.sessionId===first).ref.terminate();
    await until(()=>!room.sim.players.get(first).connected);await until(()=>room.sim.players.get(first).connected);
    await pages[0].waitForFunction(()=>__multiplayer.snapshot().ready&&__cameraHarness.network.clockSynced);
    report.lifecycle.push({reconnect:await inspect(pages[0])});
    for(let i=1;i<pages.length;i++){await pages[i].evaluate(()=>__cameraHarness.network.leave());await pages[i].close();}
    await pages[0].locator('#online-share').click();await pages[0].locator('#online-leave').click();await pages[0].locator('#online-create').click();
    await pages[0].waitForFunction(old=>__multiplayer.snapshot().ready&&__multiplayer.snapshot().roomId!==old&&__multiplayer.camera().subject!==null,roomId);
    report.lifecycle.push({newRoom:await inspect(pages[0])});await pages[0].evaluate(()=>__cameraHarness.network.leave());await pages[0].close();
    assert.deepEqual(report.errors,[]);console.log('camera three clients, collision, reconnect and room replacement passed');
  }finally{await browser.close();await server.close();fs.writeFileSync(path.join(out,'after.json'),JSON.stringify(report,null,2));}
})().catch(e=>{report.failure=e.stack;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'after.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
