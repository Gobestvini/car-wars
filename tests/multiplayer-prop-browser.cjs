// Real contacts on a local hosted server; transparent poses may then be frozen
// by dev-response-only hooks to take comparable screenshots at known ages.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),spikeRequire=createRequire(path.resolve('tools/multiplayer-spike/package.json'));
const {matchMaker}=spikeRequire('@colyseus/core');
const out=process.env.ARTIFACT_DIR||'docs/knowledge/multiplayer/2026-10-19-props';
const base=process.env.CARWARS_BASE_URL||'http://127.0.0.1:5173';
const report={date:'2026-10-19',mode:'three real WebGL clients; operator-controlled screenshot ages',types:[],errors:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test){const end=Date.now()+15000;while(!test()){if(Date.now()>end)throw Error('Hosted prop fixture timeout');await delay(10);}}
const hook=`window.__propHarness={network,city:()=>city,registry:()=>streetVisuals,target:null,frozen:false,autoFreeze:false};
const startPropsPrediction=network.startPrediction.bind(network);
network.startPrediction=(...args)=>{startPropsPrediction(...args);const advance=network.prediction.advance.bind(network.prediction);
network.prediction.advance=(...a)=>{const h=window.__propHarness;if(h.frozen)return;const result=advance(...a);
if(h.autoFreeze&&network.prediction.world.props.entries.some(e=>e.id===h.target&&e.state==='detached'))h.frozen=true;return result;};};
`;
async function lobby(browser,viewport){
  const page=await browser.newPage({viewport});page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/src/multiplayer/game.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('window.__multiplayer={snapshot:',hook+'window.__multiplayer={snapshot:')});});
  await page.goto(`${base}/?online=1&netdebug=1`);await page.waitForFunction(()=>window.__multiplayer,null,{timeout:120000});return page;
}
async function join(page,id){
  if(id){await page.locator('#online-room').fill(id);await page.locator('#online-join').click();}else await page.locator('#online-create').click();
  await page.waitForFunction(()=>__multiplayer.snapshot().ready&&__multiplayer.snapshot().actors.length>0,null,{timeout:120000});
  return page.evaluate(()=>__multiplayer.snapshot().roomId);
}
async function read(page,id){return page.evaluate(id=>{
  const h=__propHarness,p=h.network.prediction.world,e=p.props.entries.find(e=>e.id===id);
  const record=[...h.city().propFade.active.values()].find(r=>r.group.userData.propId===id);
  return{id,state:e.state,age:p.props.clock-e.destroyedAt,physical:p.world.bodies.includes(e.body),
    alpha:record?.meshes.map(m=>m.material.opacity),sizes:record?.meshes.map(m=>m.matrix.determinant()),pool:h.city().propFade.stats(),
    registry:h.registry().entries.get(id).state};
},id);}
(async()=>{
  fs.mkdirSync(out,{recursive:true});process.env.CARWARS_FIXED_SEED='42';
  const {startHostedServer}=await import('../tools/multiplayer-spike/deploy/server.js');
  const service=await startHostedServer({port:2577,host:'127.0.0.1'}),browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
  const pages=[];
  try{
    pages.push(await lobby(browser,{width:1440,height:900}));const roomId=await join(pages[0]);
    pages.push(await lobby(browser,{width:390,height:844}));await join(pages[1],roomId);
    pages.push(await lobby(browser,{width:844,height:390}));
    const room=matchMaker.getLocalRoomById(roomId),world=room.sim;
    for(const type of ['bin','bench','lamp','signal','tree']){
      const e=world.props.entries.find(e=>e.type===type);
      for(const page of pages)await page.evaluate(id=>{__propHarness.target=id;__propHarness.autoFreeze=true;__propHarness.frozen=false;},e.id);
      const player=[...world.players.values()][0],yaw=e.yaw+Math.PI,fx=Math.sin(yaw),fz=Math.cos(yaw);
      player.sim.spawn={x:e.x-fx*2.5,y:e.y+.65,z:e.z-fz*2.5,yaw};player.sim.reset();player.generation++;
      player.sim.body.velocity.set(fx*20,0,fz*20);world.halt(player.id);
      await until(()=>e.state==='detached');assert.equal(world.world.bodies.includes(e.body),false);
      const active=type==='bin'?pages.slice(0,2):pages;
      await Promise.all(active.map(page=>page.waitForFunction(()=>__propHarness.frozen&&[...__propHarness.city().propFade.active.values()].some(r=>r.group.userData.propId===__propHarness.target))));
      if(type==='bin'){
        // Pause simulation time, not the network, to keep the short-lived state
        // available while the already-loaded late client verifies/builds its map.
        const step=world.step;world.step=()=>{};
        try{await join(pages[2],roomId);await pages[2].waitForFunction(()=>__propHarness.frozen&&__propHarness.registry().entries.get(__propHarness.target)?.state==='detached');}
        finally{world.step=step;}
        report.lateJoinDetached=true;
      }
      const early=await Promise.all(pages.map(p=>read(p,e.id)));
      for(const s of early){assert.equal(s.state,'detached');assert.equal(s.physical,false);assert.equal(s.registry,'detached');assert.ok(s.alpha?.length);
        s.alpha.forEach(a=>assert.ok(a>0&&a<=.45));assert.ok(s.pool.active<=24&&s.pool.idle<=24);}
      await pages[0].screenshot({path:path.join(out,`${type}-early.png`)});
      await Promise.all(pages.map(p=>p.evaluate(id=>{const props=__propHarness.network.prediction.world.props,e=props.entries.find(e=>e.id===id);props.clock=e.destroyedAt+.375;},e.id)));
      await delay(40);const middle=await Promise.all(pages.map(p=>read(p,e.id)));
      middle.forEach((s,i)=>{s.alpha.forEach(a=>assert.ok(Math.abs(a-.225)<1e-5));assert.deepEqual(s.sizes,early[i].sizes);});
      await pages[0].screenshot({path:path.join(out,`${type}-middle.png`)});
      for(const p of pages)await p.evaluate(()=>{__propHarness.autoFreeze=false;__propHarness.frozen=false;});
      await until(()=>e.state==='removed');
      await Promise.all(pages.map(p=>p.waitForFunction(()=>{const h=__propHarness;return h.network.prediction.world.props.entries.find(e=>e.id===h.target)?.state==='removed'&&!([...h.city().propFade.active.values()].some(r=>r.group.userData.propId===h.target));})));
      const removed=await Promise.all(pages.map(p=>read(p,e.id)));removed.forEach(s=>assert.equal(s.physical,false));
      await pages[0].screenshot({path:path.join(out,`${type}-gone.png`)});
      report.types.push({type,id:e.id,early,middle,removed});console.log(`three-client ${type} ghost passed`);
    }
    const extra=world.props.entries.find(e=>e.type==='bin'&&e.state==='intact');
    const actors=[...world.players.values()],yaw=extra.yaw+Math.PI,fx=Math.sin(yaw),fz=Math.cos(yaw);
    const launch=actor=>{actor.sim.spawn={x:extra.x-fx*2.5,y:extra.y+.65,z:extra.z-fz*2.5,yaw};actor.sim.reset();actor.generation++;
      actor.sim.body.velocity.set(fx*20,0,fz*20);world.halt(actor.id);};
    launch(actors[0]);await until(()=>extra.state==='detached');
    actors[0].sim.spawn={x:100,y:1,z:100,yaw:0};actors[0].sim.reset();actors[0].generation++;
    launch(actors[1]);const initial={...actors[1].sim.body.position},tick=world.tick;
    await until(()=>((actors[1].sim.body.position.x-initial.x)*fx+(actors[1].sim.body.position.z-initial.z)*fz)>3||world.tick-tick>75);
    const progress=(actors[1].sim.body.position.x-initial.x)*fx+(actors[1].sim.body.position.z-initial.z)*fz;
    assert.ok(progress>3,`following car progress ${progress}`);assert.equal(world.world.bodies.includes(extra.body),false);
    report.followingCar={progress,seconds:(world.tick-tick)/120,ghostState:extra.state,physical:false};
    await pages[2].locator('#online-share').click();await pages[2].locator('#online-leave').click();await join(pages[2],roomId);
    for(const item of report.types)assert.equal((await read(pages[2],item.id)).state,'removed');report.lateJoinRemoved=true;
    await delay(5500);const session=await pages[2].evaluate(()=>__multiplayer.snapshot().playerId);
    room.clients.find(c=>c.sessionId===session).ref.terminate();await until(()=>!world.players.get(session).connected);await until(()=>world.players.get(session).connected);
    await pages[2].waitForFunction(()=>__propHarness.network.clockSynced);
    for(const item of report.types)assert.equal((await read(pages[2],item.id)).state,'removed');report.reconnectRemoved=true;
    await pages[1].locator('#online-quality').click();await pages[1].screenshot({path:path.join(out,'mobile-low-removed.png')});
    for(const p of pages)await p.evaluate(()=>__propHarness.network.leave());assert.deepEqual(report.errors,[]);
  }finally{await browser.close();await service.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
})().catch(e=>{report.failure=e.stack;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
