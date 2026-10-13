const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const out='docs/knowledge/civilian-sides-2026-10-13';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:800,height:600}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/__civilian_sides',r=>r.fulfill({contentType:'text/html',body:'<canvas></canvas><style>body{margin:0}</style>'}));
 await page.goto('http://127.0.0.1:5188/__civilian_sides');
 await page.evaluate(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
 const {createConceptTrafficAssets,makeConceptTrafficCar,TRAFFIC_MODEL_URLS}=await import('/src/traffic-models.js');
 const {ART_LIGHT}=await import('/src/art-direction.js');
 const loader=new GLTFLoader();
 const assets=createConceptTrafficAssets(Object.fromEntries(await Promise.all(Object.entries(TRAFFIC_MODEL_URLS).map(async([k,u])=>[k,(await loader.loadAsync('/'+u)).scene]))));
 const cars=[makeConceptTrafficCar(assets,0,'civilian'),makeConceptTrafficCar(assets,1,'civilian')];
 const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(innerWidth,innerHeight);
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=ART_LIGHT.exposure;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const scene=new THREE.Scene();scene.background=new THREE.Color('#8095b4');scene.add(new THREE.HemisphereLight(ART_LIGHT.sky,ART_LIGHT.ground,ART_LIGHT.ambient));
 const sun=new THREE.DirectionalLight(ART_LIGHT.sun,ART_LIGHT.intensity);sun.position.fromArray(ART_LIGHT.offset);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-50,right:50,top:50,bottom:-50,near:.1,far:150});sun.shadow.bias=-.0008;sun.shadow.normalBias=.03;scene.add(sun,sun.target);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:'#8095b4',roughness:1}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
 cars.forEach(c=>scene.add(c));
 const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.1,150);
 window.sides={renderer,scene,camera,cars,assets,THREE,draw:(variant,side,level,shadow,unlit=false)=>{
 cars.forEach((c,i)=>c.visible=i===variant);
 const car=cars[variant],lod=car.children[0];lod.autoUpdate=false;
 lod.levels.forEach((l,i)=>{l.object.visible=i===level;l.object.receiveShadow=shadow;
 l.object.material=unlit?new THREE.MeshBasicMaterial({map:assets.variants[variant?'green':'grey'].material.map}):assets.variants[variant?'green':'grey'].material;});
 camera.position.set(side*7,6,-9);camera.lookAt(0,.65,0);camera.updateMatrixWorld();renderer.render(scene,camera);
 }};
 });
 for(const variant of [0,1])for(const side of [-1,1])for(const level of [0,1])for(const mode of ['shadow','clean','unlit']){
 await page.evaluate(({variant,side,level,mode})=>sides.draw(variant,side,level,mode==='shadow',mode==='unlit'),{variant,side,level,mode});
 await page.screenshot({path:`${out}/${process.env.SIDES_PHASE||'before'}-${variant?'green':'grey'}-${side}-${level}-${mode}.png`});
 }
 const normals=await page.evaluate(()=>['full','lod'].map(name=>{
 const g=sides.assets.variants.grey[name],p=g.attributes.position,n=g.attributes.normal,u=g.attributes.uv;
 const rows=[],planarSides=new Set();let maximumPlanarTilt=0,planarCorners=0,maximumDoorUVError=0,doorVertices=0;
 for(let i=0;i<p.count;i++)if(Math.floor(u.getX(i)*4)+4*(3-Math.floor(u.getY(i)*4))===12){
 maximumDoorUVError=Math.max(maximumDoorUVError,
 Math.abs((u.getX(i)*4-.03125)/.9375-(-p.getZ(i)+2)/4),
 Math.abs(((1-u.getY(i))*4-3-.03125)/.9375-(p.getY(i)-.96+.54)/.86));doorVertices++;
 }
 for(let j=0;j<g.index.count;j+=3){
 const ids=[0,1,2].map(k=>g.index.getX(j+k));
 if(ids.every(i=>Math.floor(u.getX(i)*4)+4*(3-Math.floor(u.getY(i)*4))===12))
 rows.push({x:ids.map(i=>p.getX(i)),normal:ids.map(i=>[n.getX(i),n.getY(i),n.getZ(i)])});
 if(ids.every(i=>Math.abs(p.getX(i)-Math.sign(p.getX(ids[0]))*.91)<.001))
 for(const i of ids){planarSides.add(Math.sign(p.getX(i)));planarCorners++;maximumPlanarTilt=Math.max(maximumPlanarTilt,Math.hypot(n.getY(i),n.getZ(i)));}
 }return{name,rows,maximumPlanarTilt,planarCorners,planarSides:[...planarSides].sort(),maximumDoorUVError,doorVertices,triangles:g.index.count/3};
 }));
 if(process.env.SIDES_PHASE==='after')for(const g of normals){
 console.log(g.name,g.planarCorners,g.maximumPlanarTilt);
 assert.deepEqual(g.planarSides,[-1,1]);assert.ok(g.maximumPlanarTilt<1e-5,JSON.stringify({name:g.name,tilt:g.maximumPlanarTilt}));
 assert.ok(g.doorVertices>0);assert.ok(g.maximumDoorUVError<1e-5);
 assert.ok(g.triangles<(g.name==='lod'?1800:4500));
 }
 assert.deepEqual(errors,[]);console.log('24 rear-side views, no browser errors');
 const game=[];
 if(process.env.SIDES_PHASE==='after')for(const quality of ['Лёгкая','Высокая']){
 await page.addInitScript(quality=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{quality,trafficCount:20,policeCount:1,blurStrength:1}})),quality);
 await page.goto('http://127.0.0.1:5188/?play=1#debug');
 await page.waitForFunction(()=>window.carLab?.modelReady&&carLab.appearance().player==='active',null,{timeout:60000});
 game.push(await page.evaluate(()=>({traffic:carLab.traffic().length,blur:carLab.miniatureBlur()})));
 await page.screenshot({path:`${out}/after-game-${quality==='Лёгкая'?'low':'high'}.png`});
 }
 assert.deepEqual(errors,[]);
 fs.writeFileSync(`${out}/${process.env.SIDES_PHASE||'before'}-report.json`,JSON.stringify({normals,game,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
