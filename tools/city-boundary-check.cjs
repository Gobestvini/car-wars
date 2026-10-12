const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const out='docs/art/verification/city-boundary';fs.mkdirSync(out,{recursive:true});
const report={errors:[],maps:[],impacts:[],cycles:[],method:'Edge software WebGL; physical CarSimulation and createCityScene fixture plus main-game lifecycle/occlusion.'};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(/shader error|GL_INVALID|VALIDATE_STATUS/i.test(m.text()))report.errors.push(m.text());});
 await page.route('**/__boundary_fixture',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas></canvas></body>'}));
 await page.goto('http://127.0.0.1:5173/__boundary_fixture');
 await page.evaluate(async()=>{
  const T=await import('/node_modules/three/build/three.module.js'),{createCityPlan}=await import('/src/city-generator.js');
  const {createCityScene}=await import('/src/city-scene.js'),{CarSimulation,STEP}=await import('/src/vehicle.js');
  const {containsCityPoint}=await import('/src/city-layout.js'),{ART,ART_LIGHT}=await import('/src/art-direction.js');
  const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=ART_LIGHT.exposure;
  const scene=new T.Scene();scene.background=new T.Color(ART.fog);scene.add(new T.HemisphereLight(ART_LIGHT.sky,ART_LIGHT.ground,ART_LIGHT.ambient));
  const sun=new T.DirectionalLight(ART_LIGHT.sun,ART_LIGHT.intensity);sun.position.set(-20,60,25);scene.add(sun);
  const camera=new T.PerspectiveCamera(38,innerWidth/innerHeight,.1,1200);camera.position.set(0,700,120);camera.lookAt(0,0,0);
  const simulation=new CarSimulation();window.f={T,renderer,scene,camera,simulation,createCityPlan,createCityScene,containsCityPoint,STEP};
 });
 for(const size of [{width:1440,height:900},{width:390,height:844}]) for(const quality of ['high','low']) for(let seed=1;seed<=6;seed++) {
  await page.setViewportSize(size);
  const row=await page.evaluate(({seed,size,quality})=>{const f=window.f;f.city?.dispose();f.plan=f.createCityPlan(seed);f.city=f.createCityScene(f.scene,f.simulation,f.plan);
    f.renderer.setSize(size.width,size.height);f.camera.aspect=size.width/size.height;f.camera.updateProjectionMatrix();
    f.city.updateSignals({phase:()=>({color:'red'})},0,f.camera,quality);f.renderer.render(f.scene,f.camera);
    return {seed,size,quality,towers:f.plan.boundaryBuildings.length,bodies:f.simulation.world.bodies.length,resources:f.renderer.info.memory};},{seed,size,quality});
  report.maps.push(row);await page.screenshot({path:`${out}/skyline-${seed}-${size.width}-${quality}.png`});
 }
 for(let seed=1;seed<=3;seed++) {
  const row=await page.evaluate(seed=>{const f=window.f;f.city.dispose();f.plan=f.createCityPlan(seed);f.city=f.createCityScene(f.scene,f.simulation,f.plan);
    const cases=[];
    for(const edge of f.plan.contour) for(const t of [0,.5,1]) for(const angle of [0,.35]) {
      const sign=edge.side==='north'||edge.side==='west'?1:-1,along=edge.min+(edge.max-edge.min)*t;
      // Move inward on both tangent and normal near contour corners.
      const tangent=t===0?6:t===1?-6:0;
      const x=edge.axis==='x'?along+tangent:edge.value-sign*9,z=edge.axis==='x'?edge.value-sign*9:along+tangent;
      if(!f.containsCityPoint(f.plan,x,z))continue;
      const yaw=(edge.axis==='x'?(sign>0?0:Math.PI):(sign>0?Math.PI/2:-Math.PI/2))+angle;
      f.simulation.spawn={x,y:.96,z,yaw};f.simulation.reset();f.simulation.body.velocity.set(Math.sin(yaw)*18,0,Math.cos(yaw)*18);
      let contained=true,contacts=0;
      for(let i=0;i<240;i++){f.simulation.step({throttle:.4},f.STEP);contained&&=f.containsCityPoint(f.plan,f.simulation.body.position.x,f.simulation.body.position.z);
        contacts+=f.simulation.world.contacts.filter(c=>c.bi===f.simulation.body||c.bj===f.simulation.body).length;}
      cases.push({edge,t,angle,contained,contacts,end:{...f.simulation.body.position}});
    }
    return {seed,cases};},seed);
  assert.ok(row.cases.every(c=>c.contained&&c.contacts>0));report.impacts.push(row);
 }
 await page.addInitScript(()=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{trafficCount:0,policeCount:2,blurStrength:0}})));
 for(const size of [{width:1440,height:900},{width:390,height:844}]) for(const quality of ['Высокая','Лёгкая']) {
  await page.setViewportSize(size);await page.addInitScript(quality=>{const p=JSON.parse(localStorage.getItem('carwars.defaults.v1'));p.values.quality=quality;localStorage.setItem('carwars.defaults.v1',JSON.stringify(p));},quality);
  await page.goto('http://127.0.0.1:5173/?debug&seed=1');await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:120000});
  const cycles=[];
  for(let i=0;i<20;i++) {await page.evaluate(()=>carLab.newRound());await page.waitForFunction(()=>carLab.appearance().player==='active'&&carLab.trafficStatus().appearing===0);
   await page.waitForTimeout(100);cycles.push(await page.evaluate(()=>({bodies:carLab.worldBodies(),resources:carLab.resources()})));}
  assert.equal(cycles[0].bodies,cycles.at(-1).bodies);assert.equal(cycles[4].resources.geometries,cycles.at(-1).resources.geometries);
  const edge=await page.evaluate(()=>carLab.city().contour[0]);
  const sign=edge.side==='north'||edge.side==='west'?1:-1,along=(edge.min+edge.max)/2;
  const x=edge.axis==='x'?along:edge.value-sign*7,z=edge.axis==='x'?edge.value-sign*7:along;
  await page.evaluate(({x,z,edge,sign})=>{carLab.setDebugPlayerPose(x,z);carLab.setDebugCamera(edge.axis==='x'?[x,20,z+sign*20]:[x+sign*20,20,z],[x,1,z]);},{x,z,edge,sign});
  await page.waitForTimeout(1000);const faded=await page.evaluate(()=>carLab.buildingVisibility().filter(b=>b.opacity<.99).length);assert.ok(faded>0);
  await page.screenshot({path:`${out}/occlusion-${size.width}-${quality}.png`});report.cycles.push({size,quality,cycles,faded});
 }
 assert.deepEqual(report.errors,[]);
 }finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
 console.log(JSON.stringify({maps:report.maps.length,impacts:report.impacts.length,cycles:report.cycles.length,errors:report.errors}));
})().catch(e=>{console.error(e);process.exitCode=1});
