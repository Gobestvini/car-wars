const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{trafficCount:0,policeCount:0,quality:'Высокая',roadWidth:15}})));
  await page.route('**/src/main.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('window.carLab = {','window.qaExtra={sim,wanted,city:()=>cityState,reset,setCameraMode};\nwindow.carLab = {')});});
  await page.goto(`${process.env.CARWARS_BASE_URL}/?play=1&seed=42#debug`);
  await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:120000});
  if(await page.evaluate(()=>carLab.startScreen().open))await page.locator('#menu-play').click();
  await page.waitForFunction(()=>carLab.appearance().player==='active');
  const results=await page.evaluate(async()=>{
   const C=await import('/node_modules/.vite/deps/cannon-es.js');
   const output={widths:[],ground:[],npc:null,debris:null,cap:null};
   for(let cycle=0;cycle<3;cycle++)for(const width of [12,30,15]){
    carLab.rebuildCity(width);const m=qaExtra.city().propPhysics;
    const initial={bodies:carLab.worldBodies(),contacts:qaExtra.sim.world.contactmaterials.length};
    for(const entry of m.entries.slice(0,25))m.detach(entry,{body:qaExtra.sim.body},new C.Vec3(0,0,1),60);
    qaExtra.reset();output.widths.push({cycle,width,...initial,restored:m.entries.every(e=>e.state==='intact')});
   }
   carLab.setDebugCitySeed(42);qaExtra.reset();
   const {sim,wanted}=qaExtra,m=qaExtra.city().propPhysics;
   function tick(actors){m.beforeStep(1/120,actors);sim.world.step(1/120);wanted.update(1/120,m.afterStep(1/120));m.syncVisuals();}
   for(const type of ['bin','bench','lamp','signal']){
    qaExtra.reset();const e=m.entries.find(e=>e.type===type);
    m.detach(e,{body:sim.body},new C.Vec3(0,0,1),60);
    let ground=false;
    for(let i=0;i<480;i++){tick([{body:sim.body,player:true}]);ground ||=sim.world.contacts.some(c=>(c.bi===e.body||c.bj===e.body)&&c.bi!==sim.body&&c.bj!==sim.body);}
    output.ground.push({type,ground,finite:Number.isFinite(e.body.position.y),state:e.state});
   }
   qaExtra.reset();const e=m.entries.find(e=>e.type==='bin');
   sim.body.position.set(e.x,e.y+.7,e.z-2.341);sim.body.quaternion.setFromEuler(0,0,0);sim.body.velocity.set(0,0,60/3.6);sim.body.aabbNeedsUpdate=true;
   tick([{body:sim.body,player:false}]);output.npc={state:e.state,level:wanted.snapshot().level};
   sim.body.velocity.setZero();for(let i=0;i<60;i++)tick([{body:sim.body,player:true}]);output.debris={level:wanted.snapshot().level};
   qaExtra.reset();for(let i=0;i<8;i++)wanted.update(.6,[{type:'property-collision'}]);output.cap=wanted.snapshot().level;
   qaExtra.reset();return output;
  });
  assert.deepEqual(errors,[]);
  for(const width of [12,30,15]){const rows=results.widths.filter(r=>r.width===width);assert.equal(new Set(rows.map(r=>r.bodies)).size,1);assert.equal(new Set(rows.map(r=>r.contacts)).size,1);assert.ok(rows.every(r=>r.restored));}
  assert.ok(results.ground.every(r=>r.ground&&r.finite&&r.state==='detached'));assert.deepEqual(results.npc,{state:'detached',level:0});assert.equal(results.debris.level,0);assert.equal(results.cap,6);
  fs.writeFileSync('docs/knowledge/street-props-0095/qa-extra.json',JSON.stringify({errors,results},null,2));console.log(JSON.stringify(results));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
