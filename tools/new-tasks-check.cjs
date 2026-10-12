// Optional real-WebGL acceptance harness. Uses the existing external Playwright runtime.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const out='docs/art/verification/new-tasks';fs.mkdirSync(out,{recursive:true});
const report={at:new Date().toISOString(),fixtures:[],application:[],errors:[]};
async function fixture(page,seed=1) {
  await page.route('**/__new_tasks_fixture',route=>route.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas></canvas></body>'}));
  await page.goto('http://127.0.0.1:5173/__new_tasks_fixture');
  await page.evaluate(async seed=>{
    const T=await import('/node_modules/three/build/three.module.js');
    const {createCityPlan}=await import('/src/city-generator.js');
    const {createCityScene}=await import('/src/city-scene.js');
    const {CarSimulation}=await import('/src/vehicle.js');
    const {ART,ART_LIGHT}=await import('/src/art-direction.js');
    const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=ART_LIGHT.exposure;
    const scene=new T.Scene();scene.background=new T.Color(ART.fog);
    scene.add(new T.HemisphereLight(ART_LIGHT.sky,ART_LIGHT.ground,ART_LIGHT.ambient));
    const sun=new T.DirectionalLight(ART_LIGHT.sun,ART_LIGHT.intensity);sun.position.set(-20,45,25);scene.add(sun);
    const camera=new T.PerspectiveCamera(38,innerWidth/innerHeight,.1,1200);camera.position.set(0,650,100);camera.lookAt(0,0,0);
    const simulation=new CarSimulation();let city=createCityScene(scene,simulation,createCityPlan(seed));
    window.fixture={T,renderer,scene,camera,simulation,city,createCityPlan,createCityScene};renderer.render(scene,camera);
  },seed);
}
async function app(page,seed,values={}) {
  await page.addInitScript(values=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{trafficCount:0,policeCount:2,blurStrength:0,...values}})),values);
  await page.goto(`http://127.0.0.1:5173/?debug${seed===null?'':`&seed=${seed}`}`);
  await page.waitForFunction(()=>window.carLab?.modelReady,{timeout:120000});
  await page.waitForTimeout(1200);
}
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(/shader error|VALIDATE_STATUS|GL_INVALID/i.test(m.text()))report.errors.push(m.text());});
  await fixture(page);
  for(const seed of [1,2,3,4,5,6]) {
    const result=await page.evaluate(seed=>{const f=fixture;f.city.dispose();const before=f.simulation.world.bodies.length;
      f.city=f.createCityScene(f.scene,f.simulation,f.createCityPlan(seed));f.renderer.render(f.scene,f.camera);
      return {seed,before,bodies:f.simulation.world.bodies.length,resources:f.renderer.info.memory};},seed);
    assert.equal(result.before,2);await page.screenshot({path:`${out}/city-${seed}.png`});report.fixtures.push(result);
  }
  // Both traffic asset paths, fixed pulse phase and three camera sides.
  await page.evaluate(async()=>{
    const f=fixture,T=f.T;f.city.dispose();
    const {createTrafficAssets,makeTrafficCar}=await import('/src/vehicle-visuals.js');
    const {createConceptTrafficAssets,TRAFFIC_MODEL_URLS}=await import('/src/traffic-models.js');
    const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const loader=new GLTFLoader(),scenes={};
    for(const [key,url] of Object.entries(TRAFFIC_MODEL_URLS))scenes[key]=(await loader.loadAsync('/'+url)).scene;
    f.assets={fallback:createTrafficAssets(),concept:createConceptTrafficAssets(scenes)};f.makeTrafficCar=makeTrafficCar;
    const ground=new T.Mesh(new T.PlaneGeometry(40,40).rotateX(-Math.PI/2),new T.MeshStandardMaterial({color:'#77716a'}));f.scene.add(ground);
  });
  for(const kind of ['concept','fallback']) for(const quality of ['high','low']) for(const [view,position] of [['front',[6,7,11]],['back',[-6,7,-11]],['side',[11,5,0]]]) {
    const result=await page.evaluate(({kind,quality,position,view})=>{
      const f=fixture;if(f.car)f.scene.remove(f.car);
      f.car=f.makeTrafficCar(f.T,f.assets[kind],0,'police');f.scene.add(f.car);
      f.assets[kind].animate(.03,quality);f.camera.position.fromArray(position);f.camera.lookAt(0,1,0);f.renderer.render(f.scene,f.camera);
      return {kind,quality,view,resources:f.renderer.info.memory,calls:f.renderer.info.render.calls};
    },{kind,quality,position,view});
    await page.screenshot({path:`${out}/beacon-${kind}-${quality}-${view}.png`});report.fixtures.push(result);
    if(view==='front'&&quality==='high') for(const time of [.03,.10,.17,.30,.43,.50,.57,.70]) {
      await page.evaluate(({kind,time})=>{fixture.assets[kind].animate(time);fixture.renderer.render(fixture.scene,fixture.camera);},{kind,time});
      await page.screenshot({path:`${out}/pulse-${kind}-${time}.png`});
    }
  }
  await page.evaluate(async()=>{
    const f=fixture,{VehicleAppearance,VehicleSpawnEffects}=await import('/src/vehicle-spawn-effects.js');
    f.clouds=new VehicleSpawnEffects(f.scene);f.timeline=new VehicleAppearance();
    f.clouds.acquire('car',f.timeline,{x:0,y:0,z:0},true);
  });
  for(const time of [.03,.3,.6,.9]) {
    await page.evaluate(time=>{const f=fixture;f.timeline.advance(time-f.timeline.elapsed);f.timeline.apply(f.car);
      f.clouds.update(f.camera,'high');f.renderer.render(f.scene,f.camera);},time);
    await page.screenshot({path:`${out}/appearance-${time}.png`});
  }
  await page.evaluate(()=>fixture.clouds.dispose());
  for(const size of [{width:1440,height:900},{width:390,height:844}]) for(const quality of ['Высокая','Лёгкая']) {
    await page.setViewportSize(size);await app(page,1,{quality});
    await page.screenshot({path:`${out}/game-${size.width}-${quality}.png`});
    for(const width of [12,30,15]) {
      const result=await page.evaluate(width=>{const before=carLab.city();carLab.rebuildCity(width);return {before:before.seed,after:carLab.city().seed,width:carLab.city().roadWidth};},width);
      assert.equal(result.before,result.after);assert.equal(result.width,width);
    }
    const cycles=[];
    for(let i=0;i<20;i++) {
      await page.evaluate(()=>carLab.newRound());
      await page.waitForFunction(()=>carLab.appearance().player!=='appearing'&&carLab.trafficStatus().appearing===0);
      await page.waitForTimeout(150);
      cycles.push(await page.evaluate(()=>({seed:carLab.city().seed,bodies:carLab.worldBodies(),resources:carLab.resources()})));
    }
    assert.equal(cycles[0].bodies,cycles.at(-1).bodies);
    assert.ok(cycles.at(-1).resources.geometries<=Math.max(...cycles.slice(0,5).map(c=>c.resources.geometries)));
    for(let i=0;i<5;i++) {await page.evaluate(()=>carLab.setDebugPoliceCount(0));await page.evaluate(()=>carLab.setDebugPoliceCount(2));
      await page.waitForFunction(()=>carLab.trafficStatus().appearing===0);}
    await page.evaluate(()=>carLab.setDebugPoliceCount(0));
    assert.equal(await page.evaluate(()=>carLab.police().length),0);
    const result=await page.evaluate(()=>carLab.requestVehicleSpawn({role:'police',position:{x:0,y:0,z:10},yaw:0}));
    assert.equal(result.status,'created');
    await page.evaluate(()=>carLab.setDebugPlayerPose(0,10));await page.waitForTimeout(1800);
    const held=await page.evaluate(()=>({appearing:carLab.trafficStatus().appearing,damage:carLab.telemetry().damage}));
    assert.equal(held.appearing,1);assert.equal(held.damage,0);
    await page.evaluate(()=>carLab.setDebugPlayerPose(0,0));await page.waitForFunction(()=>carLab.trafficStatus().appearing===0);
    await page.evaluate(id=>carLab.removeDebugVehicle(id),result.id);
    for(const count of [60,300,0]) {
      await page.evaluate(count=>carLab.setDebugTrafficCount(count),count);
      if(count) await page.waitForFunction(count=>carLab.trafficStatus().count===count,count,{timeout:120000});
      else await page.waitForFunction(()=>carLab.trafficStatus().count===0);
      assert.ok((await page.evaluate(()=>carLab.appearance().effects)).active<=32);
    }
    report.application.push({size,quality,cycles,performance:await page.evaluate(()=>carLab.performance())});
    fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
  }
  await app(page,null,{policeCount:0});
  const signatures=[];
  for(let i=0;i<20;i++) {await page.evaluate(()=>carLab.newRound());signatures.push(await page.evaluate(()=>carLab.city().signature));}
  assert.ok(signatures.every((s,i)=>i===0||s!==signatures[i-1]));report.application.push({randomRounds:20,unique:new Set(signatures).size});
  await page.setViewportSize({width:1440,height:900});
  // Three actual browser worlds observed for two minutes each; opt-in long matrix.
  if(process.argv.includes('--long')) for(const seed of [1,2,3]) {
    await app(page,seed,{trafficCount:60,policeCount:2});
    const samples=[];
    for(let i=0;i<12;i++) {await page.waitForTimeout(10000);samples.push(await page.evaluate(()=>({clock:carLab.trafficClock(),status:carLab.trafficStatus(),ai:carLab.trafficAI(),performance:carLab.performance()})));}
    assert.ok(samples.every(s=>s.ai.every(a=>a.state!=='no-path')));
    assert.ok(samples.at(-1).ai.some(a=>a.completedGoals>0),'traffic completes goals on generated roads');
    report.application.push({seed,observationSeconds:120,samples});
    fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
  }
  assert.deepEqual(report.errors,[]);
 } finally {fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
 console.log(JSON.stringify({fixtures:report.fixtures.length,application:report.application.length,errors:report.errors}));
})().catch(e=>{console.error(e);process.exitCode=1;});
