// Dedicated visual regression for merged districts and old-style rotating beacons.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const output='docs/knowledge/city-density-rotating-beacons-2026-10-13';
const url=process.env.CARWARS_BASE_URL||'http://127.0.0.1:5188';
fs.mkdirSync(output,{recursive:true});
const report={date:'2026-10-13',matrix:[],beacons:[],screenshots:[],errors:[]};
const hook=`window.densityCheck={scene,traffic,sim,plan:()=>cityPlan,hidePlayer:()=>{car.visible=false;},
  draw:()=>{traffic.render(1,camera,quality);renderer.render(scene,camera);}};
`;
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
  try {
    for(const viewport of [{width:1440,height:900},{width:390,height:844}])for(const quality of ['Лёгкая','Высокая']) {
      console.log(viewport.width,quality);
      const page=await browser.newPage({viewport});
      page.on('pageerror',e=>report.errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
      await page.addInitScript(quality=>localStorage.setItem('carwars.defaults.v1',JSON.stringify({version:1,
        values:{quality,trafficCount:0,policeCount:1,blurStrength:0,roadWidth:15}})),quality);
      await page.route('**/src/main.js*',async route=>{
        const response=await route.fetch();
        await route.fulfill({response,body:(await response.text()).replace('window.carLab = {',hook+'window.carLab = {')
          .replace('if (document.hidden || !modelReady || loadingScreen.isOpen)',
            'if (window.freezeBeacon || document.hidden || !modelReady || loadingScreen.isOpen)')});
      });
      await page.route('**/src/traffic.js*',async route=>{
        const response=await route.fetch();
        await route.fulfill({response,body:(await response.text()).replace('visualAssets?.animate(aiTime + thinkTime, quality)',
          'visualAssets?.animate(window.beaconTime ?? aiTime + thinkTime, quality)')});
      });
      await page.goto(`${url}/?play=1#debug`);
      assert.equal(await page.title(),'Car Stars');
      await page.waitForFunction(()=>window.carLab?.modelReady&&carLab.appearance().player==='active',null,{timeout:120000});
      for(const width of [12,15,30])for(const seed of [1,20261005]) {
        const state=await page.evaluate(({width,seed})=>{
          carLab.setDebugCitySeed(seed);carLab.rebuildCity(width);
          const p=densityCheck.plan();
          let maxRow=0;
          for(const parcel of p.housingParcels) {
            const houses=p.buildings.filter(b=>b.parcelId===parcel.id);
            for(const axis of ['x','z']) {
              const other=axis==='x'?'z':'x',size=other==='x'?'width':'depth';
              for(const h of houses)maxRow=Math.max(maxRow,houses.filter(b=>h[other]>b[other]-b[size]/2&&h[other]<b[other]+b[size]/2).length);
            }
          }
          return {seed,width,buildings:p.buildings.length,cells:p.activeCells.length,
            shapes:p.districts.map(d=>({type:d.type,size:d.cells.length})),parcels:p.housingParcels.length,maxRow,bodies:carLab.worldBodies()};
        },{width,seed});
        assert.ok(state.shapes.some(d=>d.type==='I'));
        assert.ok(state.shapes.some(d=>d.type.startsWith('H')));
        assert.ok(state.shapes.filter(d=>d.type==='O').length<=2);
        assert.ok(state.buildings<=(state.cells-1)*4);
        assert.ok(state.parcels>state.shapes.length);
        assert.ok(state.maxRow<=4);
        report.matrix.push({viewport,quality,...state});
      }
      await page.evaluate(()=>{carLab.setDebugCitySeed(1);carLab.rebuildCity(15);carLab.setDebugCamera([0,480,75],[0,0,0]);});
      await page.waitForTimeout(200);
      const prefix=`${viewport.width}-${quality==='Лёгкая'?'low':'high'}`;
      await page.screenshot({path:`${output}/${prefix}-city.png`});report.screenshots.push(`${prefix}-city.png`);
      const h=await page.evaluate(()=>{
        const district=densityCheck.plan().districts.find(d=>d.type.startsWith('H'));
        const minX=Math.min(...district.cells.map(c=>c[0]*50-175)),maxX=Math.max(...district.cells.map(c=>(c[0]+1)*50-175));
        const minZ=Math.min(...district.cells.map(c=>c[1]*50-175)),maxZ=Math.max(...district.cells.map(c=>(c[1]+1)*50-175));
        return {x:(minX+maxX)/2,z:(minZ+maxZ)/2};
      });
      await page.evaluate(({x,z,height})=>carLab.setDebugCamera([x+20,height,z+35],[x,0,z]),{...h,height:viewport.width===390?300:170});
      await page.waitForTimeout(200);
      await page.screenshot({path:`${output}/${prefix}-H-district.png`});report.screenshots.push(`${prefix}-H-district.png`);
      await page.waitForFunction(()=>densityCheck.traffic.states.some(s=>s.role==='police'&&(!s.appearance||s.appearance.finished)));
      await page.evaluate(()=>{
        window.freezeBeacon=true;
        densityCheck.hidePlayer();
        const actor=densityCheck.traffic.states.find(s=>s.role==='police'),sim=actor.simulation;
        sim.body.position.set(0,.96,0);sim.body.previousPosition.copy(sim.body.position);
        sim.body.quaternion.setFromEuler(0,0,0);sim.body.previousQuaternion.copy(sim.body.quaternion);
        sim.body.velocity.setZero();sim.body.angularVelocity.setZero();
        carLab.setDebugPlayerPose(0,30);carLab.setDebugCamera([7,10,10],[0,0,0]);
      });
      for(const time of [0,.45,.9,1.35]) {
        const state=await page.evaluate(time=>{
          window.beaconTime=time;densityCheck.draw();
          const nodes=[];densityCheck.scene.traverse(node=>{
            if(node.name.includes('beacon scattering')&&node.parent.visible)nodes.push(node);
          });
          return nodes.slice(0,2).map(n=>({name:n.name,angle:n.material.uniforms.angle.value,
            pulse:n.material.uniforms.pulse.value,samples:n.material.uniforms.samples.value}));
        },time);
        assert.equal(state.length,2);assert.ok(state.every(s=>s.pulse>=.16&&s.pulse<=1));
        report.beacons.push({viewport,quality,time,state});
        const name=`${prefix}-beacon-${time}.png`;
        await page.screenshot({path:`${output}/${name}`});report.screenshots.push(name);
      }
      await page.close();
      fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));
    }
    assert.deepEqual(report.errors,[]);
    console.log(JSON.stringify({matrix:report.matrix.length,beacons:report.beacons.length,screenshots:report.screenshots.length,errors:report.errors}));
  }finally{await browser.close();}
})().catch(error=>{fs.writeFileSync(`${output}/report.json`,JSON.stringify({...report,error:error.stack},null,2));console.error(error);process.exitCode=1;});
