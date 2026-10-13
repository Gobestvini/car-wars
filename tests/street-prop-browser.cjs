// Separate real WebGL acceptance harness; hooks are injected into the dev response only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const out = 'docs/knowledge/street-props-0095';
const url = process.env.CARWARS_BASE_URL || 'http://localhost:5173';
fs.mkdirSync(out,{recursive:true});
const report = { date:'2026-10-13',errors:[],matrix:[],screenshots:[],profiles:[] };
const hook = `window.propCheck={sim,scene,camera,settings,wanted,reset,traffic,render:()=>renderFrame(),
  city:()=>cityState,signals:()=>trafficSignals,setCameraMode};\n`;

(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl']});
  try {
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]) for(const quality of ['Лёгкая','Высокая']) {
      console.log('matrix',viewport.width,quality);
      const page=await browser.newPage({viewport,hasTouch:viewport.width===390});
      page.on('pageerror',e=>report.errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
      await page.addInitScript(quality=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,
        values:{quality,trafficCount:0,policeCount:0,blurStrength:0,roadWidth:15}})),quality);
      await page.route('**/src/main.js*',async route=>{
        const response=await route.fetch();
        await route.fulfill({response,body:(await response.text()).replace('window.carLab = {',hook+'window.carLab = {')});
      });
      await page.goto(`${url}/?play=1&seed=42#debug`);
      assert.equal(await page.title(),'Car Stars');
      await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:120000});
      if(await page.evaluate(()=>carLab.startScreen().open))await page.locator('#menu-play').click();
      await page.waitForFunction(()=>carLab.appearance().player==='active'&&!carLab.startScreen().open);
      await page.evaluate(()=>carLab.setDebugCitySeed(42));
      await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
      const keyboard=await page.evaluate(()=>carLab.telemetry().speed);
      assert.ok(keyboard>5,`keyboard speed ${keyboard}`);
      let touch=null;
      if(viewport.width===390) {
        await page.evaluate(()=>propCheck.reset());
        const session=await page.context().newCDPSession(page);
        await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:630}]});
        await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y:540}]});
        await page.waitForTimeout(1500);
        touch=await page.evaluate(()=>({speed:carLab.telemetry().speed,marker:getComputedStyle(document.getElementById('touch-marker')).display}));
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        assert.ok(touch.speed>5);assert.equal(touch.marker,'block');await session.detach();
      }
      const checks=await page.evaluate(async()=>{
        const {PROP_PHYSICS}=await import('/src/street-prop-config.js');
        const {sim,wanted}=propCheck,city=propCheck.city(),m=city.propPhysics;
        const results=[];
        function tick() {
          m.beforeStep(1/120,[{body:sim.body,player:true}]);
          sim.prepare({},1/120);sim.world.step(1/120);sim.postStep(1/120);
          const events=m.afterStep(1/120); wanted.update(1/120,events); m.syncVisuals();
          return events;
        }
        function launch(entry,speed,reverse=false,reset=true) {
          if(reset)propCheck.reset();
          const spec=PROP_PHYSICS[entry.type],half=entry.type==='bin'?.26:entry.type==='bench'?.325:.1;
          const distance=2.08+half+.001;
          // Approach from the road/seat side, not through a neighbouring building.
          const travelYaw=entry.yaw+Math.PI;
          const sx=Math.sin(travelYaw),sz=Math.cos(travelYaw);
          sim.body.position.set(entry.x-sx*distance,entry.y+.55,entry.z-sz*distance);
          sim.body.quaternion.setFromEuler(0,travelYaw+(reverse?Math.PI:0),0);
          sim.body.previousPosition.copy(sim.body.position);sim.body.previousQuaternion.copy(sim.body.quaternion);
          sim.body.velocity.set(sx*speed/3.6,0,sz*speed/3.6);sim.body.angularVelocity.setZero();
          sim.body.aabbNeedsUpdate=true;sim.body.wakeUp();
        }
        for(const type of ['bin','bench','lamp','signal']) for(const speed of [10,60]) {
          const entry=m.entries.find(e=>e.type===type); launch(entry,speed);
          let events=[]; const initial=speed;
          events.push(...tick()); const after=Math.hypot(sim.body.velocity.x,sim.body.velocity.z)*3.6;
          for(let i=0;i<30;i++)events.push(...tick());
          results.push({type,speed,initial,after,state:entry.state,stars:wanted.snapshot().level,events:events.length,
            angular:entry.body.angularVelocity.length(),position:{...entry.body.position},source:{x:entry.x,z:entry.z}});
          if(speed===60) {
            for(let i=0;i<600;i++)tick();
            results[results.length-1].expired=entry.state;
          }
        }
        const pole=m.entries.find(e=>e.type==='signal');launch(pole,10);
        let events=[];
        for(let i=0;i<1200;i++) {
          sim.body.velocity.set(-Math.sin(pole.yaw)*10/3.6,0,-Math.cos(pole.yaw)*10/3.6);events.push(...tick());
        }
        const held=wanted.snapshot().level;
        sim.body.position.set(pole.x+Math.sin(pole.yaw)*8,pole.y+.55,pole.z+Math.cos(pole.yaw)*8);sim.body.velocity.setZero();
        for(let i=0;i<70;i++)tick();
        launch(pole,10,false,false);
        for(let i=0;i<20;i++)tick();
        const repeated=wanted.snapshot().level;
        launch(pole,60,true);tick();const reverse={state:pole.state,stars:wanted.snapshot().level};
        const index=city.signalApproaches.findIndex(a=>pole.id===`signal:${a.nodeId}:${a.fromId}`);
        for(const quality of ['low','high'])for(const time of [0,10,40,80])city.updateSignals(propCheck.signals(),time,null,quality);
        const signal={destroyed:city.signalApproaches[index].destroyed,beam:city.signalBeam.userData.visibleApproachIndices.includes(index)};
        propCheck.reset();
        const counts=[];
        for(let i=0;i<3;i++) {
          const entries=propCheck.city().propPhysics.entries;
          for(const e of entries.slice(0,25))propCheck.city().propPhysics.detach(e,{body:sim.body},{x:0,z:1},60);
          const oldest=entries[0].state,detached=propCheck.city().propPhysics.debris.length;
          propCheck.reset();const resetState=propCheck.city().propPhysics.entries.every(e=>e.state==='intact');
          carLab.rebuildCity(15);counts.push({bodies:carLab.worldBodies(),oldest,detached,resetState});
        }
        const rounds=[];for(let i=0;i<3;i++){carLab.newRound();rounds.push({seed:carLab.city().seed,bodies:carLab.worldBodies()});}
        carLab.setDebugCitySeed(42);
        return {results,held,repeated,reverse,signal,counts,rounds};
      });
      report.matrix.push({viewport,quality,keyboard,touch,...checks});
      for(const result of checks.results) {
        assert.equal(result.state,result.speed===10?'intact':'detached',JSON.stringify(result));
        assert.equal(result.stars,1);assert.equal(result.events,1);
        if(result.speed===60){assert.ok(result.after>=30);assert.equal(result.expired,'removed');assert.ok(result.angular>0);}
      }
      assert.equal(checks.held,1);assert.equal(checks.repeated,2);assert.deepEqual(checks.reverse,{state:'detached',stars:1});
      assert.deepEqual(checks.signal,{destroyed:true,beam:false});
      assert.equal(new Set(checks.counts.map(c=>c.bodies)).size,1);
      assert.ok(checks.counts.every(c=>c.oldest==='removed'&&c.detached===24&&c.resetState));
      // End-to-end crime goes through the running main loop, then its police policy.
      await page.evaluate(()=>carLab.setDebugPoliceCount(1));
      await page.waitForFunction(()=>carLab.police().length===1 && carLab.police()[0].state==='idle' && propCheck.traffic.states
        .filter(s=>s.role==='police').every(s=>s.appearance?.stage!=='appearing'));
      const policeBefore=await page.evaluate(()=>({level:carLab.wanted().level,state:carLab.police()[0].state}));
      await page.evaluate(()=>{
        const e=propCheck.city().propPhysics.entries.find(e=>e.type==='signal'),yaw=e.yaw+Math.PI;
        const body=propCheck.sim.body,dist=2.181;
        body.position.set(e.x-Math.sin(yaw)*dist,e.y+.55,e.z-Math.cos(yaw)*dist);
        body.quaternion.setFromEuler(0,yaw,0);body.previousPosition.copy(body.position);body.previousQuaternion.copy(body.quaternion);
        body.velocity.set(Math.sin(yaw)*10/3.6,0,Math.cos(yaw)*10/3.6);body.angularVelocity.setZero();body.aabbNeedsUpdate=true;
      });
      await page.waitForFunction(()=>carLab.wanted().level===1 && carLab.police()[0]?.state!=='idle');
      const policeAfter=await page.evaluate(()=>({wanted:carLab.wanted(),police:carLab.police()[0]}));
      assert.equal(policeBefore.level,0);assert.equal(policeBefore.state,'idle');
      assert.equal(policeAfter.wanted.lastViolation,'property-collision');assert.equal(policeAfter.police.pursuit.wantedLevel,1);
      report.matrix[report.matrix.length-1].policeReaction={before:policeBefore,after:policeAfter};
      await page.evaluate(()=>{carLab.setDebugPoliceCount(0);propCheck.reset();});
      for(const type of ['bench','lamp','bin','signal']) {
        await page.evaluate(type=>{
          const e=propCheck.city().propPhysics.entries.find(e=>e.type===type);
          carLab.setDebugCamera([e.x+6,e.y+7,e.z+8],[e.x,e.y+1,e.z]);
        },type);
        await page.waitForTimeout(200);
        const name=`${viewport.width}-${quality==='Лёгкая'?'low':'high'}-${type}.png`;
        await page.screenshot({path:`${out}/${name}`});report.screenshots.push(name);
      }
      await page.close();
      fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
    }
    assert.deepEqual(report.errors,[]);
    console.log(JSON.stringify({matrix:report.matrix.length,errors:report.errors}));
  } finally {await browser.close();}
})().catch(error=>{fs.writeFileSync(`${out}/report.json`,JSON.stringify({...report,failure:error.stack},null,2));console.error(error);process.exitCode=1;});
