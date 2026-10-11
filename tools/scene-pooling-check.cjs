// Actual WebGL lifecycle; private fixture methods exist only in the intercepted HTTP response.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const source=fs.readFileSync('tools/scene-performance.cjs','utf8');
const hook=source.slice(source.indexOf('const hook = `')+14,source.indexOf('`;\nconst percentile'));
const output=process.env.SCENE_POOL_OUT||'docs/knowledge/scene-optimization/pooling-live';
const trafficCycles=Number(process.env.SCENE_POOL_CYCLES||20);
assert.ok(Number.isInteger(trafficCycles)&&trafficCycles>=0&&trafficCycles<=20);
const digest=()=>{const hash=createHash('sha256');for(const name of fs.readdirSync('src').sort())if(fs.statSync(path.join('src',name)).isFile())hash.update(name+'\0').update(fs.readFileSync(path.join('src',name)));return hash.digest('hex');};
const extra=`window.poolBench={
 count: value=>traffic.setCount(value),
 police: value=>traffic.setRoleCount('police',value,policeSpawnSpecs()),
 removePolicePaused: ()=>{
   Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
   traffic.setRoleCount('police',0,[]);return policeEffectsPool.snapshot();
 },
 damagePolice: ()=>{for(const actor of traffic.states.filter(s=>s.role==='police')) {
   actor.simulation.damage=1;actor.simulation.impactEvents.push({point:{x:0,y:0,z:1.8},normal:{x:0,y:0,z:-1},impact:{depth:.2,radius:3}});
 }},
 deformedPolice: ()=>traffic.states.filter(s=>s.role==='police').every(s=>
   s.mesh.userData.poolDeformation.geometry.attributes.position.array.some((n,i)=>Math.abs(n-s.mesh.userData.poolDeformation.originalPositions[i])>1e-5)),
 policeClean: ()=>traffic.states.filter(s=>s.role==='police').every(s=>s.simulation.damage===0 &&
   s.mesh.userData.poolDeformation.geometry.attributes.position.array.every((n,i)=>Math.abs(n-s.mesh.userData.poolDeformation.originalPositions[i])<1e-6) &&
   !policeDamageVisuals.get(s.id)?.effects.snapshot().exploded),
 rebuild: ()=>rebuildCity(15),reset,
 quality: value=>{settings.values.quality=value==='low'?'Лёгкая':'Высокая';applyQuality();},
 fade: phase=>{sceneBench.running=false;releasePointer();keys.clear();cameraMode='free';orbitControls.enabled=true;
   const e=buildingEntries.find(e=>e.artFamily===1 && !cityPlan.buildings.some(b=>b.id!==e.id &&
     Math.abs(e.z-b.z)<b.depth/2+3 && e.x+e.width/2+6>b.x-b.width/2-1 && e.x+e.width/2+4<b.x+b.width/2+1));
   if(!e)throw new Error('No roof-detail building with a clear street-side camera');
   const x=e.x+e.width/2+4,z=e.z;
   sim.body.position.set(x,pickupSurfaceHeight(x,z)+.96,z);sim.body.velocity.setZero();sim.body.angularVelocity.setZero();
   orbitControls.target.set(x,1,z);camera.position.set(phase?e.x-e.width/2-10:x+2,5,z);camera.lookAt(orbitControls.target);camera.updateMatrixWorld();return e.id;},
 follow: ()=>{setCameraMode('follow');reset();},
 collision: role=>{
   sceneBench.running=false;releasePointer();keys.clear();setCameraMode('follow');reset();
   const actor=traffic.states.find(s=>s.role===role);if(!actor)throw new Error('No collision fixture actor');
   const body=actor.simulation.body,x=sim.body.position.x,z=sim.body.position.z+5;
   body.position.set(x,pickupSurfaceHeight(x,z)+.96,z);body.previousPosition.copy(body.position);
   body.interpolatedPosition.copy(body.position);body.quaternion.setFromEuler(0,0,0);body.previousQuaternion.copy(body.quaternion);
   body.velocity.setZero();body.angularVelocity.setZero();body.aabbNeedsUpdate=true;
   actor.x=actor.previousX=x;actor.z=actor.previousZ=z;actor.heading=actor.previousHeading=0;
   Object.assign(actor.occupancyItem,{x,z,heading:0,vx:0,vz:0});traffic.prepare(.11);
   const observation={role,id:actor.id,bodyId:body.id,contacts:0};
   const listener=event=>{if((event.bodyA===sim.body&&event.bodyB===body)||(event.bodyB===sim.body&&event.bodyA===body))observation.contacts++;};
   sim.world.addEventListener('beginContact',listener);
   window.poolCollision={observation,listener};sim.body.velocity.set(0,0,12);keys.add('KeyW');return observation;
 },
 collisionResult: ()=>({...window.poolCollision.observation,playerDamage:sim.damage,
   police:carLab.police(),playerPosition:{...sim.body.position}}),
 collisionStop: ()=>{keys.clear();sim.world.removeEventListener('beginContact',window.poolCollision.listener);window.poolCollision=null;},
 repairPlayer: ()=>{const placement=sceneBench.collectSetup();sim.damage=1;return placement;},
 hidden: value=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>value});document.dispatchEvent(new Event('visibilitychange'));},
 teardownWatch: ()=>{
   const resources=new Set(),addTree=root=>root.traverse(node=>{if(node.isMesh){resources.add(node.geometry);
     if(node.isInstancedMesh)resources.add(node);for(const m of Array.isArray(node.material)?node.material:[node.material]) {
       resources.add(m);for(const v of Object.values(m))if(v?.isTexture)resources.add(v);
     }}});
   addTree(scene);
   for(const pool of [policeEffectsPool,...vehiclePoolsForBench()])for(const record of pool.records) {
     if(record.value.mesh)addTree(record.value.mesh);
   }
   for(const {group} of buildingOcclusion.cache.values()){addTree(group);for(const g of group.userData.depthGeometries.values())resources.add(g);}
   window.poolDisposals=[...resources].map(resource=>{const item={type:resource.type||'InstancedMesh',uuid:resource.uuid,count:0};resource.addEventListener('dispose',()=>item.count++);return item;});
 },
 finish: persisted=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted})),
 debugFade: ()=>({camera:carLab.camera(),state:sceneBench.sample(),
   active:buildingEntries.filter(e=>e.proxy).map(e=>({id:e.id,x:e.x,z:e.z,width:e.width,depth:e.depth,height:e.height,opacity:e.opacity,wasOccluded:e.wasOccluded}))}),
 livePrograms: ()=>renderer.info.programs.filter(program=>renderer.getContext().isProgram(program.program)).length,
 sample: ()=>({...sceneBench.sample(),pools:carLab.pools(),effects:carLab.damageEffects(),lifecycle:carLab.lifecycle(),
   instances:scene.children.length,disposals:window.poolDisposals||null})
};`;
// Vehicle storage is private to traffic.js. Observe the storage meshes that have appeared in the scene.
const storageHook=`window.vehiclePoolMeshes=new Set(); const addStorageMesh=scene.add;
scene.add=function(...nodes){for(const node of nodes)if(node.userData.conceptVariant)vehiclePoolMeshes.add(node);return addStorageMesh.apply(this,nodes);};
const vehiclePoolsForBench=()=>[{records:[...vehiclePoolMeshes].map(mesh=>({value:{mesh}}))}];`;
(async()=>{
 fs.mkdirSync(output,{recursive:true});const report={sourceHash:digest(),checks:[],samples:[],errors:[],affinity:process.env.SCENE_PROFILE_CPU_AFFINITY||null,
   trafficCycles,hiddenMethod:'Controlled getter; not physical OS tab suspension',teardownMethod:'Synthetic persisted/final pagehide; checks production handler ownership'};
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{trafficCount:0,policeCount:0,roadWidth:15,blurStrength:1}})));
  await page.route('**/src/main.js*',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:
   "import {JOYSTICK_RADIUS as benchRadius,JOYSTICK_DEAD_ZONE as benchDeadZone} from './joystick.js';\n"+body.replace('window.carLab = {',storageHook+hook+extra+'window.carLab = {')});});
  await page.goto((process.env.CARWARS_BASE_URL||'http://127.0.0.1:5180/')+'?play=1#debug');
  await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:120000});
  report.environment=await page.evaluate(()=>sceneBench.environment());report.browser=browser.version();
  const cdp=await page.context().newCDPSession(page);
  const sample=async()=>{await cdp.send('HeapProfiler.collectGarbage');return page.evaluate(()=>poolBench.sample());};
  const count=async value=>{await page.evaluate(value=>poolBench.count(value),value);await page.waitForFunction(value=>carLab.trafficStatus().count===value&&!carLab.trafficStatus().pending,value,{timeout:180000});};
  const police=async value=>{await page.evaluate(value=>poolBench.police(value),value);await page.waitForFunction(value=>carLab.police().length===value&&carLab.pools().policeEffects.active===value,value,{timeout:180000});};
  await page.evaluate(()=>sceneBench.configure({quality:'high',count:0,police:0,blur:1}));
  await count(300);await police(2);await page.waitForTimeout(1000);await count(60);
  const pausedRelease=await page.evaluate(()=>poolBench.removePolicePaused());
  assert.equal(pausedRelease.active,0);
  await page.evaluate(()=>poolBench.hidden(false));await police(2);
  report.checks.push({pausedPoliceRelease:pausedRelease});
  const warm=await sample();report.warm=warm;
  for(let cycle=0;cycle<trafficCycles;cycle++) {
   await police(0);for(const value of [0,60,300,0,60])await count(value);
   await police(2);assert.equal(await page.evaluate(()=>poolBench.policeClean()),true,'Reissued police retained deformation/damage/explosion');
   const clean=await sample();assert.equal(clean.pools.vehicles.civilian.created,warm.pools.vehicles.civilian.created);
   assert.equal(clean.pools.vehicles.police.created,2);assert.equal(clean.pools.policeEffects.created,2);
   assert.equal(clean.worldListeners.beginContact,3);assert.ok(clean.bodyCollisionListeners<=62);
   assert.equal(clean.pools.vehicles.civilian.active+clean.pools.vehicles.civilian.free,300);
   report.samples.push({cycle,state:clean});
   await page.evaluate(()=>poolBench.damagePolice());await page.waitForFunction(()=>carLab.police().every(p=>p.damageStage==='terminal'),null,{timeout:10000});
   await page.waitForTimeout(850);const damaged=await sample();assert.ok(damaged.police.every(p=>p.damage===1));
   assert.equal(await page.evaluate(()=>poolBench.deformedPolice()),true,'Fixture did not deform the private police buffers');
   report.checks.push({cycle,terminal:true});
   console.log(JSON.stringify({cycle,created:clean.pools.vehicles.civilian.created,heap:clean.heap}));
  }
  await police(0);await count(0);await page.evaluate(()=>poolBench.follow());
  report.repairSetup=await page.evaluate(()=>poolBench.repairPlayer());
  await page.waitForTimeout(300);report.repairAfter=await sample();
  await page.waitForFunction(()=>carLab.telemetry().damage===0,null,{timeout:10000});
  report.checks.push({playerFullDamageRepaired:true});
  for(let cycle=0;cycle<20;cycle++) {
   await page.evaluate(()=>poolBench.fade(1));await page.waitForFunction(()=>carLab.pools().buildings.active>0);
   for(const quality of ['low','high']){await page.evaluate(q=>poolBench.quality(q),quality);await page.waitForTimeout(150);}
   if(cycle===0)await page.screenshot({path:path.join(output,'fade-high.png')});
   await page.evaluate(()=>poolBench.fade(0));
   try { await page.waitForFunction(()=>carLab.pools().buildings.active===0,null,{timeout:10000}); }
   catch(error) { report.fadeFailure=await page.evaluate(()=>poolBench.debugFade());throw error; }
   const state=await sample();report.checks.push({fade:cycle,pools:state.pools.buildings});
   console.log(JSON.stringify({fade:cycle,created:state.pools.buildings.created,reused:state.pools.buildings.reused}));
   if(cycle>0)assert.equal(state.pools.buildings.created,report.checks.find(s=>s.fade===0).pools.created);
  }
  await page.evaluate(()=>poolBench.follow());
  for(const role of ['civilian','police']) {
   await count(role==='civilian'?1:0);await police(role==='police'?1:0);
   const before=await page.evaluate(role=>poolBench.collision(role),role);
   await page.waitForFunction(()=>poolBench.collisionResult().contacts>0&&poolBench.collisionResult().playerDamage>0,null,{timeout:10000});
   const after=await page.evaluate(()=>poolBench.collisionResult());
   if(role==='police')assert.ok(after.police.some(actor=>actor.damage>0));
   await page.evaluate(()=>poolBench.collisionStop());report.checks.push({collision:role,before,after});
  }
  await police(0);await count(0);await page.evaluate(()=>poolBench.follow());
  for(let cycle=0;cycle<10;cycle++){await page.evaluate(()=>poolBench.rebuild());await page.waitForTimeout(500);report.checks.push({rebuild:cycle,state:await sample()});}
  await page.evaluate(()=>poolBench.hidden(true));const hidden=await sample();await page.waitForTimeout(5000);
  assert.deepEqual((await sample()).telemetry.position,hidden.telemetry.position);
  await page.evaluate(()=>poolBench.hidden(false));await page.waitForTimeout(200);report.checks.push({hidden:true});
  await page.evaluate(()=>poolBench.teardownWatch());const before=await sample();
  await page.evaluate(()=>poolBench.finish(true));await page.waitForTimeout(200);assert.equal((await sample()).lifecycle.disposed,false);
  await page.evaluate(()=>poolBench.finish(false));await page.waitForTimeout(200);const final=await sample();
  assert.equal(final.lifecycle.disposed,true);assert.equal(final.lifecycle.frameScheduled,false);assert.equal(final.bodies,0);
  assert.equal(final.resources.geometries,0);assert.equal(final.resources.textures,0);
  assert.equal(final.lifecycle.contextLost,true);assert.equal(await page.evaluate(()=>poolBench.livePrograms()),0);
  assert.ok(final.disposals.every(item=>item.count===1),'Private/shared GPU resources not disposed exactly once: '+JSON.stringify(final.disposals.filter(item=>item.count!==1)));
  await page.evaluate(()=>poolBench.finish(false));assert.deepEqual((await sample()).disposals,final.disposals);
  report.teardown={before,final};assert.deepEqual(report.errors,[]);assert.equal(digest(),report.sourceHash);
  const heaps=report.samples.slice(-5).map(s=>s.state.heap).sort((a,b)=>a-b),median=heaps[2];
  if(trafficCycles>=5) {
  report.memory={lastFive:heaps,range:heaps[4]-heaps[0],budget:Math.max(median*.05,1048576)};
  assert.ok(report.memory.range<=report.memory.budget,'Heap exceeded warmed-state memory budget');
  }
  report.passed=true;console.log(JSON.stringify({passed:true,memory:report.memory,checks:report.checks.length}));
 }finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
