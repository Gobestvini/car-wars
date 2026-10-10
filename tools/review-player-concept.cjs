// Capture the actual running game from repeatable inspection angles. The
// camera hook is injected into the test response only; shipped code is intact.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5176/';
const phase = process.argv[2] || 'after';
assert.ok(['before','after'].includes(phase));
const out = `docs/art/models/player-sedan-v2/concept-review/${phase}`;
fs.mkdirSync(out,{recursive:true});
const views = {
  front:[0,.6,13], rear:[0,.6,-13], left:[13,.6,0], right:[-13,.6,0],
  top:[0,16,.001], 'front-quarter':[9,5.5,11], 'rear-quarter':[-9,5.5,-11],
};
(async()=>{
  const browser = await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage({viewport:{width:800,height:600}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error' && /Shader|WebGL/.test(message.text()))errors.push(message.text());});
    if(phase==='before') {
      const baseline=execFileSync('git',['show','409da4b:public/models/player-sedan.glb'],{maxBuffer:4*1024*1024});
      await page.route('**/models/player-sedan.glb',route=>route.fulfill({contentType:'model/gltf-binary',body:baseline}));
    }
    await page.addInitScript(()=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{quality:'Высокая',trafficCount:0,policeCount:0,blurStrength:0}})));
    await page.route('**/src/main.js*',async route=>{
      const response=await route.fetch();
      const source=await response.text();
      assert.ok(source.includes('window.carLab = {'));
      const hook=`window.carReview = (offset) => {
        cameraMode = 'review'; orbitControls.enabled = false;
        orbitControls.target.copy(car.position).add(new THREE.Vector3(0,-.05,0));
        camera.position.copy(new THREE.Vector3(...offset).applyQuaternion(car.quaternion)).add(orbitControls.target);
        camera.fov = 20; camera.updateProjectionMatrix();
        camera.lookAt(orbitControls.target); orbitControls.update();
      };\n`;
      await route.fulfill({response,body:source.replace('window.carLab = {',hook+'window.carLab = {')});
    });
    await page.goto(base+'?play=1#debug');
    await page.waitForFunction(()=>window.carLab?.modelReady && carLab.telemetry().grounded===4,null,{timeout:60000});
    await page.locator('#loading-screen').waitFor({state:'hidden'});
    await page.addStyleTag({content:'body > :not(canvas) { visibility:hidden !important } #scene { visibility:visible !important }'});
    for(const [name,offset] of Object.entries(views)){
      await page.evaluate(offset=>carReview(offset),offset);
      await page.waitForTimeout(300);
      await page.screenshot({path:`${out}/${name}.png`});
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(`${out}/report.json`,JSON.stringify({views:Object.keys(views),model:await page.evaluate(()=>carLab.playerModel()),errors},null,2)+'\n');
    console.log(`Captured ${Object.keys(views).length} in-game views: ${out}`);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
