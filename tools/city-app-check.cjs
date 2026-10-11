// Hooks are injected into the test response only; production exposes no new mutators.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const phase=process.argv[2]||'after',base=process.env.CARWARS_BASE_URL||'http://127.0.0.1:5173/';
const reviewRoot=process.env.ART_REVIEW_ROOT||'docs/art/verification/mockup-light-materials';
const out=`${reviewRoot}/${phase}/app`;
fs.mkdirSync(out,{recursive:true});
const hook=`
window.cityReview = {
  freeze: value => { window.__cityFrozen = value; },
  pose: () => { window.__cityFrozen=true; Object.assign(sim.spawn,{x:-78,z:-65,yaw:-.4}); reset();
    for(let i=0;i<120;i++) sim.step({brake:1});
    car.position.copy(sim.body.position); car.quaternion.copy(sim.body.quaternion);
    visualWheels.forEach(({pivot,spin},i)=>{ const w=sim.wheels[i];pivot.position.copy(w.position);pivot.quaternion.copy(car.quaternion);spin.rotation.x=w.rotation;offsetPlayerWheel(pivot,w,car,false); });
    cameraMode='review'; orbitControls.enabled=false;
    orbitControls.target.set(-73,0,-68); camera.position.set(-28,60,-116); camera.lookAt(orbitControls.target); },
  draw: (q,b,mode='follow') => {
    settings.values.quality=q==='low'?'Лёгкая':'Высокая'; applyQuality(); miniatureBlur.setStrength(b);
    cameraMode=mode==='free'?'free':'review'; orbitControls.enabled=false;
    updateCamera(0); cityState.updateSignals(trafficSignals,0,camera,quality);
    for(let i=0;i<60;i++) buildingOcclusion.update(camera,car,1/60);
    tracks.prepareRender(); miniatureBlur.render(scene,camera,{mode:cameraMode,car});
    return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      resources:carLab.resources(),blur:miniatureBlur.snapshot(),shadow:carLab.shadow(),
      camera:camera.position.toArray(),target:orbitControls.target.toArray(),car:car.position.toArray(),
      seed:cityPlan.seed,props:cityState.streetProps?.counts};
  },
  nearPose: () => { orbitControls.target.set(-73,0,-68); camera.position.set(-57,23,-86); camera.lookAt(orbitControls.target); },
  setupVehicles: () => { traffic.setCount(2); for(let i=0;i<120;i++) traffic.stepWorld({brake:1},STEP);
    for(const x of [-75,-25,25,75]) for(const z of [-55,-5,45]) if(!traffic.roleCount('police')) traffic.requestSpawn({role:'police',position:{x,y:0,z},yaw:0,options:{placement:'nearest-safe'}});
    return traffic.states.map(s=>({id:s.id,role:s.role})); },
  closeVehicle: (role,side) => { const obj=role==='player'?car:traffic.states.find(s=>s.role===role)?.mesh;
    if(!obj) throw new Error('Missing role '+role); orbitControls.target.copy(obj.position).add(new THREE.Vector3(0,.5,0));
    camera.position.copy(orbitControls.target).add(new THREE.Vector3(side*7,4,side*9)); camera.lookAt(orbitControls.target); },
  rebuild: w => rebuildCity(w),
  closeProp: type => { const p=cityState.streetProps.placements.find(p=>p.type===type && Math.abs(p.x)<100);
    orbitControls.target.set(p.x,type==='lamp'?1.8:.4,p.z);
    camera.position.copy(orbitControls.target).add(new THREE.Vector3(...(type==='lamp'?[5,3,-6]:[1.5,1.2,-2])));
    camera.lookAt(orbitControls.target); return p; },
  props: () => ({counts:cityState.streetProps.counts,placements:cityState.streetProps.placements,
    batches:cityState.streetProps.batches.length,
    triangles:cityState.streetProps.batches.reduce((s,b)=>s+b.count*(b.geometry.index?.count||b.geometry.attributes.position.count)/3,0)}),
  showProps: value => cityState.streetProps.batches.forEach(b=>{b.visible=value;}),
  closeCar: side => { orbitControls.target.copy(car.position).add(new THREE.Vector3(0,.1,0));
    camera.position.copy(orbitControls.target).add(new THREE.Vector3(side*7,4,side*9));camera.lookAt(orbitControls.target); },
};
`;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const report={phase,kind:'Actual game, injected capture-only camera/freeze hooks, isolated traffic=0; desktop SwiftShader, DPR1, not a physical phone',scenes:[]};
 try {
  for(const [width,height] of [[1440,900],[390,844]]) {
   const page=await browser.newPage({viewport:{width,height}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|Shader|GL_INVALID/.test(m.text()))errors.push(m.text());});
   await page.addInitScript(()=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{quality:'Высокая',trafficCount:0,policeCount:0,blurStrength:0,roadWidth:15}})));
   await page.route('**/src/main.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    assert.ok(source.includes('window.carLab = {')&&source.includes('function frame(now) {'));
    source=source.replace('window.carLab = {',hook+'window.carLab = {').replace('function frame(now) {','function frame(now) { if(window.__cityFrozen) { requestAnimationFrame(frame); return; }');
    await route.fulfill({response,body:source});
   });
   await page.goto(base+'?play=1#debug');await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:60000});
   await page.locator('#loading-screen').waitFor({state:'hidden'});
   await page.evaluate(()=>cityReview.pose());assert.equal(await page.evaluate(()=>carLab.telemetry().grounded),4);
   await page.evaluate(()=>cityReview.freeze(true));
   await page.addStyleTag({content:'body > :not(canvas) { visibility:hidden !important } #scene { visibility:visible !important }'});
   for(const q of ['low','high']) for(const b of [0,1]) for(const mode of ['follow','free']) {
    const data=await page.evaluate(({q,b,mode})=>cityReview.draw(q,b,mode),{q,b,mode});
    await page.screenshot({path:`${out}/${width}x${height}-${q}-blur${b}-${mode}.png`});
    assert.deepEqual(data.props,{lamp:160,bin:80});
    assert.equal(data.blur.draws>0,b>0&&mode==='follow');report.scenes.push({width,height,q,b,mode,...data});
   }
   if(process.env.ART_REVIEW_ROOT) {
    await page.evaluate(()=>cityReview.nearPose());
    for(const q of ['low','high']) for(const b of [0,1]) {
      const data=await page.evaluate(({q,b})=>cityReview.draw(q,b,'follow'),{q,b});
      await page.screenshot({path:out+'/'+width+'x'+height+'-near-'+q+'-blur'+b+'.png'});
      report.scenes.push({width,height,q,b,mode:'near',...data});
    }
    const actors=await page.evaluate(()=>cityReview.setupVehicles());
    for(const role of ['player','civilian','police']) for(const side of [-1,1]) {
      await page.evaluate(({role,side})=>cityReview.closeVehicle(role,side),{role,side});
      const data=await page.evaluate(()=>cityReview.draw('high',0,'free'));
      await page.screenshot({path:out+'/'+width+'x'+height+'-'+role+'-side'+side+'.png'});
      report.scenes.push({width,height,q:'high',b:0,mode:role+'-'+side,actors,...data});
    }
   }
   if(phase==='after') {
    const propCost=[];
    for(const q of ['low','high']) {
     const withProps=await page.evaluate(q=>cityReview.draw(q,0,'free'),q);
     const withoutProps=await page.evaluate(q=>{cityReview.showProps(false);return cityReview.draw(q,0,'free');},q);
     await page.evaluate(()=>cityReview.showProps(true));
     propCost.push({q,calls:withProps.calls-withoutProps.calls,triangles:withProps.triangles-withoutProps.triangles});
    }
    for(const type of ['lamp','bin']) {
     await page.evaluate(type=>cityReview.closeProp(type),type);await page.evaluate(()=>cityReview.draw('high',0,'free'));
     const dir=process.env.ART_REVIEW_ROOT ? reviewRoot+'/props' : 'docs/art/verification/street-props';fs.mkdirSync(dir,{recursive:true});
     await page.screenshot({path:dir+'/'+width+'x'+height+'-'+type+'.png'});
    }
    for(const side of [-1,1]) {
     await page.evaluate(side=>cityReview.closeCar(side),side);await page.evaluate(()=>cityReview.draw('high',0,'free'));
     await page.screenshot({path:out+'/'+width+'x'+height+'-car-side'+side+'.png'});
    }
    const lifecycle=[];
    for(let i=0;i<10;i++) {
     await page.evaluate(i=>{cityReview.rebuild(i%2?15:12);cityReview.pose();},i);
     lifecycle.push(await page.evaluate(i=>cityReview.draw(i%2?'high':'low',i%2),i));
    }
    for(let i=6;i<10;i++) assert.deepEqual(lifecycle[i].resources,lifecycle[4+i%2].resources);
    report.lifecycle=lifecycle;report.props=await page.evaluate(()=>cityReview.props());
    fs.writeFileSync((process.env.ART_REVIEW_ROOT ? reviewRoot+'/props/report.json' : 'docs/art/verification/street-props/report.json'),JSON.stringify({environment:report.kind,counts:report.props.counts,batches:report.props.batches,geometryTriangles:report.props.triangles,propCost,lifecycle},null,2)+'\n');
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  if(phase==='after') {
   const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|Shader|GL_INVALID/.test(m.text()))errors.push(m.text());});
   await page.goto(base+'?play=1#debug');await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:60000});
   await page.locator('#loading-screen').waitFor({state:'hidden'});
   const cold=await page.evaluate(()=>({metrics:carLab.performance(),camera:carLab.camera(),profile:localStorage.getItem('carwars.defaults.v1')}));
   assert.equal(cold.profile,null);assert.equal(cold.camera.mode,'follow');
   await page.keyboard.down('KeyW');await page.waitForTimeout(1500);await page.keyboard.up('KeyW');
   const moved=await page.evaluate(()=>({telemetry:carLab.telemetry(),camera:carLab.camera(),trails:carLab.performance().trailSegments}));
   assert.ok(Math.hypot(moved.telemetry.position.x,moved.telemetry.position.z)>1);
   await page.screenshot({path:out+'/390x844-default-live.png'});
   await page.locator('#settings-button').click();
   const cameraSelect=page.locator('#settings-controls .tp-lblv').filter({has:page.getByText('Режим',{exact:true})}).locator('select');
   await cameraSelect.selectOption({label:'Свободная'});assert.equal(await page.evaluate(()=>carLab.camera().mode),'free');
   await cameraSelect.selectOption({label:'Машина'});await page.locator('#settings-button').click();
   await page.keyboard.press('KeyR');await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>carLab.performance().trailSegments),0);
   report.live={cold,moved,reset:true,freeFollow:true,errors};assert.deepEqual(errors,[]);await page.close();
   const gpu=await browser.newPage();await gpu.goto(base+'tools/miniature-blur-regression.html');
   await gpu.waitForFunction(()=>document.querySelector('#results').textContent.trim().startsWith('{'),null,{timeout:60000});
   const color=await gpu.locator('#results').textContent();assert.equal(JSON.parse(color).pass,true);
   fs.writeFileSync(reviewRoot+'/gpu-color-report.json',color+'\n');await gpu.close();
  }
  fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({phase,scenes:report.scenes.length,props:report.props?.counts,lifecycle:report.lifecycle?.map(x=>x.resources)}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
