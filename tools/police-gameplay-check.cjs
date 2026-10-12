// Browser-only diagnostic instrumentation; repository gameplay source is unchanged.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const out='docs/art/verification/police-beacons',report={runs:[],errors:[],instrumentation:'Expose scene and step/render functions in the served main module only; deterministic same-seed route, 2 police, 0 civilians, active pursuit. Software WebGL.'};
(async()=>{
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(/shader error|GL_INVALID|VALIDATE_STATUS/i.test(m.text()))report.errors.push(m.text());});
 await page.addInitScript(()=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{trafficCount:0,policeCount:2,blurStrength:0,quality:'Лёгкая'}})));
 await page.route(/\/src\/main\.js(?:\?.*)?$/,async route=>{
   const response=await route.fetch(),text=await response.text();
   const marker='return { retry: loadCar };';assert.ok(text.includes(marker));
   await route.fulfill({response,body:text.replace(marker,`window.__probe={scene,traffic,sim,camera,tireSmoke,renderer,car,keys,wanted,arrest,settings,
     pause:()=>cancelAnimationFrame(frameRequest),step:control=>traffic.stepWorld(control,STEP),
     render:()=>{traffic.render(1,camera,quality);cityState.updateSignals(trafficSignals,traffic.simulationTime(),camera,quality);renderer.render(scene,camera);}};
     ${marker}`)});
 });
 for(const enabled of [false,true]) {
  await page.goto('http://127.0.0.1:5173/?debug&seed=1');await page.waitForFunction(()=>window.__probe&&carLab.modelReady,null,{timeout:120000});
  await page.waitForFunction(()=>carLab.appearance().player==='active'&&carLab.trafficStatus().appearing===0);
  const result=await page.evaluate(enabled=>{
    const p=__probe;p.pause();p.sim.reset();p.traffic.reset();p.wanted.reset();
    p.wanted.update(0,[{type:'police-collision'}]);p.wanted.update(.6,[{type:'police-collision'}]);
    const volumes=[],lamps=[];p.scene.traverse(n=>{if(n.name.includes('beacon scattering'))volumes.push(n);
      if(n.name==='Red left beacon'||n.name==='Blue right beacon')lamps.push(n);});
    volumes.forEach(v=>v.visible=enabled);
    if(!enabled)p.scene.onBeforeRender=()=>lamps.forEach(n=>{const i=n.name.startsWith('Blue')?1:0;n.material.emissiveIntensity=.25+1.55*(.5+.5*Math.sin(p.traffic.simulationTime()*8+i*Math.PI));});
    const cpu=[],render=[],route=[];
    for(let step=0;step<720;step++) {
      const control={steer:step<240?0:step<480?.22:-.22,throttle:.35,brake:0};
      let start=performance.now();p.step(control);cpu.push(performance.now()-start);
      if(step%6===0) {p.car.position.copy(p.sim.body.position);p.car.quaternion.copy(p.sim.body.quaternion);
        p.camera.position.set(p.car.position.x+16,24,p.car.position.z+20);p.camera.lookAt(p.car.position);p.camera.updateMatrixWorld();
        start=performance.now();p.render();p.renderer.getContext().finish();render.push(performance.now()-start);
        route.push({position:{...p.sim.body.position},damage:p.sim.damage,calls:p.renderer.info.render.calls});}
    }
    return {enabled,simulationSeconds:6,steps:720,renderedFrames:120,cpu,render,route,wanted:p.wanted.snapshot().level,police:p.traffic.roleCount('police'),resources:p.renderer.info.memory};
  },enabled);
  assert.equal(result.police,2);assert.equal(result.wanted,1);report.runs.push(result);
  await page.screenshot({path:`${out}/gameplay-${enabled?'after':'before'}.png`});
 }
 // Existing tire-smoke implementation, together with tilted beacon transforms.
 await page.evaluate(()=>{const p=__probe;p.car.rotation.z=.15;
   const state=p.traffic.states.find(s=>s.role==='police');state.mesh.rotation.z=.15;
   for(let i=0;i<25;i++){const wheel={grounded:true,detached:false,longitudinal:20,lateral:12,contact:{x:state.x,y:.01,z:state.z}};
     p.tireSmoke.sample([{id:state.id,role:'police',x:state.x,z:state.z,wheels:[wheel]}],1/60,{threshold:1,quality:'high',cameraPosition:p.camera.position});
     p.tireSmoke.update(1/60,p.camera,{quality:'high'});}
   p.camera.position.set(state.x+6,8,state.z+11);p.camera.lookAt(state.x,1,state.z);p.camera.updateMatrixWorld();p.render();});
 await page.screenshot({path:`${out}/gameplay-smoke-tilt.png`});
 report.smoke=await page.evaluate(()=>carLab.tireSmoke());
 const a=report.runs[0].route,b=report.runs[1].route;
 report.maximumRouteDelta=Math.max(...a.map((p,i)=>Math.hypot(p.position.x-b[i].position.x,p.position.z-b[i].position.z)));
 assert.ok(report.maximumRouteDelta<1e-6,'lighting must not change deterministic gameplay route');
 assert.deepEqual(report.errors,[]);
}finally{fs.writeFileSync(`${out}/gameplay-report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({runs:report.runs.length,routeDelta:report.maximumRouteDelta,errors:report.errors}));
})().catch(e=>{console.error(e);process.exitCode=1});
