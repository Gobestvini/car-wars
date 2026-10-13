const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const out='docs/knowledge/vehicle-surface-2026-10-13';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1000,height:700}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 if(process.env.SURFACE_BASELINE==='1'){
 const originals=['public/models/grey-sedan.glb','public/models/green-sedan.glb',
   'src/traffic-models.js','src/player-lights.js','src/vehicle-surface.js'];
 for(const path of originals){
 let data=execFileSync('git',['show',`${process.env.SURFACE_BASELINE_REF||'ed4e9a0'}:${path}`],{maxBuffer:4*1024*1024});
 if(path.endsWith('.js'))data=data.toString().replaceAll("'three'","'/node_modules/three/build/three.module.js'")
   .replaceAll("'three/addons/","'/node_modules/three/examples/jsm/");
 await page.route(`**/${path.replace('public/','')}*`,r=>r.fulfill({body:data,contentType:path.endsWith('.glb')?'model/gltf-binary':'text/javascript'}));
 }
 }
 await page.route('**/__surface_preview',r=>r.fulfill({contentType:'text/html',body:'<canvas></canvas><style>body{margin:0}</style>'}));
 await page.goto('http://127.0.0.1:5188/__surface_preview');
 await page.evaluate(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
 const {createConceptTrafficAssets,makeConceptTrafficCar,TRAFFIC_MODEL_URLS}=await import('/src/traffic-models.js');
 const {preparePlayerModel}=await import('/src/player-model.js');
 const {createPlayerLights}=await import('/src/player-lights.js');
 const {ART_LIGHT}=await import('/src/art-direction.js');
 const loader=new GLTFLoader();
 const assets=createConceptTrafficAssets(Object.fromEntries(await Promise.all(Object.entries(TRAFFIC_MODEL_URLS).map(async([k,u])=>[k,(await loader.loadAsync('/'+u)).scene]))));
 const cars=[makeConceptTrafficCar(assets,0,'civilian'),makeConceptTrafficCar(assets,1,'civilian'),makeConceptTrafficCar(assets,0,'police')];
 const player=preparePlayerModel((await loader.loadAsync('/models/player-sedan.glb')).scene);createPlayerLights(player.body);player.model.position.y=.96;cars.push(player.model);
 const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=ART_LIGHT.exposure;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const scene=new THREE.Scene();scene.background=new THREE.Color('#bfd8ef');scene.add(new THREE.HemisphereLight(ART_LIGHT.sky,ART_LIGHT.ground,ART_LIGHT.ambient));
 const sun=new THREE.DirectionalLight(ART_LIGHT.sun,ART_LIGHT.intensity);sun.position.fromArray(ART_LIGHT.offset);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-50,right:50,top:50,bottom:-50,near:.1,far:150});sun.shadow.bias=-.0008;sun.shadow.normalBias=.03;scene.add(sun,sun.target);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#8095b4',roughness:1}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
 cars.forEach((c,i)=>{c.position.x=(i-1.5)*5;scene.add(c);});
 const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.1,200);
 window.surface={renderer,scene,camera,cars,assets,sun,draw:(distance,receive=true,lod=true)=>{
 camera.position.set(distance*.6,distance*.65,distance*.8);camera.lookAt(0,.6,0);camera.updateMatrixWorld();
 cars.forEach(c=>c.traverse(m=>{if(m.isMesh)m.receiveShadow=receive;if(m.isLOD){m.autoUpdate=lod;if(!lod){m.levels[0].object.visible=true;m.levels[1].object.visible=false;}}}));
 assets.animate(.2,'high');renderer.render(scene,camera);return cars.slice(0,2).map(c=>c.children[0].getCurrentLevel());}};
 });
 for(const distance of [15,35,60])for(const receive of [true,false])for(const lod of [true,false]){
 const levels=await page.evaluate(({distance,receive,lod})=>surface.draw(distance,receive,lod),{distance,receive,lod});
 await page.screenshot({path:`${out}/${process.env.SURFACE_PHASE||'before'}-${distance}-${receive?'shadow':'clean'}-${lod?'lod':'full'}.png`});console.log(distance,receive,lod,levels);
 }
 const geometry=await page.evaluate(()=>{
 const g=surface.assets.variants.grey.lod,p=g.attributes.position,uv=g.attributes.uv;
 let maxError=0,count=0;
 for(let i=0;i<p.count;i++)if(Math.floor(uv.getX(i)*4)+4*(3-Math.floor(uv.getY(i)*4))===12){
 const u=(uv.getX(i)*4-.03125)/.9375;
 const v=((1-uv.getY(i))*4-3-.03125)/.9375;
 maxError=Math.max(maxError,Math.abs(u-(-p.getZ(i)+2)/4),Math.abs(v-(p.getY(i)-.96+.54)/.86));count++;
 }
 return {doorVertices:count,maximumProjectionError:maxError,lodTriangles:g.index.count/3,
   sharedGeometry:surface.assets.variants.grey.lod===surface.assets.variants.green.lod};
 });
 if(process.env.SURFACE_PHASE==='after'){
 console.log(geometry);
 assert.ok(geometry.doorVertices>50);assert.ok(geometry.maximumProjectionError<1e-5,JSON.stringify(geometry));
 assert.ok(geometry.lodTriangles<1800);assert.equal(geometry.sharedGeometry,true);
 }
 const game=[];
 for(const quality of ['Лёгкая','Высокая']){
 await page.addInitScript(quality=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{quality,trafficCount:20,policeCount:1,blurStrength:1}})),quality);
 await page.goto('http://127.0.0.1:5188/?play=1#debug');
 await page.waitForFunction(()=>window.carLab?.modelReady&&carLab.appearance().player==='active',null,{timeout:60000});
 game.push(await page.evaluate(()=>({model:carLab.playerModel(),blur:carLab.miniatureBlur()})));
 await page.screenshot({path:`${out}/${process.env.SURFACE_PHASE||'before'}-game-${quality==='Лёгкая'?'low':'high'}.png`});
 }
 fs.writeFileSync(`${out}/${process.env.SURFACE_PHASE||'before'}-report.json`,JSON.stringify({geometry,game,errors},null,2));
 if(errors.length)throw new Error(errors.join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
