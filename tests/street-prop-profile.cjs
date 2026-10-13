const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const out='docs/knowledge/street-props-0095';
const url=process.env.CARWARS_BASE_URL||'http://127.0.0.1:5174';
const baselineRef='90b9e65';
const baselineBroadphase=execFileSync('git',['show',`${baselineRef}:src/city-broadphase.js`],{encoding:'utf8'});
const report={date:'2026-10-13',durationSeconds:30,traffic:0,seed:42,baselineRef,
 browserFlags:['--enable-webgl','--js-flags=--no-opt'],
 baselineDefinition:'Pre-implementation broadphase and no prop colliders; identical geometry, seed, viewport and quality',profiles:[],errors:[]};
fs.mkdirSync(out,{recursive:true});
const p95=values=>values.sort((a,b)=>a-b)[Math.floor((values.length-1)*.95)];
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge',args:report.browserFlags});
 try {
  for(const viewport of [{width:1440,height:900},{width:390,height:844}])for(const quality of ['Лёгкая','Высокая']){
   const group=[];
   for(const mode of ['baseline','intact','debris']) {
    console.log('profile',viewport.width,quality,mode);
    const page=await browser.newPage({viewport});
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.addInitScript(quality=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,
      values:{quality,trafficCount:0,policeCount:0,blurStrength:0,roadWidth:15}})),quality);
    if(mode==='baseline')await page.route('**/src/city-scene.js*',async route=>{
      const response=await route.fetch();await route.fulfill({response,body:(await response.text())
        .replace('const propPhysics = simulation.world ? new StreetPropPhysics(simulation.world) : null;', 'const propPhysics = null;')});
    });
    if(mode==='baseline')await page.route('**/src/city-broadphase.js*',async route=>{
      const response=await route.fetch(),current=await response.text();
      const cannonImport=current.match(/from\s+["']([^"']*cannon-es[^"']*)["']/)?.[1];
      assert.ok(cannonImport,'reuse the dev server cannon-es module identity');
      await route.fulfill({response,body:baselineBroadphase.replace("'cannon-es'",JSON.stringify(cannonImport))});
    });
    await page.route('**/src/main.js*',async route=>{
      const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('window.carLab = {',
        'window.propProfile={sim,city:()=>cityState};\nwindow.carLab = {')});
    });
    await page.goto(`${url}/?play=1#debug`);
    await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:120000});
    if(await page.evaluate(()=>carLab.startScreen().open))await page.locator('#menu-play').click();
    await page.waitForFunction(()=>carLab.appearance().player==='active'&&!carLab.startScreen().open);
    await page.evaluate(()=>{carLab.setDebugCitySeed(42);propProfile.sim.damageMultiplier=0;});
    await page.waitForTimeout(1000);
    if(mode==='debris')await page.evaluate(()=>{
      const m=propProfile.city().propPhysics;
      const sorted=[...m.entries].sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z));
      for(const entry of sorted.slice(0,24))m.detach(entry,{body:propProfile.sim.body},{x:0,z:1},60);
      window.keepDebris=setInterval(()=>{for(const entry of m.debris)entry.destroyedAt=m.clock;},100);
    });
    await page.evaluate(()=>carLab.startSceneProfile());
    await page.waitForTimeout(30000);
    const data=await page.evaluate(()=>{
      const profile=carLab.sceneProfile();carLab.stopSceneProfile();
      if(window.keepDebris)clearInterval(window.keepDebris);
      return {profile,performance:carLab.performance(),bodies:carLab.worldBodies(),props:carLab.streetProps()?.detached};
    });
    const rows=data.profile.rows,columns=data.profile.columns;
    const values=name=>rows.map(r=>r[columns.indexOf(name)]).filter(Number.isFinite);
    const physicsPerStep=rows.filter(r=>r[columns.indexOf('steps')]>0).map(r=>r[columns.indexOf('physicsMs')]/r[columns.indexOf('steps')]);
    const summary={viewport,quality,mode,frames:rows.length,fps:rows.length/30,
      p95FrameMs:p95(values('intervalMs')),p95CpuMs:p95(values('cpuMs')),p95PhysicsMs:p95(values('physicsMs')),
      p95PhysicsPerStepMs:p95(physicsPerStep),bodies:data.bodies,detached:data.props??0};
    group.push(summary);report.profiles.push(summary);
    fs.writeFileSync(`${out}/performance.json`,JSON.stringify(report,null,2));
    await page.close();
   }
   const [baseline,intact,debris]=group;
   report.profiles.find(p=>p===intact).physicsRatio=intact.p95PhysicsPerStepMs/baseline.p95PhysicsPerStepMs;
   intact.physicsBudgetPassed=intact.physicsRatio<=1.2;
   debris.fpsBudgetPassed=baseline.fps<30||debris.fps>=30;
   debris.slowBaseline=baseline.fps<30;
   fs.writeFileSync(`${out}/performance.json`,JSON.stringify(report,null,2));
  }
  assert.deepEqual(report.errors,[]);
  assert.ok(report.profiles.filter(p=>p.mode==='intact').every(p=>p.physicsBudgetPassed),'intact physics budget');
  assert.ok(report.profiles.filter(p=>p.mode==='debris').every(p=>p.fpsBudgetPassed&&p.detached===24),'24 debris FPS budget');
  console.log(JSON.stringify(report.profiles));
 }finally{await browser.close();}
})().catch(error=>{fs.writeFileSync(`${out}/performance.json`,JSON.stringify({...report,failure:error.stack},null,2));console.error(error);process.exitCode=1;});
