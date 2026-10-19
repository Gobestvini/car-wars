// Operator fixtures advance real physics, not assigned post-collision poses.
// Clock pauses only make comparable WebGL frames possible; this is not a latency test.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),spike=createRequire(path.resolve('tools/multiplayer-spike/package.json'));
const {matchMaker}=spike('@colyseus/core');
const out=process.env.ARTIFACT_DIR||'docs/knowledge/qa-0109/lod-visual';
const base=process.env.CARWARS_BASE_URL||'http://127.0.0.1:5173';
const report={date:'2026-10-19',device:'Edge headless WebGL; mobile viewport emulation',errors:[],online:[],offline:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const onlineHook=`window.__npcHarness={network};
const npcStart=network.startPrediction.bind(network);network.startPrediction=(...args)=>{npcStart(...args);
const sample=network.prediction.sample.bind(network.prediction);
network.prediction.sample=(...a)=>sample(...a).filter(actor=>actor.role==='player');};`;
const offlineHook=`window.__npcHarness={sim,traffic,reset,city:()=>cityState,plan:()=>cityPlan,paused:false};
const npcAdvance=stepper.advance.bind(stepper);stepper.advance=(...args)=>__npcHarness.paused?{alpha:1,steps:0}:npcAdvance(...args);`;
function errors(page){page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});}
async function shot(page,name){await page.waitForTimeout(100);await page.screenshot({path:path.join(out,name+'.png')});}
(async()=>{
  fs.mkdirSync(out,{recursive:true});process.env.CARWARS_FIXED_SEED='42';
  const {startHostedServer}=await import('../../../tools/multiplayer-spike/deploy/server.js');
  const {sidewalkImpact,greenSignals,npcTrace}=await import('../../../tests/npc-sidewalk-fixture.js');
  const {edgeProgress}=await import('../../../src/traffic-planner.js');
  const {SpikeWorld}=await import('../../../tools/multiplayer-spike/world.js');
  const service=await startHostedServer({port:2577,host:'127.0.0.1'});
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
  try {
    const pages=[];let roomId;
    for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
      const page=await browser.newPage({viewport});errors(page);
      await page.route('**/src/multiplayer/game.js*',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('window.__multiplayer={snapshot:',onlineHook+'window.__multiplayer={snapshot:').replace('const focus=own?models.get(own.id).group:null;',"const focus=models.get('npc-0')?.group||(own?models.get(own.id).group:null);")});});
      await page.goto(`${base}/?online=1&netdebug=1`);await page.waitForSelector('#online-create',{timeout:120000});
      if(roomId){await page.locator('#online-room').fill(roomId);await page.locator('#online-join').click();}else await page.locator('#online-create').click();
      await page.waitForFunction(()=>window.__multiplayer?.snapshot().ready&&__multiplayer.snapshot().actors.length>=103,null,{timeout:120000});
      roomId=await page.evaluate(()=>__multiplayer.snapshot().roomId);pages.push(page);
    }
    const room=matchMaker.getLocalRoomById(roomId);let world=room.sim,step=world.step.bind(world);world.step=()=>{};
    // Each controlled collision starts from a fresh actual map/population.
    const resetProps=()=>{
      const old=world,next=new SpikeWorld({seed:42,npcCount:102});next.tick=Math.ceil((old.tick+12)/12)*12;
      for(const p of old.players.values()){const a=next.addPlayer(p.id);a.generation=p.generation+1;}
      for(const a of next.npcs)a.generation=(old.npcs.find(n=>n.id===a.id)?.generation||1)+1;
      world=room.sim=next;step=world.step.bind(world);world.step=()=>{};old.dispose();
    };
    async function observe(f,label) {
      room.onBeforePatch();const target={x:f.actor.sim.body.position.x,z:f.actor.sim.body.position.z};
      const observations=[];
      for(let i=0;i<pages.length;i++) {
        await pages[i].waitForFunction(({id,x,z,tick})=>{const frame=__npcHarness.network.buffer.frames.at(-1),a=frame?.actors.get(id);
          return frame.tick>=tick&&a&&Math.hypot(a.pose[0]-x,a.pose[2]-z)<.001;},{id:f.actor.id,...target,tick:world.tick},{timeout:15000});
        observations.push(await pages[i].evaluate(id=>{const s=__multiplayer.snapshot(),a=s.actors.find(a=>a.id===id);return{id:a.id,pose:a.pose,
          authoritative:__npcHarness.network.buffer.frames.at(-1).actors.get(id).pose,count:s.actors.length};},f.actor.id));
      }
      await shot(pages[0],label);return{server:npcTrace(world,f.actor),prop:f.prop.state,observations};
    }
    for(const options of [{type:'bin',speed:16},{type:'lamp',speed:16},{type:'bin',speed:2,choice:3}]) {
      resetProps();world.signals=greenSignals;world.junctionOwners.clear();
      const f=sidewalkImpact(world,options),samples=[];const key=options.type+'-'+options.speed;
      for(let i=0;i<36;i++)step();samples.push(await observe(f,key+'-contact'));
      for(let i=36;i<240;i++)step();samples.push(await observe(f,key+'-recovery'));
      for(let i=240;i<1200;i++)step();samples.push(await observe(f,key+'-clear'));
      const progress=edgeProgress(f.actor.sim.body.position,f.edge)-edgeProgress(f.initial,f.edge);
      assert.ok(progress>3,`${key} ${progress}`);assert.equal(f.prop.state,options.speed===2?'intact':'removed');
      assert.ok(f.actor.sim.wheels.every(w=>!w.detached));report.online.push({options,progress,samples});
    }
    // Leave/return the physical zone on the same surviving NPC.
    const actor=world.npcs[0];for(const [i,p]of [...world.players.values()].entries())p.sim.body.position.set(500+i*10,1,500);
    for(let i=0;i<1200;i++)step();
    report.lod={far:actor.physical};assert.equal(actor.physical,false);room.onBeforePatch();await shot(pages[0],'desktop-far');
    const player=[...world.players.values()][0];player.sim.body.position.set(actor.sim.body.position.x+12,1,actor.sim.body.position.z);
    for(let i=0;i<24;i++)step();report.lod.near=actor.physical;assert.equal(actor.physical,true);
    room.onBeforePatch();await shot(pages[0],'desktop-return');await pages[0].setViewportSize({width:390,height:844});await shot(pages[0],'mobile-return');
    for(const p of pages){await p.evaluate(()=>__npcHarness.network.leave());await p.close();}

    assert.equal(report.online.length,3);assert.equal(report.lod.near,true);assert.deepEqual(report.errors,[]);report.pass=true;console.log('NPC focused supplemental WebGL: three clients, strong/weak contact and LOD frames passed');
  }finally{await browser.close();await service.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
})().catch(e=>{report.failure=e.stack;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
