const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const report={checks:[],errors:[],hiddenMethod:'Controlled document.hidden getter + visibilitychange in the real game; browser tab suspension is not claimed.'};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/src/main.js*',async route=>{
   const response=await route.fetch();const source=await response.text();
   await route.fulfill({response,body:source.replace('window.carLab = {',`window.pacingCheck={
     mode:setCameraMode,reset,hidden:value=>{
       Object.defineProperty(document,'hidden',{configurable:true,get:()=>value});
       document.dispatchEvent(new Event('visibilitychange'));
     },loading:value=>{
       Object.defineProperty(loadingScreen,'isOpen',{configurable:true,get:()=>value});
     }};window.carLab = {`)});
  });
  await page.goto('http://127.0.0.1:5179/?play=1#debug');
  await page.waitForFunction(()=>window.carLab?.modelReady);await page.waitForTimeout(2000);
  const sample=()=>page.evaluate(()=>({pacing:carLab.performance().frameIntervals,counters:carLab.frameCounters(),
    dropped:carLab.performance().droppedSeconds,position:carLab.telemetry().position,camera:carLab.camera().mode}));
  for(const mode of ['free','follow']){
   await page.evaluate(mode=>pacingCheck.mode(mode),mode);await page.waitForTimeout(1000);
   await page.screenshot({path:'docs/knowledge/frame-pacing/qa-'+mode+'.png'});const state=await sample();assert.equal(state.camera,mode);report.checks.push({mode,state});
  }
  for(const pause of ['hidden','loading']){
   await page.evaluate(pause=>pacingCheck[pause](true),pause);await page.waitForTimeout(100);
   const before=await sample();assert.equal(before.pacing.sampleCount,0);
   await page.waitForTimeout(5000);const during=await sample();
   assert.equal(during.counters.rendered,before.counters.rendered);
   assert.deepEqual(during.position,before.position);
   await page.evaluate(pause=>pacingCheck[pause](false),pause);await page.waitForTimeout(200);
   const after=await sample();assert.ok(after.pacing.max<1000);
   assert.ok(after.pacing.sampleCount<30);assert.equal(after.dropped,before.dropped);
   report.checks.push({pause,before,during,after});
  }
  await page.locator('#menu-button').click();await page.waitForTimeout(200);
  const beforeMenu=await sample();assert.equal(beforeMenu.pacing.sampleCount,0);
  await page.waitForTimeout(1000);const duringMenu=await sample();
  assert.equal(duringMenu.counters.rendered,beforeMenu.counters.rendered);
  await page.locator('#menu-play').click();await page.waitForTimeout(900);
  const afterMenu=await sample();assert.ok(afterMenu.pacing.max<1000);
  assert.ok(afterMenu.pacing.sampleCount<60);
  report.checks.push({menu:{before:beforeMenu,during:duringMenu,after:afterMenu}});
  await page.keyboard.down('w');await page.waitForTimeout(1500);await page.keyboard.up('w');
  await page.screenshot({path:'docs/knowledge/frame-pacing/qa-driving.png'});const driven=await sample();await page.keyboard.press('r');await page.waitForTimeout(100);
  const reset=await sample();assert.ok(reset.pacing.sampleCount<20);
  report.checks.push({driveAndReset:{driven,reset}});
  await page.goto('http://127.0.0.1:5179/?play=1');await page.waitForFunction(()=>window.carLab?.modelReady);assert.equal(await page.locator('#performance').evaluate(el=>el.hidden),true);report.checks.push({ordinaryHudHidden:true});assert.deepEqual(report.errors,[]);report.passed=true;
  fs.writeFileSync('docs/knowledge/frame-pacing/qa-regression.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true,checks:report.checks.length}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});


