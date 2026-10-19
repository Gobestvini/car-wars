// Operator fixtures advance real physics, not assigned post-collision poses.
// Clock pauses only make comparable WebGL frames possible; this is not a latency test.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),spike=createRequire(path.resolve('tools/multiplayer-spike/package.json'));
const {matchMaker}=spike('@colyseus/core');
const out=process.env.ARTIFACT_DIR||'docs/knowledge/multiplayer/2026-10-19-npc-liveness/browser';
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
  const {startHostedServer}=await import('../tools/multiplayer-spike/deploy/server.js');
  const {sidewalkImpact,greenSignals,npcTrace}=await import('./npc-sidewalk-fixture.js');
  const {edgeProgress}=await import('../src/traffic-planner.js');
  const {SpikeWorld}=await import('../tools/multiplayer-spike/world.js');
  const service=await startHostedServer({port:2577,host:'127.0.0.1'});
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
  try {
    const pages=[];let roomId;
    for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
      const page=await browser.newPage({viewport});errors(page);
      await page.route('**/src/multiplayer/game.js*',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('window.__multiplayer={snapshot:',onlineHook+'window.__multiplayer={snapshot:')});});
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
    // Actual signal and exit controls, after a real breaking hit.
    for(const mode of ['red','exit']) {
      resetProps();world.junctionOwners.clear();const f=sidewalkImpact(world,{type:'bin',speed:6,choice:3});
      world.signals=mode==='red'?{phase:()=>({color:'red',canEnter:false,controlled:true})}:greenSignals;
      if(mode==='exit'){const e=f.actor.outgoing,b=[...world.players.values()][0].sim.body;
        b.position.set(e.start.x+Math.sin(e.heading)*12.5,1,e.start.z+Math.cos(e.heading)*12.5);b.aabbNeedsUpdate=true;}
      for(let i=0;i<1440;i++)step();const waiting=await observe(f,mode+'-wait');
      assert.equal(f.actor.waitReason,mode==='red'?'signal-red':'blocked-junction-exit');
      const before={...f.actor.sim.body.position};world.signals=greenSignals;
      for(const p of world.players.values())p.sim.body.position.set(500,1,500);
      const releasedAt=world.tick;let continuedWait=null;
      // Clearing the operator's blocker does not revoke another NPC's valid,
      // already-entered reservation. Start the free-path clock after it exits.
      for(let i=0;i<2400;i++) {
        step();
        if(f.actor.targetSpeed>.3&&![ 'intersection-reservation','blocked-junction-exit','blocked-by-leader'].includes(f.actor.waitReason))break;
        if(i===359)continuedWait={server:npcTrace(world,f.actor),owner:world.npcDiagnostics().find(d=>d.id===world.junctionOwners.get(f.edge.to))};
        assert.ok(i<2399,JSON.stringify(world.npcDiagnostics().filter(d=>[f.actor.id,f.actor.blocker].includes(d.id))));
      }
      const freeAt=world.tick;for(let i=0;i<360;i++)step();const started=await observe(f,mode+'-started');
      assert.ok(Math.hypot(f.actor.sim.body.velocity.x,f.actor.sim.body.velocity.z)>.3);
      for(let i=0;i<840;i++)step();const clear=await observe(f,mode+'-clear');
      assert.ok(Math.hypot(f.actor.sim.body.position.x-before.x,f.actor.sim.body.position.z-before.z)>3);
      report.online.push({mode,waiting,continuedWait,waitForFreeSeconds:(freeAt-releasedAt)/120,started,clear});
    }
    // Leave/return the physical zone on the same surviving NPC.
    const actor=world.npcs[0];for(let i=0;i<1200;i++)step();
    report.lod={far:actor.physical};assert.equal(actor.physical,false);
    const player=[...world.players.values()][0];player.sim.body.position.set(actor.sim.body.position.x+12,1,actor.sim.body.position.z);
    for(let i=0;i<24;i++)step();report.lod.near=actor.physical;assert.equal(actor.physical,true);
    room.onBeforePatch();await shot(pages[1],'mobile-return');
    for(const p of pages){await p.evaluate(()=>__npcHarness.network.leave());await p.close();}

    for(const viewport of [{width:1440,height:900},{width:390,height:844}])for(const quality of ['Лёгкая','Высокая']) {
      const page=await browser.newPage({viewport});errors(page);
      await page.addInitScript(quality=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{quality,trafficCount:2,policeCount:0,blurStrength:0,roadWidth:15}})),quality);
      await page.route('**/src/main.js*',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('window.carLab = {',offlineHook+'window.carLab = {')});});
      await page.goto(`${base}/?offline=1&play=1&seed=42#debug`);
      await page.waitForFunction(()=>window.carLab?.modelReady&&document.body.dataset.loading==='false'&&document.getElementById('loading-screen').hidden,null,{timeout:120000});
      await page.waitForFunction(()=>__npcHarness.traffic.states.filter(s=>s.role==='civilian').length===2&&__npcHarness.traffic.states.every(s=>s.appearance?.stage!=='appearing'));
      await page.evaluate(()=>{__npcHarness.paused=true;__npcHarness.reset();});
      const checks=[];
      for(const options of [{type:'bin',speed:16},{type:'lamp',speed:16},{type:'bin',speed:2,choice:3}]) {
        const result=await page.evaluate(async options=>{
          const h=__npcHarness,city=h.city(),m=city.propPhysics,t=h.traffic;
          const {createRoadGraph}=await import('/src/traffic-ai.js');const {edgeProgress}=await import('/src/traffic-planner.js');
          const graph=createRoadGraph(h.plan().roadNetwork,3.75);h.reset();
          t.setSignalController({phase:()=>({color:'green',canEnter:true,controlled:true})});
          const choices=m.entries.filter(e=>e.type===options.type).flatMap(prop=>graph.directed.map(edge=>({prop,edge,
            along:edgeProgress(prop,edge),offset:Math.abs((prop.x-edge.start.x)*Math.cos(edge.heading)-(prop.z-edge.start.z)*Math.sin(edge.heading))})))
            .filter(c=>c.along>12&&c.along<c.edge.length-15&&c.offset<6).sort((a,b)=>a.offset-b.offset);
          const {prop,edge}=choices[options.choice||0],state=t.states[0],body=state.simulation.body,fx=Math.sin(edge.heading),fz=Math.cos(edge.heading);
          state.logical=false;if(!h.sim.world.bodies.includes(body))h.sim.world.addBody(body);
          const outgoing=graph.adjacency.get(edge.to).find(e=>Math.cos(e.heading-edge.heading)>.99)||graph.adjacency.get(edge.to).find(e=>e.to!==edge.from);
          body.position.set(prop.x-fx*2.5,prop.y+.96,prop.z-fz*2.5);body.quaternion.setFromEuler(0,edge.heading,0);
          body.velocity.set(fx*options.speed,0,fz*options.speed);body.angularVelocity.setZero();body.aabbNeedsUpdate=true;
          body.previousPosition.copy(body.position);body.previousQuaternion.copy(body.quaternion);
          const initial={...body.position};state.x=initial.x;state.z=initial.z;state.heading=edge.heading;
          Object.assign(state.ai,{fromNode:edge.from,targetNode:edge.to,route:[edge.to,outgoing.to],routeIndex:0,progressEdge:null,
            noProgressTime:0,maneuver:null,propBlocker:null,propManeuver:null});
          h.sim.body.position.set(initial.x+12,1,initial.z-15);h.sim.body.velocity.setZero();h.sim.body.aabbNeedsUpdate=true;
          const samples=[];let recoveryAt=null,contact=false;
          for(let i=0;i<1200;i++) {
            m.beforeStep(1/120,[{body:h.sim.body,player:true},...t.physicalActors().map(a=>({body:a.body,player:false}))]);
            t.stepWorld({brake:1},1/120);m.afterStep(1/120);m.syncVisuals();
            contact ||= h.sim.world.contacts.some(c=>c.bi===prop.body||c.bj===prop.body);
            if(state.ai.waitReason==='prop-recovery'&&recoveryAt===null)recoveryAt=i/120;
            if(i%120===119)samples.push({time:(i+1)/120,p:[body.position.x,body.position.y,body.position.z],reason:state.ai.waitReason,prop:prop.state});
          }
          carLab.setDebugCamera([body.position.x+10,22,body.position.z-12],[body.position.x,.5,body.position.z]);
          return {id:state.id,prop:prop.id,state:prop.state,progress:edgeProgress(body.position,edge)-edgeProgress(initial,edge),
            recoveryAt,contact,samples,count:t.states.length,wheels:state.simulation.wheels.map(w=>w.detached)};
        },options);
        assert.ok(result.progress>3,JSON.stringify(result));assert.equal(result.state,options.speed===2?'intact':'removed');
        if(options.speed===2){assert.equal(result.contact,true);assert.ok(result.recoveryAt<=3);}
        assert.equal(result.count,2);assert.ok(result.wheels.every(d=>!d));
        await shot(page,`offline-${viewport.width}-${quality==='Лёгкая'?'low':'high'}-${options.type}-${options.speed}`);
        checks.push({options,...result});
      }
      report.offline.push({viewport,quality,checks});await page.close();
    }
    assert.deepEqual(report.errors,[]);report.pass=true;console.log('NPC browser: three online clients, controls, LOD and four offline profiles passed');
  }finally{await browser.close();await service.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
})().catch(e=>{report.failure=e.stack;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
