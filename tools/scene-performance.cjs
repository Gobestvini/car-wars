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
const allocationRun = process.env.SCENE_PROFILE_ALLOCATION === '1';
const drivingOnly = process.env.SCENE_PROFILE_DRIVING_ONLY === '1';
let referenceRevision = process.env.SCENE_PROFILE_REFERENCE || null;
let sourceRoot = 'src', referenceMain = null;
if (referenceRevision) {
  assert.ok(/^[0-9a-f]{7,40}$/.test(referenceRevision), 'Reference must be a commit SHA');
  const git = args => execFileSync('git', ['-c','safe.directory='+process.cwd().replaceAll('\\','/'),...args], {encoding:'utf8'});
  referenceRevision = git(['rev-parse','--verify',referenceRevision+'^{commit}']).trim();
  const directory = 'docs/knowledge/scene-optimization/reference-'+referenceRevision.slice(0,12);
  const files = git(['ls-tree','-r','--name-only',referenceRevision,'--','src','package.json']).trim().split('\n');
  for (const file of files) {
    const target = path.join(directory, file), content = git(['show',referenceRevision+':'+file]);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.writeFileSync(target, content);
  }
  sourceRoot = path.join(directory, 'src');
  referenceMain = directory+'/src/main.js';
  fs.writeFileSync(path.join(directory,'reference.json'),JSON.stringify({revision:referenceRevision,files,
    purpose:'Read-only Git source snapshot served by Vite for controlled pre-pooling comparisons; working src is untouched.'},null,2)+'\n');
}
let partial = null;
const matrix = [
  { id: 'desktop-low-empty', width: 1440, height: 900, quality: 'low', count: 0, police: 1, blur: 0, duration: 60000 },
  { id: 'mobile-low-60', width: 390, height: 844, quality: 'low', count: 60, police: 1, blur: 1, duration: 60000 },
  { id: 'desktop-high-60', width: 1440, height: 900, quality: 'high', count: 60, police: 1, blur: 0, duration: 60000 },
  { id: 'mobile-high-300', width: 390, height: 844, quality: 'high', count: 300, police: 2, blur: 1, duration: 300000 },
  { id: 'desktop-high-300', width: 1440, height: 900, quality: 'high', count: 300, police: 2, blur: 1, duration: 300000 },
  { id: 'lifecycle', width: 1440, height: 900, quality: 'high', count: 60, police: 2, blur: 1, duration: 300000, lifecycle: true },
];
const selected = process.env.SCENE_PROFILE_CASES ? process.env.SCENE_PROFILE_CASES.split(',') : null;
const cases = selected ? matrix.filter(item => selected.includes(item.id)) : matrix;
assert.ok(cases.length && (!selected || selected.every(id=>matrix.some(item=>item.id===id))), 'Unknown or empty cases');
assert.ok(Number.isInteger(repeats)&&repeats>0&&repeats<=10,'Repeats must be1..10');
const protocolFor=cfg=>({quick,allocationRun,durationMs:quick?3000:Number(process.env.SCENE_PROFILE_DURATION_MS||cfg.duration),
  requestedAffinity:process.env.SCENE_PROFILE_CPU_AFFINITY||null,effectsSeed:0x5c3e2026,drivingOnly,referenceRevision});
function sourceDigest() {
  const hash=createHash('sha256');
  for(const file of fs.readdirSync(sourceRoot).filter(file=>fs.statSync(path.join(sourceRoot,file)).isFile()).sort())
    hash.update(file+'\0').update(fs.readFileSync(path.join(sourceRoot,file)));
  return hash.update(fs.readFileSync(__filename)).digest('hex');
}
async function affinityMetadata(browser) {
  const session=await browser.newBrowserCDPSession();
  const info=await session.send('SystemInfo.getProcessInfo');await session.detach();
  const processes=[{type:'collector',id:process.pid},...info.processInfo];
  const ids=[...new Set(processes.map(p=>p.id).filter(Number.isInteger))];
  const script='@('+ids.join(',')+') | ForEach-Object { $p=Get-Process -Id $_ -ErrorAction SilentlyContinue; '
    +'if($p){$a=$null;$e=$null;try{$a=$p.ProcessorAffinity.ToInt64()}catch{$e=$_.Exception.Message};'
    +'[pscustomobject]@{id=$p.Id;affinity=$a;error=$e}} } | ConvertTo-Json -Compress';
  const parsed=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true}));
  const observed=Array.isArray(parsed)?parsed:[parsed];
  const result={requested:process.env.SCENE_PROFILE_CPU_AFFINITY||null,
    processes:processes.map(p=>{const actual=observed.find(o=>o.id===p.id);
      return{type:p.type,id:p.id,present:!!actual,affinity:actual?.affinity??null,error:actual?.error??null};})};
  if(result.requested) {
    assert.ok(['collector','browser','renderer','GPU'].every(type=>result.processes.some(p=>p.type===type&&p.present)),
      'Required benchmark processes are missing');
    assert.ok(result.processes.filter(p=>p.present).every(p=>p.affinity===Number(result.requested)),
      'All live benchmark processes must inherit the declared affinity: '+JSON.stringify(result));
  }
  return result;
}
const hook = `const originalBenchInput=getInput;
getInput=()=>{if(sceneBench.running)sceneBench.control();return originalBenchInput();};
window.sceneBench = {
  running:false, routeIndex:0,waypoints:[[-75,-25],[25,-25],[25,75],[-75,75]],
  configure: cfg => {
    settings.values.quality=cfg.quality==='low'?'Лёгкая':'Высокая'; applyQuality();
    miniatureBlur.setStrength(cfg.blur); traffic.setCount(cfg.count);
    traffic.setRoleCount('police',cfg.police,policeSpawnSpecs());
    Object.assign(sim.spawn,{x:-75,z:-50,yaw:0}); reset();
    sceneBench.routeIndex=0;
    return {seed:cityPlan.seed,spawn:{...sim.spawn},step:STEP};
  },
  control: () => {
    const body=sim.body,points=sceneBench.waypoints;
    let point=points[sceneBench.routeIndex];
    if(Math.hypot(point[0]-body.position.x,point[1]-body.position.z)<6) {
      sceneBench.routeIndex=(sceneBench.routeIndex+1)%points.length;point=points[sceneBench.routeIndex];
    }
    const target=Math.atan2(point[0]-body.position.x,point[1]-body.position.z),dx=Math.sin(target),dz=Math.cos(target);
    const m=camera.matrixWorld.elements,nr=Math.hypot(m[0],m[2]),nu=Math.hypot(m[4],m[6]);
    const rx=m[0]/nr,rz=m[2]/nr,ux=m[4]/nu,uz=m[6]/nu,det=rx*uz-rz*ux;
    const sx=(dx*uz-dz*ux)/det,sy=(rx*dz-rz*dx)/det,length=Math.hypot(sx,sy),radius=benchDeadZone+.14*(benchRadius-benchDeadZone);
    pointer.active=true;pointer.startX=pointer.startY=0;pointer.x=sx/length*radius;pointer.y=-sy/length*radius;
  },
  drive: () => {keys.clear();sceneBench.running=true;},
  restart: () => {reset();sceneBench.routeIndex=0;},
  pursuit: () => { wanted.update(.6,[{type:'police-collision'}]); wanted.update(.6,[{type:'police-collision'}]); sim.damage=.55; },
  lifecycle: i => {
    keys.clear();releasePointer();sceneBench.running=false; traffic.setCount([0,60,300,0,60][i%5]);
    traffic.setRoleCount('police',i%2?0:2,policeSpawnSpecs());
    if(i%2===0) rebuildCity(i%4===0?12:15); else reset();
    settings.values.quality=i%2?'Высокая':'Лёгкая'; applyQuality();
    return {requestedCount:[0,60,300,0,60][i%5],roadWidth:cityPlan.roadWidth,quality,
      resources:carLab.resources(),traffic:traffic.status(),pickups:repairPickups.snapshot()};
  },
  collectSetup: () => {
    sceneBench.running=false;keys.clear();releasePointer();const p=repairPickups.placements.find(p=>p.status==='available');
    if(!p)return null;sim.damage=.55;sim.body.position.set(p.x,pickupSurfaceHeight(p.x,p.z)+.96,p.z);
    sim.body.velocity.setZero();sim.body.angularVelocity.setZero();return {id:p.id,x:p.x,z:p.z};
  },
  restore: () => {reset();sceneBench.routeIndex=0;sceneBench.running=true;return repairPickups.snapshot();},
  sample: () => ({telemetry:sim.telemetry(),routeIndex:sceneBench.routeIndex,arrest:arrest.snapshot(),
    proxies:buildingEntries.filter(e=>e.proxy).length,occlusion:{...buildingOcclusion.stats},traffic:traffic.status(),
    police:carLab.police(),bodies:sim.world.bodies.length,
    worldListeners:Object.fromEntries(Object.entries(sim.world._listeners||{}).map(([k,v])=>[k,v.length])),
    bodyCollisionListeners:sim.world.bodies.reduce((n,b)=>n+(b._listeners?.collide?.length||0),0),
    trafficPerformance:traffic.performance(),resources:carLab.resources(),pools:carLab.pools?.()??null,pickups:repairPickups.snapshot(),
    heap:performance.memory?.usedJSHeapSize??null,smoke:carLab.tireSmoke()}),
  stop: () => {keys.clear();releasePointer();sceneBench.running=false;},
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
  const code={sourceHash:sourceDigest(),referenceRevision,legacyLimiterFrom:process.env.FRAME_PACING_LEGACY==='1'?'1bc8c94:src/game-loop.js':null};
  const args=['--enable-webgl'];
  if(process.env.SCENE_PROFILE_SOFTWARE==='1') args.push('--use-angle=swiftshader','--enable-unsafe-swiftshader');
  const browser=await chromium.launch({channel:'msedge',headless:true,args});
  try {
    for(let repeat=0;repeat<repeats;repeat++) for(const cfg of cases) {
      const file=path.join(out,`${cfg.id}-${repeat+1}.json`);
      const protocol=protocolFor(cfg);
      assert.ok(Number.isFinite(protocol.durationMs)&&protocol.durationMs>0&&protocol.durationMs<=300000);
      if(fs.existsSync(file)&&process.env.SCENE_PROFILE_RESUME==='1') {
        const old=JSON.parse(fs.readFileSync(file,'utf8'));
        assert.deepEqual(old.code,code,'Resume requires the identical source and limiter');
        assert.deepEqual(old.protocol,protocol,'Resume requires the identical measurement protocol');
        assert.deepEqual(old.cfg,cfg);continue;
      }
      const context=await browser.newContext({viewport:{width:cfg.width,height:cfg.height},deviceScaleFactor:1});
      const page=await context.newPage(), errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error'&&/WebGL|Shader|GL_INVALID/.test(m.text()))errors.push(m.text());});
      await page.addInitScript(cfg=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{
        quality:cfg.quality==='low'?'Лёгкая':'Высокая',trafficCount:cfg.count,policeCount:cfg.police,blurStrength:cfg.blur,roadWidth:15}})),cfg);
      await page.addInitScript(()=>{
        let seed=0x5c3e2026;
        Math.random=()=>{seed=(seed+0x6d2b79f5)>>>0;let n=seed;
          n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return((n^n>>>14)>>>0)/4294967296;};
      });
      await page.route('**/src/main.js*',async route=>{
        const response=await route.fetch(referenceMain ? {url:new URL(referenceMain,base).href} : {}), source=await response.text();
        assert.ok(source.includes('window.carLab = {'));
        const joystickUrl=referenceMain ? '/'+referenceMain.replace(/main\.js$/,'joystick.js') : './joystick.js';
        const imports="import {JOYSTICK_RADIUS as benchRadius,JOYSTICK_DEAD_ZONE as benchDeadZone} from '"+joystickUrl+"';\n";
        await route.fulfill({response,body:imports+source.replace('window.carLab = {',hook+'window.carLab = {')});
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
      await page.evaluate(()=>sceneBench.drive());
      await page.waitForTimeout(quick?1000:10000);
      const cpuAffinity=await affinityMetadata(browser);
      await page.evaluate(()=>sceneBench.restart());
      const cdp=await context.newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const before=await page.evaluate(()=>({resources:carLab.resources(),counters:carLab.frameCounters(),performance:carLab.performance(),
        environment:sceneBench.environment(),heap:performance.memory?.usedJSHeapSize??null,position:carLab.telemetry().position}));
      assert.equal(await page.evaluate(()=>carLab.startSceneProfile()),true);
      if(allocationRun)await cdp.send('HeapProfiler.startSampling',{samplingInterval:32768,
        includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
      await page.evaluate(()=>{
        window.__profileRaf=[];window.__profileRafActive=true;window.__profileRafTotal=0;
        const observe=stamp=> {if(!window.__profileRafActive)return;
          window.__profileRafTotal++;if(window.__profileRaf.length<32768)window.__profileRaf.push(stamp);
          requestAnimationFrame(observe);};
        requestAnimationFrame(observe);
      });
      const duration=protocol.durationMs, start=Date.now(), samples=[], events=[];
      partial={code,cfg,repeat:repeat+1,before,samples,events};
      let nextLifecycle=0, segment=0, pursued=false;
      while(Date.now()-start<duration) {
        const elapsed=Date.now()-start;
        if(cfg.lifecycle&&elapsed>=nextLifecycle*(duration/10)&&nextLifecycle<10) {
          const cycle=nextLifecycle++;
          const beforeCycle=await page.evaluate(i=>sceneBench.lifecycle(i),cycle);
          await page.waitForFunction(count=>carLab.trafficStatus().count===count&&!carLab.trafficStatus().pending,
            beforeCycle.requestedCount,{timeout:180000});
          const pickup=await page.evaluate(()=>sceneBench.collectSetup());
          await page.waitForTimeout(250);
          const collected=await page.evaluate(()=>sceneBench.sample());
          if(pickup)assert.equal(collected.pickups.pickups.find(p=>p.id===pickup.id).status,'consumed');
          const restored=await page.evaluate(()=>sceneBench.restore());
          assert.ok(restored.pickups.every(p=>p.status==='available'));
          await cdp.send('HeapProfiler.collectGarbage');
          events.push({elapsed,cycle,beforeCycle,pickup,collected,restored,
            afterGc:await page.evaluate(()=>sceneBench.sample())});
        } else if(!cfg.lifecycle) {
          const nextSegment=Math.floor(elapsed/60000);
          if(nextSegment!==segment){await page.evaluate(()=>sceneBench.restart());segment=nextSegment;pursued=false;
            events.push({elapsed,event:'reset-segment'});}
          if(!drivingOnly&&cfg.count>0&&!pursued&&elapsed%60000>=10000) {
            await page.evaluate(()=>sceneBench.pursuit());pursued=true;events.push({elapsed,event:'pursuit-damage'});
          }
        }
        samples.push({elapsed:Date.now()-start,...await page.evaluate(()=>sceneBench.sample())});
        await page.waitForTimeout(1000);
      }
      // Send one JSON string rather than recursively serializing thousands of rows through Playwright.
      const profile=JSON.parse(await page.evaluate(()=>{sceneBench.stop();window.__profileRafActive=false;
        const p=carLab.sceneProfile();p.externalRafTimestamps=window.__profileRaf;
        p.externalRafTotal=window.__profileRafTotal;
        p.externalRafTruncated=window.__profileRafTotal-window.__profileRaf.length;
        const json=JSON.stringify(p);carLab.stopSceneProfile();return json;}));
      partial.profile=profile;
      const allocations=allocationRun?(await cdp.send('HeapProfiler.stopSampling')).profile:null;
      await cdp.send('HeapProfiler.collectGarbage');
      const after=await page.evaluate(()=>({resources:carLab.resources(),counters:carLab.frameCounters(),performance:carLab.performance(),
        traffic:carLab.trafficStatus(),trafficPerformance:carLab.trafficPerformance(),heap:performance.memory?.usedJSHeapSize??null,
        position:carLab.telemetry().position,police:carLab.police(),smoke:carLab.tireSmoke(),pickups:carLab.repairPickups()}));
      assert.deepEqual(errors,[]);
      assert.equal(profile.overwritten,0);
      assert.equal(new Set(profile.rows.map(row=>row[0])).size,profile.rows.length);
      assert.ok(profile.rows.length>0);
      assert.equal(sourceDigest(),code.sourceHash,'Sources changed during the timing run');
      const report={revision,code,at:new Date().toISOString(),browser:browser.version(),headless:true,softwareRequested:process.env.SCENE_PROFILE_SOFTWARE==='1',
        device:'desktop; mobile viewport is not a physical phone',cpuThrottle:1,cpuAffinity,effectsSeed:0x5c3e2026,
        quick,cfg,protocol,repeat:repeat+1,pose,
        warmupMs:quick?1000:10000,elapsedMs:Date.now()-start,before,after,errors,samples,events,allocationRun,allocations,
        route:{waypoints:[[-75,-25],[25,-25],[25,75],[-75,75]],strength:.14,
          input:'test pointer coordinates; unmodified getInput/joystickVector/directionalInput/arrest guard each physics step'},
        summary:summary(profile),profile};
      fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify({case:cfg.id,repeat:repeat+1,frames:profile.rows.length,gpu:profile.gpu.status,
        cpuP95:report.summary.cpuMs.p95,renderCpuP95:report.summary.renderCpuMs.p95,intervalP95:report.summary.intervalMs.p95}));
      partial=null;await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'collector-error.json'),JSON.stringify({error:error.stack,partial},null,2)+'\n');
  console.error(error);process.exitCode=1;});
