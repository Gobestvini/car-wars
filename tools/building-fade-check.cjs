const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const out = 'docs/art/verification/building-fade';
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5181/';
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__building_fade',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas></canvas></body>'}));
  await page.goto(base+'__building_fade');
  const report = await page.evaluate(async () => {
   const T=await import('/node_modules/three/build/three.module.js');
   const {BuildingOcclusion}=await import('/src/building-occlusion.js');
   const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:false,preserveDrawingBuffer:true});
   renderer.setSize(390,844); renderer.setClearColor('white');
   const scene=new T.Scene(); scene.add(new T.HemisphereLight(0xffffff,0xffffff,2));
   const camera=new T.OrthographicCamera(-3,3,6.5,-6.5,.1,100); camera.position.set(0,2,10); camera.lookAt(0,2,0); camera.updateMatrixWorld();
   const geometry=new T.BoxGeometry();
   const body=new T.InstancedMesh(geometry,new T.MeshStandardMaterial({color:'#cc6633'}),1); scene.add(body);
   const cap=new T.Mesh(geometry,new T.MeshStandardMaterial({color:'#4779b0'})); cap.position.set(0,3.8,.025); cap.scale.set(4.1,.4,2.1); scene.add(cap);
   const entry={id:1,index:0,x:0,z:0,width:4,height:4,depth:2,color:'#cc6633',opacity:1,caps:[cap],bounds:{min:{x:-2,y:0,z:-1},max:{x:2,y:4,z:1}}};
   const fade=new BuildingOcclusion(T,scene,body,geometry,[entry]); fade.setInstanceVisible(entry,true);
   const gl=renderer.getContext();
   const sample=()=>{
    renderer.render(scene,camera);
    return [2,3.8].map(y=>{
     const point=new T.Vector3(0,y,1.1).project(camera), pixel=new Uint8Array(4);
     gl.readPixels(Math.floor((point.x+1)*195),Math.floor((point.y+1)*422),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
     return [...pixel].slice(0,3);
    });
   };
   const opaque=sample(); fade.startProxy(entry,entry.caps); const fullProxy=sample();
   for(const child of entry.proxy.children) child.material.opacity=.22;
   const faded=sample();
   window.renderFade={renderer,scene,camera,entry,fade};
   return {opaque,fullProxy,faded,expected:opaque.map(rgb=>rgb.map(c=>Math.round(c*.22+255*.78)))};
  });
  for(let i=0;i<2;i++) for(let c=0;c<3;c++) {
   assert.ok(Math.abs(report.opaque[i][c]-report.fullProxy[i][c])<=1,JSON.stringify(report));
   assert.ok(Math.abs(report.faded[i][c]-report.expected[i][c])<=2,JSON.stringify(report));
  }
  await page.screenshot({path:out+'/whole-building-alpha.png'});
  assert.deepEqual(errors,[]); fs.writeFileSync(out+'/alpha-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
