// Run separately from node:test against npm run dev. No production debug API changes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const output = 'docs/knowledge/city-environment-0093-0094';
const baseUrl = process.env.CARWARS_BASE_URL || 'http://localhost:5173';
fs.mkdirSync(output, { recursive: true });
const report = { date: '2026-10-13', errors: [], matrix: [], screenshots: [], attacks: [], crossings: [] };
const hook = `window.environmentCheck = { sim, scene, camera, tracks,
  plan: () => cityPlan, city: () => cityState };
`;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl'] });
  try {
    for (const viewport of [{width:1440,height:900},{width:390,height:844}])
      for (const quality of ['Лёгкая','Высокая']) {
        const page = await browser.newPage({ viewport });
        console.log('viewport',viewport.width,quality);
        page.on('pageerror', e => report.errors.push(e.message));
        page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
        await page.addInitScript(quality => localStorage.setItem('carwars.defaults.v1', JSON.stringify({version:1,
          values:{quality,trafficCount:0,policeCount:0,blurStrength:0,roadWidth:15}})), quality);
        await page.route('**/src/main.js*', async route => {
          const response = await route.fetch();
          await route.fulfill({response,body:(await response.text()).replace('window.carLab = {', hook+'window.carLab = {')});
        });
        await page.goto(`${baseUrl}/?play=1#debug`);
        assert.equal(await page.title(),'Car Stars','browser must load this project');
        try {
          await page.waitForFunction(() => window.carLab?.modelReady, null, {timeout:120000});
        } catch (error) {
          report.loading=await page.evaluate(()=>({title:document.title,body:document.body.innerText,
            phase:document.getElementById('loading-phase')?.textContent,model:window.carLab?.modelReady,start:window.carLab?.startScreen()}));
          await page.screenshot({path:`${output}/loading-failure.png`});throw error;
        }
        if(await page.evaluate(()=>carLab.startScreen().open))await page.locator('#menu-play').click();
        console.log('model ready');
        await page.waitForFunction(()=>!carLab.startScreen().open);
        await page.waitForFunction(() => carLab.appearance().player === 'active');
        for (const width of [12,15,30]) {
          const state = await page.evaluate(async width => {
            carLab.setDebugCitySeed(1); carLab.rebuildCity(width);
            const {createRoundedSidewalkLayout}=await import('/src/road-surface.js');
            const p=environmentCheck.plan(),city=environmentCheck.city();
            const layout=createRoundedSidewalkLayout(p,p.bounds,p.roadWidth,p.sidewalkWidth,{centerX:0,centerZ:0,width:50,depth:50});
            const bodies=city.staticBodies.filter(b=>!b.wheelSupport);
            return {seed:p.seed,width,boundary:p.boundaryBuildings.length,
              heightRange:[Math.min(...p.boundaryBuildings.map(b=>b.height)),Math.max(...p.boundaryBuildings.map(b=>b.height))],
              houses:city.entries.filter(e=>e.boundary).length,bodies:bodies.length,expectedBodies:p.buildings.length+p.boundaryBuildings.length,
              corners:{convex:layout.corners.filter(c=>c.type==='convex').length,concave:layout.corners.filter(c=>c.type==='concave').length},
              quality:carLab.performance().quality};
          }, width);
          assert.equal(state.houses,state.boundary);assert.equal(state.bodies,state.expectedBodies);
          assert.ok(state.heightRange[0]>=5.4&&state.heightRange[1]<=11.44);
          assert.ok(state.corners.convex>0&&state.corners.concave>0);
          assert.equal(state.quality,quality==='Высокая'?'high':'low');
          report.matrix.push({viewport,quality,...state});
          console.log('width',width);
          if(width===15) {
            const locations = await page.evaluate(() => {
              const p=environmentCheck.plan(), network=p.roadNetwork;
              const nodes=network.intersections.map(node=>({ ...node,neighbors:network.edges
                .filter(e=>e.from===node.id||e.to===node.id).map(e=>network.intersections.find(n=>n.id===(e.from===node.id?e.to:e.from))) }));
              const bend=nodes.find(n=>n.neighbors.length===2&&n.neighbors[0].x!==n.neighbors[1].x&&n.neighbors[0].z!==n.neighbors[1].z);
              const t=nodes.find(n=>n.neighbors.length===3),x=nodes.find(n=>n.neighbors.length===4);
              const edge=p.contour[0],house=p.boundaryBuildings.find(b=>b.segment===0&&b.slot===0);
              const corners=[];
              for(const e of p.contour.filter(e=>e.axis==='x'))for(const a of [e.min,e.max]) {
                const v=p.contour.find(v=>v.axis==='z'&&v.value===a&&(v.min===e.value||v.max===e.value));
                if(!v)continue;
                const hx=a===e.min?1:-1,vz=e.value===v.min?1:-1;
                const nx=v.side==='west'?1:-1,nz=e.side==='north'?1:-1;
                corners.push({x:a,z:e.value,nx,nz,type:hx===nx&&vz===nz?'concave':'convex'});
              }
              return [{label:'L',x:bend.x,z:bend.z},{label:'T',x:t.x,z:t.z},{label:'X',x:x.x,z:x.z},
                {label:'houses',x:house.x,z:house.z}, ...['convex','concave'].map(type=>({label:'boundary-'+type,...corners.find(c=>c.type===type)}))];
            });
            for(const spot of locations) {
              await page.evaluate(({x,z})=>carLab.setDebugCamera([x+15,55,z+22],[x,0,z]),spot);
              await page.waitForTimeout(150);
              const name=`${viewport.width}-${quality==='Высокая'?'high':'low'}-${spot.label}.png`;
              await page.screenshot({path:`${output}/${name}`});
              report.screenshots.push({name,seed:1,width:15,...spot});
            }
          }
        }
        // Real game world, real house bodies. Rendering/fading never replaces collision.
        const attacks=await page.evaluate(async () => {
          const {containsCityPoint}=await import('/src/city-layout.js');
          const {STEP}=await import('/src/vehicle.js');
          const sim=environmentCheck.sim,p=environmentCheck.plan(),city=environmentCheck.city();
          const houseBodies=new Set(city.staticBodies.slice(p.buildings.length,p.buildings.length+p.boundaryBuildings.length));
          const targets=[];
          for(const e of p.contour.filter(e=>e.axis==='x'))for(const a of [e.min,e.max]) {
            const v=p.contour.find(v=>v.axis==='z'&&v.value===a&&(v.min===e.value||v.max===e.value));
            if(v)targets.push({x:a,z:e.value,nx:v.side==='west'?1:-1,nz:e.side==='north'?1:-1});
          }
          const results=[];
          for(const target of targets) {
            const nx=target.nx/Math.SQRT2,nz=target.nz/Math.SQRT2;
            sim.spawn={x:target.x-nx*7,z:target.z-nz*7,y:.96,yaw:Math.atan2(nx,nz)};sim.reset();
            sim.body.velocity.set(nx*18,0,nz*18);let contact=false,inside=true;
            for(let i=0;i<300;i++) {
              sim.step({throttle:.4},STEP);
              inside&&=containsCityPoint(p,sim.body.position.x,sim.body.position.z);
              contact ||= sim.world.contacts.some(c=>(c.bi===sim.body&&houseBodies.has(c.bj))||(c.bj===sim.body&&houseBodies.has(c.bi)));
            }
            results.push({target,contact,inside});
          }
          const entry=city.entries.find(e=>e.boundary),before=sim.world.bodies.length;
          city.occlusion.startProxy(entry,entry.caps);city.occlusion.finishProxy(entry,entry.caps);
          if(before!==sim.world.bodies.length)throw Error('occlusion changed colliders');
          sim.spawn={x:0,z:0,y:.96,yaw:0};sim.reset();return results;
        });
        assert.ok(attacks.every(a=>a.contact&&a.inside));report.attacks.push({viewport,quality,width:30,attacks});
        for(const type of ['convex','concave']) {
          const crossing=await page.evaluate(async type => {
            const {createRoundedSidewalkLayout}=await import('/src/road-surface.js');
            const {STEP}=await import('/src/vehicle.js');
            const p=environmentCheck.plan(),sim=environmentCheck.sim;
            const layout=createRoundedSidewalkLayout(p,p.bounds,p.roadWidth,p.sidewalkWidth,{centerX:0,centerZ:0,width:50,depth:50});
            const c=layout.corners.find(c=>c.type===type&&c.roadFacing);
            const direction=type==='convex'?1:-1,nx=c.sx*direction/Math.SQRT2,nz=c.sz*direction/Math.SQRT2;
            sim.spawn={x:c.point.x-nx*3,z:c.point.z-nz*3,y:.96,yaw:Math.atan2(nx,nz)};sim.reset();
            let raised=false,road=false,maxRise=0;
            for(let i=0;i<480;i++) {
              sim.body.velocity.x=nx*2;sim.body.velocity.z=nz*2;sim.step({},STEP);
              maxRise=Math.max(maxRise,sim.body.position.y);
              for(const wheel of sim.wheels)if(wheel.grounded) {
                raised ||= Math.abs(wheel.result.hitPointWorld.y-.15)<1e-5;
                road ||= Math.abs(wheel.result.hitPointWorld.y)<1e-5;
              }
            }
            const tracks=environmentCheck.tracks;tracks.reset();
            for(let i=0;i<35;i++) {
              const fraction=-.5+i*.06,position={x:c.point.x+c.sx*c.radius*fraction,z:c.point.z+c.sz*c.radius*fraction};
              const wheel={position,grounded:true,slip:.3,lateral:8,longitudinal:12};
              for(let substep=0;substep<4;substep++)tracks.update([wheel],true,STEP);
            }
            tracks.prepareRender();
            carLab.setDebugCamera([c.point.x+8,30,c.point.z+10],[c.point.x,0,c.point.z]);
            return {type,point:c.point,raised,road,maxRise,segments:tracks.count,seed:p.seed,width:p.roadWidth};
          },type);
          report.crossings.push({viewport,quality,...crossing});
          assert.ok(crossing.raised&&crossing.road&&crossing.maxRise<1.3&&crossing.segments>0,JSON.stringify(crossing));
          await page.waitForTimeout(150);
          const name=`${viewport.width}-${quality==='Лёгкая'?'low':'high'}-crossing-${type}.png`;
          await page.screenshot({path:`${output}/${name}`});report.screenshots.push({name,...crossing});
        }
        await page.evaluate(()=>carLab.setDebugCamera([0,480,80],[0,0,0]));
        await page.waitForTimeout(150);
        const overview=`${viewport.width}-${quality==='Лёгкая'?'low':'high'}-overview.png`;
        await page.screenshot({path:`${output}/${overview}`});report.screenshots.push({name:overview,seed:1,width:30});
        const rounds=await page.evaluate(() => {
          const seeds=[];for(let i=0;i<3;i++)seeds.push(carLab.newRound());return seeds;
        });
        assert.equal(new Set(rounds).size,3);
        await page.close();
        fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));
      }
    assert.deepEqual(report.errors,[]);
    console.log(JSON.stringify({matrix:report.matrix.length,screenshots:report.screenshots.length,attacks:report.attacks.length,errors:report.errors}));
  } finally { await browser.close(); }
})().catch(error=>{fs.writeFileSync(`${output}/report.json`,JSON.stringify({...report,failure:error.stack},null,2));console.error(error);process.exitCode=1;});
