const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const fs = require('node:fs');
const assert = require('node:assert/strict');
const out = 'docs/art/verification/qa-74-76/recheck';
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const report={environment:'Desktop Edge SwiftShader, DPR1; no physical phone',sidewalk:[],drive:[]};
  try {
    for(const [width,height] of [[1440,900],[390,844]]) {
      const page=await browser.newPage({viewport:{width,height}}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error'&&/WebGL|Shader|GL_INVALID/.test(m.text()))errors.push(m.text());});
      await page.goto('http://127.0.0.1:5173/tools/city-visual-regression.html');
      await page.waitForFunction(()=>window.fixtureReady);
      for(const q of ['low','high']) {
        const data=await page.evaluate(q=>{
          const f=fixture;f.tracks.reset();
          for(let i=0;i<240;i++) f.tracks.updateVehicles([{id:'player',wheels:[{grounded:true,longitudinal:15,lateral:9,position:{x:0,z:80+i/40}}]}],true,1/120);
          f.pose([0,0,82.5],[5,3,-7]);f.draw(q);
          const gl=f.renderer.getContext(),pixel=new Uint8Array(4);
          const read=(z,y)=>{const p=f.project(0,y,z);gl.readPixels(Math.round(p.x),innerHeight-1-Math.round(p.y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return [...pixel];};
          const boundaryZ=Array.from({length:16},(_,i)=>82.5+i*.02);
          const boundaryWith=boundaryZ.map(z=>read(z,.159));
          const withTrack=[read(81,.009),read(84,.159)];
          f.tracks.mesh.visible=false;f.draw(q);const withoutTrack=[read(81,.009),read(84,.159)];
          const boundaryWithout=boundaryZ.map(z=>read(z,.159));
          f.tracks.mesh.visible=true;f.draw(q);
          return {withTrack,withoutTrack,count:f.tracks.count,boundaryZ,boundaryWith,boundaryWithout};
        },q);
        data.withTrack.forEach((p,j)=>assert.ok(p.slice(0,3).reduce((s,v,i)=>s+data.withoutTrack[j][i]-v,0)>15,'road and sidewalk both retain visible strip'));
        report.sidewalk.push({width,height,q,...data});
        await page.screenshot({path:`${out}/${width}x${height}-${q}-sidewalk-transition.png`});
      }
      await page.route('**/src/main.js*',async route=>{
        const response=await route.fetch();let source=await response.text();
        source=source.replace('window.carLab = {',`window.qaDrive={start:()=>{Object.assign(sim.spawn,{x:-28.75,z:-48,yaw:0});reset();},sun:()=>sun.position.clone().sub(sun.target.position).normalize().toArray()};window.carLab = {`);
        await route.fulfill({response,body:source});
      });
      await page.addInitScript(()=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,values:{quality:'Высокая',trafficCount:0,policeCount:0,blurStrength:1,roadWidth:15}})));
      await page.goto('http://127.0.0.1:5173/?play=1#debug');await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:60000});
      await page.locator('#loading-screen').waitFor({state:'hidden'});await page.evaluate(()=>qaDrive.start());
      await page.keyboard.down('KeyW');const samples=[];
      for(let i=0;i<60;i++) {await page.waitForTimeout(700);samples.push(await page.evaluate(()=>({telemetry:carLab.telemetry(),sun:qaDrive.sun(),shadow:carLab.shadow(),camera:carLab.camera().mode})));if(samples.at(-1).telemetry.position.z>-17)break;}
      await page.keyboard.up('KeyW');
      fs.writeFileSync(out+`/drive-${width}.json`,JSON.stringify(samples,null,2)+'\n');
      assert.ok(samples.some(x=>x.telemetry.position.z>-17),'ordinary controls cross the entire junction at z=-25');
      for(const x of samples) x.sun.forEach((n,i)=>assert.ok(Math.abs(n-samples[0].sun[i])<1e-9));
      await page.screenshot({path:`${out}/${width}x${height}-live-junction-follow.png`});
      await page.locator('#settings-button').click();
      const cameraSelect=page.locator('#settings-controls .tp-lblv').filter({has:page.getByText('Режим',{exact:true})}).locator('select');
      await cameraSelect.selectOption({label:'Свободная'});await page.locator('#settings-button').click();
      await page.screenshot({path:`${out}/${width}x${height}-live-junction-free.png`});
      assert.deepEqual(errors,[]);report.drive.push({width,height,samples,errors});await page.close();
    }
    fs.writeFileSync(out+'/supplemental-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({sidewalk:report.sidewalk.length,drive:report.drive.length}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
