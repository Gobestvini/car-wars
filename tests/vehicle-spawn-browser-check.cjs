const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const report={matrix:[],cycles:[],errors:[]};
const short=process.argv.includes('--menu-only');
const output=short?'docs/knowledge/vehicle-spawn-menu-check.json':'docs/knowledge/vehicle-spawn-browser-check.json';
const hook=`window.spawnCheck={traffic,sim,renderer,reset,rebuildCity,policeSpawnSpecs,
  snapshot:()=>({status:traffic.status(),pools:traffic.poolStats(),bodies:sim.world.bodies.length,
    listeners:sim.world._listeners.beginContact?.length||0,heap:performance.memory?.usedJSHeapSize,
    gpu:{...renderer.info.memory}})};
const originalCompile=renderer.compileAsync.bind(renderer);
renderer.compileAsync=async(...args)=>{if(window.failVehicleCompile){window.failVehicleCompile=false;throw Error('controlled compile retry');}return originalCompile(...args);};
`;
async function pageFor(browser,cfg,init) {
  const page=await browser.newPage({viewport:{width:cfg.width,height:cfg.height}});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(cfg=>{
    localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{quality:cfg.quality,trafficCount:cfg.count,policeCount:2,blurStrength:0,roadWidth:15}}));
    window.loadingPaints=0;function tick(){if(!window.carLab?.modelReady)window.loadingPaints++;requestAnimationFrame(tick);}requestAnimationFrame(tick);
  },cfg);
  if(init)await page.addInitScript(init);
  await page.route('**/src/main.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('window.carLab = {',hook+'window.carLab = {')});});
  await page.goto('http://127.0.0.1:5173/?play=1#debug');return page;
}
async function ready(page,count) {
  await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:120000});
  await page.waitForFunction(count=>carLab.trafficStatus().count===count&&!carLab.trafficStatus().pending,count,{timeout:120000});
  return page.evaluate(()=>({...spawnCheck.snapshot(),loadingPaints:window.loadingPaints}));
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
  try {
    for(const [width,height] of [[1440,900],[390,844]])for(const quality of ['Лёгкая','Высокая'])for(const count of [0,60,300]) {
      if(short)continue;
      console.log('matrix',width,quality,count);
      const cfg={width,height,quality,count},page=await pageFor(browser,cfg);
      const state=await ready(page,count);
      assert.equal(state.pools.civilian.created,300);assert.equal(state.pools.police.created,2);
      assert.equal(state.pools.civilian.evicted,0);assert.ok(state.loadingPaints>50);
      report.matrix.push({cfg,state});
      if(count===60)await page.screenshot({path:`docs/knowledge/vehicle-spawn-${width}-${quality==='Лёгкая'?'low':'high'}.png`});
      await page.close();fs.writeFileSync(output,JSON.stringify(report,null,2));
    }
    const page=await pageFor(browser,{width:1440,height:900,quality:'Лёгкая',count:0});
    await ready(page,0);
    const cdp=await page.context().newCDPSession(page);
    for(let cycle=0;cycle<(short?0:10);cycle++) {
      console.log('cycle',cycle+1);
      await page.evaluate(()=>spawnCheck.traffic.setCount(300));await ready(page,300);
      await page.evaluate(()=>{for(const actor of spawnCheck.traffic.states.filter(s=>s.role==='police')) actor.simulation.damage=1;
        spawnCheck.traffic.setRoleCount('police',0);spawnCheck.traffic.setRoleCount('police',2,spawnCheck.policeSpawnSpecs());
        spawnCheck.traffic.setCount(0);});await ready(page,0);
      await cdp.send('HeapProfiler.collectGarbage');const state=await page.evaluate(()=>spawnCheck.snapshot());
      assert.equal(state.pools.civilian.created,300);assert.equal(state.pools.police.created,2);
      assert.equal(state.pools.civilian.free,300);assert.equal(state.pools.civilian.evicted,0);
      assert.equal(state.listeners,3);report.cycles.push(state);
    }
    await page.evaluate(()=>{spawnCheck.traffic.setCount(300);spawnCheck.traffic.setCount(0);spawnCheck.reset();spawnCheck.rebuildCity();});
    await ready(page,0);report.resetRebuild=await page.evaluate(()=>spawnCheck.snapshot());
    await page.locator('#menu-button').click();
    await page.waitForFunction(()=>carLab.startScreen().open);
    await page.evaluate(()=>spawnCheck.traffic.setCount(300));
    await page.waitForTimeout(1000);
    assert.equal((await page.evaluate(()=>spawnCheck.snapshot())).status.count,0);
    await page.evaluate(()=>spawnCheck.traffic.setCount(0));
    await page.locator('#menu-play').click();await ready(page,0);
    report.menu=await page.evaluate(()=>spawnCheck.snapshot());
    // A simulated hidden state uses the same real visibilitychange handler and frame branch.
    await page.evaluate(()=>{spawnCheck.traffic.setCount(300);Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(5000);assert.equal((await page.evaluate(()=>spawnCheck.snapshot())).status.count,0);
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));spawnCheck.traffic.setCount(0);});await ready(page,0);
    report.hiddenResume=await page.evaluate(()=>spawnCheck.snapshot());await page.close();
    const retry=await pageFor(browser,{width:390,height:844,quality:'Лёгкая',count:60},()=>{window.failVehicleCompile=true;});
    await retry.locator('#loading-retry').waitFor({state:'visible',timeout:120000});
    report.partialRetry=await retry.evaluate(()=>spawnCheck.snapshot());await retry.locator('#loading-retry').click();
    report.retry=await ready(retry,60);assert.equal(report.retry.pools.civilian.created,300);await retry.close();
    const cancelled=await pageFor(browser,{width:390,height:844,quality:'Лёгкая',count:0});
    await cancelled.waitForFunction(()=>window.carLab?.pools().vehicles.civilian?.created>=3,null,{timeout:120000});
    await cancelled.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
    await cancelled.waitForTimeout(200);
    report.dispose=await cancelled.evaluate(()=>({state:spawnCheck.snapshot(),lifecycle:carLab.lifecycle()}));
    assert.deepEqual(report.dispose.state.pools,{});assert.equal(report.dispose.state.bodies,0);await cancelled.close();
    assert.deepEqual(report.errors,[]);
  } finally {fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
