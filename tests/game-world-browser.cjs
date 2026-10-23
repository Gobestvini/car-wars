const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=process.env.ARTIFACT_DIR||'docs/knowledge/multiplayer/2026-10-23-core/offline';
const report={date:'2026-10-23',mode:'offline shared core; Edge headless WebGL and touch emulation',errors:[],cases:[]};
const hook=`window.__coreHarness={gameWorld,sim,traffic,settings,applyQuality,city:()=>cityState,bodyDeformation:()=>bodyDeformation,reset};\n`;
(async()=>{
  fs.mkdirSync(out,{recursive:true});const {createServer}=await import('vite');
  const vite=await createServer({server:{host:'127.0.0.1',port:0}});await vite.listen();
  const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
  try{
    for(const mobile of [false,true]){
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
      const page=await context.newPage(),name=mobile?'portrait-low':'desktop-high';
      page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
      await page.route('**/src/main.js*',async route=>{const response=await route.fetch(),body=await response.text();
        assert.ok(body.includes('window.carLab = {'));await route.fulfill({response,body:body.replace('window.carLab = {',hook+'window.carLab = {')});});
      await page.goto(base+'/?offline=1&debug=1',{waitUntil:'domcontentloaded',timeout:120000});
      await page.waitForFunction(()=>window.carLab?.modelReady&&!document.querySelector('#loading-screen')?.offsetParent&&carLab.appearance().player==='active',null,{timeout:120000});
      if(mobile)await page.evaluate(()=>{__coreHarness.settings.values.quality='Лёгкая';__coreHarness.applyQuality();});
      await page.waitForFunction(()=>carLab.core().steps>30&&carLab.traffic().length>0);
      const result={viewport:mobile?'390x844':'1440x900',quality:mobile?'low':'high',seed:await page.evaluate(()=>carLab.city().seed)};
      result.start=await page.evaluate(()=>({core:carLab.core(),model:carLab.playerModel(),appearance:carLab.appearance(),police:carLab.police().length}));
      assert.equal(result.start.core.tick,result.start.core.steps);assert.ok(result.start.model.meshes>0);
      if(mobile){
        const touch=await context.newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:550,id:7}]});
        await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:220,y:450,id:7}]});
        await page.waitForTimeout(1700);result.joystick=await page.evaluate(()=>carLab.joystick());
        await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
        assert.ok(result.joystick.strength>0);
      }else{
        await page.keyboard.down('w');await page.waitForTimeout(1600);await page.keyboard.down('d');await page.keyboard.down('Space');
        await page.waitForTimeout(2200);await page.keyboard.up('Space');await page.keyboard.up('d');await page.keyboard.up('w');
      }
      result.driving=await page.evaluate(()=>({telemetry:carLab.telemetry(),trails:carLab.performance().trailSegments,smoke:carLab.tireSmoke(),core:carLab.core()}));
      await page.screenshot({path:path.join(out,name+'-driving.png')});
      await page.evaluate(()=>{
        const h=__coreHarness;h.reset();const pickup=h.gameWorld.repairs.placements[0];
        h.sim.body.position.set(pickup.x,.96,pickup.z-5);h.sim.body.quaternion.setFromEuler(0,0,0);h.sim.body.velocity.setZero();h.sim.body.angularVelocity.setZero();
        h.sim.damage=.8;h.sim.syncWheelPositions();h.sim.detachWheelAtImpact({speed:25,point:h.sim.wheels[0].mount,normal:{x:1,y:0,z:0}});
        h.sim.impactEvents.push({point:{x:.7,y:.2,z:1},normal:{x:-1,y:0,z:0},impact:{depth:.25,radius:1.2}});
      });
      await page.waitForFunction(()=>carLab.playerModel().deformedVertices>0&&carLab.wheels().some(w=>w.detached));
      await page.waitForFunction(()=>carLab.damageEffects().activeSmoke>0||carLab.damageEffects().activeFire>0);
      result.damaged=await page.evaluate(()=>({model:carLab.playerModel(),wheels:carLab.wheels(),effects:carLab.damageEffects()}));
      await page.screenshot({path:path.join(out,name+'-damaged.png')});
      await page.evaluate(()=>{const h=__coreHarness,p=h.gameWorld.repairs.placements[0];
        h.sim.body.position.set(p.x,.96,p.z-2.2);h.sim.body.quaternion.setFromEuler(0,0,0);h.sim.body.angularVelocity.setZero();h.sim.body.velocity.set(0,0,8);h.sim.body.aabbNeedsUpdate=true;});
      await page.waitForFunction(()=>carLab.repairPickups().pickups[0].status==='consumed'&&carLab.playerModel().deformedVertices===0&&carLab.wheels().every(w=>!w.detached));
      result.repair=await page.evaluate(()=>({core:carLab.core(),pickups:carLab.repairPickups(),effects:carLab.damageEffects()}));
      await page.screenshot({path:path.join(out,name+'-repaired.png')});
      // Real contact creates a wanted star; no direct client wanted setter.
      await page.evaluate(()=>{const h=__coreHarness,prop=h.gameWorld.props.entries.find(p=>p.type==='bin'&&p.state==='intact');
        h.sim.reset();h.sim.body.position.set(prop.x,prop.y+.65,prop.z-2.5);h.sim.body.quaternion.setFromEuler(0,0,0);h.sim.body.velocity.set(0,0,16);h.sim.body.aabbNeedsUpdate=true;});
      await page.waitForFunction(()=>carLab.wanted().level>0);
      result.wanted=await page.evaluate(()=>carLab.wanted());
      await page.evaluate(()=>{const h=__coreHarness;h.sim.reset();h.sim.body.position.set(0,.96,0);h.sim.body.quaternion.setFromEuler(0,0,0);
        h.sim.body.velocity.setZero();h.sim.body.angularVelocity.setZero();h.sim.body.aabbNeedsUpdate=true;
        const unit=h.traffic.states.find(a=>a.role==='police');if(!unit)throw Error('Missing offline police');
        unit.simulation.reset();unit.simulation.body.position.set(0,.96,-5);unit.simulation.body.velocity.setZero();
        unit.simulation.body.aabbNeedsUpdate=true;unit.logical=false;
        unit.ai.roleState.update=()=>({state:'follow',control:{steer:0,throttle:0,brake:1}});
      });
      await page.waitForFunction(()=>carLab.arrest().state==='arrested',null,{timeout:20000});
      result.arrest=await page.evaluate(()=>({state:carLab.arrest(),hud:document.querySelector('#arrest-status').textContent,core:carLab.core()}));
      await page.screenshot({path:path.join(out,name+'-arrested.png')});
      assert.equal(result.arrest.hud,'Арестован');
      const old=await page.evaluate(()=>carLab.city().seed);await page.locator('#arrest-restart').click();
      await page.waitForFunction(()=>carLab.arrest().state==='idle'&&carLab.wanted().level===0);
      result.newRound=await page.evaluate(()=>({seed:carLab.city().seed,core:carLab.core(),wheels:carLab.wheels()}));
      assert.notEqual(result.newRound.seed,old);assert.ok(result.newRound.wheels.every(w=>!w.detached));
      report.cases.push(result);await context.close();
    }
    assert.deepEqual(report.errors,[]);report.passed=true;
  }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();await vite.close();}
  console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,errors:report.errors}));
})().catch(e=>{console.error(e);process.exitCode=1;});
