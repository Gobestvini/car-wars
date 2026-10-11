// Real game profiling. Test-only hooks are injected in the HTTP response, never shipped.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5173/';
const out = process.env.SCENE_PROFILE_OUT || 'docs/knowledge/scene-optimization/baseline';
const repeats = Number(process.env.SCENE_PROFILE_REPEATS || 3);
const quick = process.env.SCENE_PROFILE_QUICK === '1';
const matrix = [
  { id: 'desktop-low-empty', width: 1440, height: 900, quality: 'low', count: 0, police: 1, blur: 0, duration: 60000 },
  { id: 'mobile-low-60', width: 390, height: 844, quality: 'low', count: 60, police: 1, blur: 1, duration: 60000 },
  { id: 'desktop-high-60', width: 1440, height: 900, quality: 'high', count: 60, police: 1, blur: 0, duration: 60000 },
  { id: 'mobile-high-300', width: 390, height: 844, quality: 'high', count: 300, police: 2, blur: 1, duration: 300000 },
  { id: 'desktop-high-300', width: 1440, height: 900, quality: 'high', count: 300, police: 2, blur: 1, duration: 300000 },
];
const selected = process.env.SCENE_PROFILE_CASES?.split(',');
const cases = selected ? matrix.filter(item => selected.includes(item.id)) : matrix;
const hook = `const qaOriginalGetInput=getInput;getInput=()=>window.qaInput||qaOriginalGetInput();window.sceneBench = {
  configure: cfg => {
    settings.values.quality=cfg.quality==='low'?'Лёгкая':'Высокая'; applyQuality();
    miniatureBlur.setStrength(cfg.blur); traffic.setCount(cfg.count);
    traffic.setRoleCount('police',cfg.police,policeSpawnSpecs());
    Object.assign(sim.spawn,{x:-75,z:-50,yaw:0}); reset();
    return {seed:cityPlan.seed,spawn:{...sim.spawn},step:STEP};
  },
  drive: elapsed => {
    const t=sim.telemetry();const points=[[-75,-25],[25,-25],[25,75],[-75,75]];window.routeIndex??=0;let point=points[window.routeIndex];if(Math.hypot(point[0]-t.position.x,point[1]-t.position.z)<6){window.routeIndex=(window.routeIndex+1)%points.length;point=points[window.routeIndex];}window.qaInput=directionalInput(Math.atan2(point[0]-t.position.x,point[1]-t.position.z),t.heading,t.signedSpeed,.14,1);
    // Repeating deterministic input pattern; world simulation is the unmodified game.
    
  },
  pursuit: () => { wanted.update(.6,[{type:'police-collision'}]); wanted.update(.6,[{type:'police-collision'}]); sim.damage=.55; },
  lifecycle: i => {
    keys.clear(); traffic.setCount([0,60,300,0,60][i%5]);
    if(i%2===0) rebuildCity(i%4===0?12:15); else reset();
    settings.values.quality=i%2?'Высокая':'Лёгкая'; applyQuality();
    return {resources:carLab.resources(),traffic:traffic.status(),pickups:repairPickups.snapshot()};
  },
  stop: () => {keys.clear();window.qaInput=null;},
  environment: () => {
    const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,
      renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      version:gl.getParameter(gl.VERSION),dpr:renderer.getPixelRatio(),seed:cityPlan.seed};
  }
};`;
const percentile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b);
  return sorted.length ? sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)] : null;
};
function summary(profile) {
  return Object.fromEntries(profile.columns.slice(2).map((column,index)=> {
    const values=profile.rows.map(row=>row[index+2]).filter(Number.isFinite);
    return [column,{p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),
      mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null}];
  }));
}
(async()=> {
  fs.mkdirSync(out,{recursive:true});
  const revision=execFileSync('git',['-c','safe.directory='+process.cwd().replaceAll('\\','/'),'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const sourceHash=createHash('sha256');
  for(const file of fs.readdirSync('src').filter(file=>fs.statSync(path.join('src',file)).isFile()).sort())
    sourceHash.update(file+'\0').update(fs.readFileSync(path.join('src',file)));
  sourceHash.update(fs.readFileSync(__filename));
  const code={sourceHash:sourceHash.digest('hex'),legacyLimiterFrom:process.env.FRAME_PACING_LEGACY==='1'?'1bc8c94:src/game-loop.js':null};
  const args=['--enable-webgl'];
  if(process.env.SCENE_PROFILE_SOFTWARE==='1') args.push('--use-angle=swiftshader','--enable-unsafe-swiftshader');
  const browser=await chromium.launch({channel:'msedge',headless:true,args});
  try {
    for(let repeat=0;repeat<repeats;repeat++) for(const cfg of cases) {
      const file=path.join(out,`${cfg.id}-${repeat+1}.json`);
      if(fs.existsSync(file)&&process.env.SCENE_PROFILE_RESUME==='1') continue;
      const context=await browser.newContext({viewport:{width:cfg.width,height:cfg.height},deviceScaleFactor:1});
      const page=await context.newPage(), errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error'&&/WebGL|Shader|GL_INVALID/.test(m.text()))errors.push(m.text());});
      await page.addInitScript(cfg=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{
        quality:cfg.quality==='low'?'Лёгкая':'Высокая',trafficCount:cfg.count,policeCount:cfg.police,blurStrength:cfg.blur,roadWidth:15}})),cfg);
      await page.route('**/src/main.js*',async route=>{
        const response=await route.fetch(), source=await response.text();
        assert.ok(source.includes('window.carLab = {'));
        await route.fulfill({response,body:source.replace('window.carLab = {',hook+'window.carLab = {')});
      });
      if(process.env.FRAME_PACING_LEGACY==='1') await page.route('**/src/game-loop.js*',async route=>{
        const response=await route.fetch();
        const legacy=execFileSync('git',['-c','safe.directory='+process.cwd().replaceAll('\\','/'),'show','1bc8c94:src/game-loop.js'],{encoding:'utf8'});
        await route.fulfill({response,body:legacy});
      });
      console.log(`Starting ${cfg.id} repeat ${repeat+1}/${repeats}`);
      await page.goto(base+'?play=1#debug');
      await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:120000});
      const pose=await page.evaluate(cfg=>sceneBench.configure(cfg),cfg);
      await page.waitForFunction(count=>carLab.trafficStatus().count===count&&!carLab.trafficStatus().pending,cfg.count,{timeout:180000});
      await page.waitForTimeout(quick?1000:10000);
      const cdp=await context.newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const before=await page.evaluate(()=>({resources:carLab.resources(),counters:carLab.frameCounters(),performance:carLab.performance(),
        environment:sceneBench.environment(),heap:performance.memory?.usedJSHeapSize??null,position:carLab.telemetry().position}));
      assert.equal(await page.evaluate(()=>carLab.startSceneProfile()),true);
      await page.evaluate(()=>{
        window.__profileRaf=[];window.__profileRafActive=true;
        const observe=stamp=> {if(!window.__profileRafActive)return;
          if(window.__profileRaf.length<32768)window.__profileRaf.push(stamp); requestAnimationFrame(observe);};
        requestAnimationFrame(observe);
      });
      const duration=quick?3000:cfg.duration, start=Date.now(), routeTelemetry=[];
      while(Date.now()-start<duration) {
        await page.evaluate(elapsed=>{sceneBench.drive(elapsed);},Date.now()-start);
        routeTelemetry.push(await page.evaluate(()=>({telemetry:carLab.telemetry(),arrest:carLab.arrest?.()})));if(routeTelemetry.length===30 || routeTelemetry.length===80)await page.screenshot({path:path.join(out,cfg.id+'-'+routeTelemetry.length+'.png')});await page.waitForTimeout(100);
      }
      const profile=await page.evaluate(()=>{sceneBench.stop();window.__profileRafActive=false;
        const p=carLab.sceneProfile();p.externalRafTimestamps=window.__profileRaf;
        carLab.stopSceneProfile();return p;});
      await cdp.send('HeapProfiler.collectGarbage');
      const after=await page.evaluate(()=>({resources:carLab.resources(),counters:carLab.frameCounters(),performance:carLab.performance(),
        traffic:carLab.trafficStatus(),trafficPerformance:carLab.trafficPerformance(),heap:performance.memory?.usedJSHeapSize??null,
        position:carLab.telemetry().position,police:carLab.police(),smoke:carLab.tireSmoke(),pickups:carLab.repairPickups()}));
      assert.deepEqual(errors,[]);
      assert.equal(profile.overwritten,0);
      assert.equal(new Set(profile.rows.map(row=>row[0])).size,profile.rows.length);
      assert.ok(profile.rows.length>0);
      const report={revision,code,at:new Date().toISOString(),browser:browser.version(),headless:true,softwareRequested:process.env.SCENE_PROFILE_SOFTWARE==='1',
        device:'desktop; mobile viewport is not a physical phone',cpuThrottle:1,quick,cfg,repeat:repeat+1,pose,routeTelemetry,
        warmupMs:quick?1000:10000,elapsedMs:Date.now()-start,before,after,errors,summary:summary(profile),profile};
      fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify({case:cfg.id,repeat:repeat+1,frames:profile.rows.length,gpu:profile.gpu.status,
        cpuP95:report.summary.cpuMs.p95,renderCpuP95:report.summary.renderCpuMs.p95,intervalP95:report.summary.intervalMs.p95}));
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
