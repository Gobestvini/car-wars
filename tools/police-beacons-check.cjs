const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {PNG}=require(process.env.PNGJS_MODULE||'pngjs');
const fs=require('node:fs'),assert=require('node:assert/strict');
const out='docs/art/verification/police-beacons';fs.mkdirSync(out,{recursive:true});
const report={errors:[],comparisons:[],timings:[],note:'Edge software WebGL; fixture times are not physical-device GPU measurements.'};
function difference(a,b){a=PNG.sync.read(a);b=PNG.sync.read(b);let pixels=0,max=0,sum=0;
 for(let i=0;i<a.data.length;i+=4){let d=0;for(let c=0;c<3;c++){const delta=Math.abs(a.data[i+c]-b.data[i+c]);max=Math.max(max,delta);d+=delta;}if(d>3)pixels++;sum+=d;}return {pixels,max,sum};}
(async()=>{
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:960,height:600}}});
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(/shader error|GL_INVALID|VALIDATE_STATUS/i.test(m.text()))report.errors.push(m.text());});
try{
await page.route('**/__beacon_fixture',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas></canvas></body>'}));
await page.goto('http://127.0.0.1:5173/__beacon_fixture');
await page.evaluate(async()=>{
 const T=await import('/node_modules/three/build/three.module.js'),{GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
 const {createTrafficAssets,makeTrafficCar}=await import('/src/vehicle-visuals.js');
 const {createConceptTrafficAssets,TRAFFIC_MODEL_URLS}=await import('/src/traffic-models.js');
 const {createSignalBeam}=await import('/src/signal-glow.js');
 const {ART,ART_LIGHT}=await import('/src/art-direction.js');
 const loader=new GLTFLoader(),scenes={};for(const [key,url]of Object.entries(TRAFFIC_MODEL_URLS))scenes[key]=(await loader.loadAsync('/'+url)).scene;
 const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);
 renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=ART_LIGHT.exposure;
 const scene=new T.Scene();scene.background=new T.Color(ART.fog);scene.add(new T.HemisphereLight(ART_LIGHT.sky,ART_LIGHT.ground,ART_LIGHT.ambient));
 const sun=new T.DirectionalLight(ART_LIGHT.sun,ART_LIGHT.intensity);sun.position.set(-20,40,20);scene.add(sun);
 const ground=new T.Mesh(new T.PlaneGeometry(40,40).rotateX(-Math.PI/2),new T.MeshStandardMaterial({color:ART.asphalt}));scene.add(ground);
 const camera=new T.PerspectiveCamera(38,innerWidth/innerHeight,.1,100);camera.position.set(6,7,11);camera.lookAt(0,1,0);
 const approach={signalX:6,signalZ:1,forwardX:0,forwardZ:1,rightX:-1,rightZ:0};
 const signal=createSignalBeam([approach]);signal.userData.updateBeam(0,approach,'red');signal.userData.prepare(camera,'high');scene.add(signal);
 const assets={concept:createConceptTrafficAssets(scenes),fallback:createTrafficAssets()};
 window.f={T,renderer,scene,camera,assets,makeTrafficCar,signal};
});
for(const kind of ['concept','fallback']){
 await page.evaluate(kind=>{const f=window.f;if(f.car)f.scene.remove(f.car);f.car=f.makeTrafficCar(f.T,f.assets[kind],0,'police');f.scene.add(f.car);
   f.volumes=[];f.car.traverse(n=>{if(n.name.includes('scattering'))f.volumes.push(n);});
   f.lamps=kind==='concept'?f.assets[kind].variants.police.beacons.map(b=>b.material):f.assets[kind].lights;
   f.lamps.forEach((m,i)=>m.emissiveIntensity=kind==='concept'?.25+1.55*(.5+.5*Math.sin(.03*8+i*Math.PI)):.35+.55*(.5+.5*Math.sin(.03*6+i*Math.PI)));
   f.volumes.forEach(v=>v.visible=false);f.renderer.render(f.scene,f.camera);},kind);
 const before=await page.screenshot({path:`${out}/${kind}-before.png`});
 await page.evaluate(kind=>{f.volumes.forEach(v=>v.visible=true);f.assets[kind].animate(.03);f.renderer.render(f.scene,f.camera);},kind);
 const after=await page.screenshot({path:`${out}/${kind}-after.png`});report.comparisons.push({kind,...difference(before,after)});
 await page.evaluate(async kind=>{
   const f=window.f,counts=[30,60],phases=[];
   for(const fps of counts){const values=[];for(let frame=0;frame<=fps*5;frame++){const time=frame/fps;f.assets[kind].animate(time);values.push({time,pulse:f.volumes.map(v=>v.material.uniforms.pulse.value)});}phases.push({fps,values});}
   f.phases=phases;
   await new Promise(resolve=>{const start=performance.now();function draw(){const t=(performance.now()-start)/1000;f.assets[kind].animate(t);f.renderer.render(f.scene,f.camera);if(t<5)requestAnimationFrame(draw);else resolve();}draw();});
 },kind);
 report.comparisons.push({kind,phases:await page.evaluate(()=>f.phases)});
 for(const [label,rotation]of [['roll',[.2,.8,.15]],['turn',[0,1.4,0]]]){
  await page.evaluate(({kind,rotation})=>{f.car.rotation.set(...rotation);f.assets[kind].animate(.43);f.renderer.render(f.scene,f.camera);},{kind,rotation});
  await page.screenshot({path:`${out}/${kind}-${label}.png`});
 }
 await page.evaluate(kind=>{f.car.rotation.set(0,0,0);f.assets[kind].animate(.03);f.camera.position.set(0,4,11);f.camera.lookAt(0,1,0);
   f.wall=new f.T.Mesh(new f.T.BoxGeometry(12,6,.3),new f.T.MeshStandardMaterial({color:'#857f75'}));f.wall.position.set(0,3,3);f.scene.add(f.wall);f.renderer.render(f.scene,f.camera);},kind);
 const wallOn=await page.screenshot({path:`${out}/${kind}-wall.png`});
 await page.evaluate(()=>{f.volumes.forEach(v=>v.visible=false);f.renderer.render(f.scene,f.camera);});
 const wallOff=await page.screenshot();const delta=difference(wallOn,wallOff);assert.equal(delta.pixels,0,'beacons must not peek through wall');report.comparisons.push({kind,wallOcclusion:delta});
 await page.evaluate(()=>{f.scene.remove(f.wall);f.volumes.forEach(v=>v.visible=true);f.camera.position.set(6,7,11);f.camera.lookAt(0,1,0);});
 for(const enabled of [false,true]) {
   const timings=await page.evaluate(enabled=>{const values=[];f.volumes.forEach(v=>v.visible=enabled);
     for(let i=0;i<60;i++){const start=performance.now();f.renderer.render(f.scene,f.camera);f.renderer.getContext().finish();values.push(performance.now()-start);}
     return {values,calls:f.renderer.info.render.calls,resources:f.renderer.info.memory};},enabled);
   report.timings.push({kind,enabled,frames:60,...timings});
 }
}
assert.deepEqual(report.errors,[]);
}finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await context.close();await browser.close();}
console.log(JSON.stringify({comparisons:report.comparisons.length,errors:report.errors}));
})().catch(e=>{console.error(e);process.exitCode=1;});
