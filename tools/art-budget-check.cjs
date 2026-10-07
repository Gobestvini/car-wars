const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const base=process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5181/';
const reference='e16dc4d';
const cityBefore=execFileSync('git',['show',`${reference}:src/city-scene.js`],{encoding:'utf8'}).replace("from 'three'","from '/node_modules/three/build/three.module.js'");
const trafficBefore=execFileSync('git',['show',`${reference}:src/traffic.js`],{encoding:'utf8'});
const factoryBefore=trafficBefore.slice(trafficBefore.indexOf('const TRAFFIC_PALETTE'),trafficBefore.indexOf('export function createVehicleRuntime')).replace('function createTrafficAssets','export function createTrafficAssets').replace('function makeTrafficCar','export function makeTrafficCar');
const out='docs/art/verification/budget';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const report={reference,kind:'deterministic rendering fixture, 60 civilians/2 police, fixed transforms; not a physical-phone FPS measurement',cases:[]};
 try {
  for(const [width,height,quality] of [[390,844,'low'],[844,390,'low'],[1440,900,'high']]) {
   const results=[];
   for(const phase of ['before','after']) {
    const page=await browser.newPage({viewport:{width,height}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error' && /Shader|WebGL/.test(m.text()))errors.push(m.text());});
    await page.route('**/__art_budget',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas></canvas></body>'}));
    await page.route('**/__art_before_city.js',r=>r.fulfill({contentType:'text/javascript',body:cityBefore}));
    await page.route('**/__art_before_vehicle.js',r=>r.fulfill({contentType:'text/javascript',body:factoryBefore}));
    await page.goto(base+'__art_budget');
    const data=await page.evaluate(async({phase,quality})=>{
     const THREE=await import('/node_modules/three/build/three.module.js');
     const {createCityPlan}=await import('/src/city-generator.js');
     const {createCityScene}=await import(phase==='before'?'/src/__art_before_city.js':'/src/city-scene.js');
     const {createTrafficAssets,makeTrafficCar}=await import(phase==='before'?'/src/__art_before_vehicle.js':'/src/vehicle-visuals.js');
     const {updateShadowCoverage}=await import('/src/shadow-coverage.js');
     const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
     const {ART,ART_LIGHT}=await import('/src/art-direction.js');
     const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(innerWidth,innerHeight);
     renderer.setPixelRatio(quality==='low'?1:1.75);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
     renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=phase==='before'?1.3:ART_LIGHT.exposure;
     const scene=new THREE.Scene();scene.background=new THREE.Color(phase==='before'?'#ecece6':ART.fog);
     scene.add(new THREE.HemisphereLight(phase==='before'?0xf7fbf0:ART_LIGHT.sky,phase==='before'?0x9aa69b:ART_LIGHT.ground,phase==='before'?2.6:ART_LIGHT.ambient));
     const sun=new THREE.DirectionalLight(phase==='before'?0xfff5df:ART_LIGHT.sun,phase==='before'?3.1:ART_LIGHT.intensity);sun.castShadow=true;
     sun.shadow.mapSize.set(quality==='low'?512:1024,quality==='low'?512:1024);sun.shadow.bias=-.0008;sun.shadow.normalBias=.03;scene.add(sun,sun.target);
     const plan=createCityPlan(),sim={addStaticBox:s=>s,removeStaticBox(){}};
     let city=createCityScene(scene,sim,plan);
     const assets=createTrafficAssets(THREE);
     for(let i=0;i<60;i++){const car=makeTrafficCar(THREE,assets,i);car.position.set(plan.roads[i%8]+3,0,plan.roads[Math.floor(i/8)]+12);scene.add(car);}
     for(let i=0;i<2;i++){const car=makeTrafficCar(THREE,assets,i,'police');car.position.set(i*8-4,0,-7);scene.add(car);}
     const model=(await new GLTFLoader().loadAsync('/models/sedan.glb')).scene;
     if(phase==='after'){const {stylePlayerBody}=await import('/src/vehicle-visuals.js');stylePlayerBody(model.getObjectByName('body'));}
     model.position.set(0,.46,0);model.scale.set(1.25,1.15,1.4);scene.add(model);
     const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.1,200);camera.position.set(12,20,-17);camera.lookAt(0,.5,0);camera.updateMatrixWorld();
     sun.position.set(-14,24,10);sun.target.position.set(0,0,0);updateShadowCoverage(sun,camera,{resolution:sun.shadow.mapSize.x,casterHeight:24});
     const controller={phase:()=>({color:'green'})};city.updateSignals(controller,0,camera,quality);city.occlusion.update(camera,model,1/60);
     await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
     const metrics={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
     const resources=[];
     if(phase==='after')for(let i=0;i<10;i++){
       city.dispose();city=createCityScene(scene,sim,plan);city.updateSignals(controller,0,camera,i%2?'high':'low');renderer.render(scene,camera);
       resources.push({...renderer.info.memory,programs:renderer.info.programs.length});
     }
     return {metrics,resources};
    },{phase,quality});
    assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/${width}x${height}-${quality}-${phase}.png`});
    results.push(data);await page.close();
   }
   const delta={calls:results[1].metrics.calls-results[0].metrics.calls,triangles:results[1].metrics.triangles-results[0].metrics.triangles};
   assert.ok(delta.calls<=(quality==='low'?30:50),JSON.stringify(delta));assert.ok(delta.triangles<=(quality==='low'?40000:100000),JSON.stringify(delta));
   const resources=results[1].resources;assert.deepEqual(resources.slice(4),Array(6).fill(resources[4]));
   report.cases.push({width,height,quality,before:results[0].metrics,after:results[1].metrics,delta,resources});
  }
  fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.cases));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
