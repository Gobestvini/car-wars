// Decode/export budgets, shared geometry, damage isolation and real game integration.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const base=process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5176/';
const out='docs/art/models/traffic-sedans/verification';
fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage({viewport:{width:1200,height:800}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error' && /Shader|WebGL/.test(message.text()))errors.push(message.text());});
    await page.addInitScript(()=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{
      quality:'Лёгкая',trafficCount:6,policeCount:2,blurStrength:0,
    }})));
    await page.route('**/src/main.js*',async route=>{
      const response=await route.fetch();
      const source=await response.text();
      const hook=`window.familyReview = () => traffic.states.map(state => ({
        id:state.id, role:state.role, variant:state.mesh.userData.conceptVariant,
        damageable:!!state.mesh.userData.damageableBody,
        triangles:state.mesh.children.map(node=>node.isLOD
          ? node.levels.map(l=>l.object.geometry.index.count/3)
          : node.geometry.index.count/3),
        bodyId:state.simulation.body.id,
      }));\n`;
      await route.fulfill({response,body:source.replace('window.carLab = {',hook+'window.carLab = {')});
    });
    // A missing family atlas/model follows the game's existing retry flow.
    await page.route('**/models/grey-sedan.glb',route=>route.abort());
    await page.goto(base+'?play=1#debug');
    await page.locator('#loading-retry').waitFor({state:'visible',timeout:60000});
    assert.equal(await page.evaluate(()=>carLab.modelReady),false);
    await page.unroute('**/models/grey-sedan.glb');
    await page.locator('#loading-retry').click();
    await page.waitForFunction(()=>window.carLab?.modelReady && carLab.trafficStatus().count===6 && carLab.police().length===2,null,{timeout:60000});
    await page.locator('#loading-screen').waitFor({state:'hidden'});
    const initial=await page.evaluate(()=>({visuals:familyReview(),positions:carLab.traffic(),status:carLab.trafficStatus()}));
    assert.equal(initial.visuals.filter(v=>v.variant==='grey').length,3);
    assert.equal(initial.visuals.filter(v=>v.variant==='green').length,3);
    assert.ok(initial.visuals.filter(v=>v.role==='police').every(v=>v.damageable&&v.variant==='police'));
    assert.equal(new Set(initial.visuals.map(v=>v.bodyId)).size,8);
    await page.screenshot({path:`${out}/game-desktop.png`});
    await page.waitForTimeout(1800);
    const moving=await page.evaluate(()=>carLab.traffic());
    assert.ok(moving.some((p,i)=>Math.hypot(p.x-initial.positions[i].x,p.z-initial.positions[i].z)>.2));
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(300);
    await page.screenshot({path:`${out}/game-mobile.png`});
    // Context preview uses the actual production builder, shader and city lights.
    await page.route('**/__family_preview',route=>route.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas></canvas>'}));
    await page.setViewportSize({width:900,height:650});
    await page.goto(base+'__family_preview');
    const preview=await page.evaluate(async()=>{
      const THREE=await import('/node_modules/three/build/three.module.js');
      const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
      const {TRAFFIC_MODEL_URLS,createConceptTrafficAssets,makeConceptTrafficCar}=await import('/src/traffic-models.js');
      const {ART_LIGHT}=await import('/src/art-direction.js');
      const {CarDeformation}=await import('/src/car-deformation.js');
      const loaded=await Promise.all(Object.entries(TRAFFIC_MODEL_URLS).map(async([key,url])=>[key,(await new GLTFLoader().loadAsync('/'+url)).scene]));
      const assets=createConceptTrafficAssets(Object.fromEntries(loaded));
      const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});
      renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=ART_LIGHT.exposure;
      const scene=new THREE.Scene();scene.background=new THREE.Color('#e8e5dc');
      scene.add(new THREE.HemisphereLight(ART_LIGHT.sky,ART_LIGHT.ground,ART_LIGHT.ambient));
      const sun=new THREE.DirectionalLight(ART_LIGHT.sun,ART_LIGHT.intensity);sun.position.set(-14,24,10);scene.add(sun);
      const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:'#dbd8cf',roughness:1}));
      floor.rotation.x=-Math.PI/2;scene.add(floor);
      const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.1,100);
      const cars={grey:makeConceptTrafficCar(assets,0,'civilian'),green:makeConceptTrafficCar(assets,1,'civilian'),police:makeConceptTrafficCar(assets,0,'police')};
      for(const car of Object.values(cars))scene.add(car);
      const second=makeConceptTrafficCar(assets,0,'police');
      const a=cars.police.userData.damageableBody,b=second.userData.damageableBody;
      const positions=b.geometry.attributes.position.array.slice();
      const deformation=new CarDeformation(a.geometry,new THREE.Matrix4(),{preserveHardEdges:true});
      deformation.apply([{point:{x:.9,y:1.1,z:.1},normal:{x:-1,y:0,z:0},impact:{depth:.25,radius:1.1}}]);
      const deformed=a.geometry.attributes.position.array.some((v,i)=>Math.abs(v-positions[i])>1e-5);
      const isolated=b.geometry.attributes.position.array.every((v,i)=>v===positions[i]);
      deformation.restore();b.geometry.dispose();
      window.familyPreview={assets,cars,renderer,scene,camera,draw:(name,view='front',far=false,time=0)=>{
        Object.entries(cars).forEach(([key,car])=>car.visible=key===name);
        camera.position.set(view==='left'?11:6,view==='left'?1.3:4,view==='rear'?-8:view==='left'?0:8);
        camera.lookAt(0,.9,0);assets.animate(time);
        const lod=cars[name].children.find(node=>node.isLOD);
        if(lod){lod.autoUpdate=false;lod.levels[0].object.visible=!far;lod.levels[1].object.visible=far;}
        renderer.render(scene,camera);
        return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
      }};
      return {deformed,isolated,sharedGeometry:assets.variants.grey.full===assets.variants.green.full,
        atlases:Object.fromEntries(Object.entries(assets.variants).map(([k,v])=>[k,[v.material.map.image.width,v.material.map.image.height]])),
        beacons:assets.variants.police.beacons.map(v=>{v.geometry.computeBoundingBox();return v.geometry.boundingBox.getCenter(new THREE.Vector3()).toArray();})};
    });
    assert.equal(preview.deformed,true);assert.equal(preview.isolated,true);assert.equal(preview.sharedGeometry,true);
    assert.ok(Object.values(preview.atlases).every(size=>size[0]===512&&size[1]===512));
    assert.ok(preview.beacons[0][0]<0 && preview.beacons[1][0]>0);
    const draws={};
    for(const name of ['grey','green','police'])for(const view of ['front','rear','left']){
      draws[`${name}-${view}`]=await page.evaluate(([n,v])=>familyPreview.draw(n,v),[name,view]);
      await page.screenshot({path:`${out}/${name}-${view}.png`});
    }
    draws.distant=await page.evaluate(()=>familyPreview.draw('green','front',true));
    await page.screenshot({path:`${out}/green-distant.png`});
    assert.ok(draws.distant.triangles<1800);assert.equal(draws['grey-front'].calls,2);assert.equal(draws['police-front'].calls,5);
    const beaconIntensities=await page.evaluate(()=>{
      familyPreview.assets.animate(.2);return familyPreview.assets.variants.police.beacons.map(b=>b.material.emissiveIntensity);
    });
    assert.ok(Math.abs(beaconIntensities[0]-beaconIntensities[1])>1);
    assert.deepEqual(errors,[]);
    const report={environment:'Desktop Edge SwiftShader; not a physical phone benchmark',loadRetry:'passed',moving:'passed',initial,preview,draws,beaconIntensities,errors};
    fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({loadRetry:report.loadRetry,moving:report.moving,preview,draws,errors},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
