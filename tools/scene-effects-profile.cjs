// Supplemental live scenarios: actual keyboard skid smoke and production building fade.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const source = fs.readFileSync('tools/scene-performance.cjs', 'utf8');
const hook = source.slice(source.indexOf('const hook = `') + 14, source.indexOf('`;\nconst percentile'));
assert.ok(hook.startsWith('const originalBenchInput') && hook.endsWith('};'));
const extra = `window.effectsBench={
  skid: turn => { sceneBench.running=false; releasePointer(); cameraMode='follow'; orbitControls.enabled=false;
    keys.clear(); keys.add('KeyW'); if(turn){keys.add(turn>0?'KeyD':'KeyA');keys.add('Space');} },
  resetSkid: () => {sceneBench.configure({quality:'high',blur:1,count:60,police:0});sim.damage=.55;},
  fade: phase => {sceneBench.running=false;releasePointer();keys.clear();cameraMode='free';orbitControls.enabled=true;
    const e=buildingEntries.find(e=>e.height>8&&e.width>4),x=e.x+e.width/2+4,z=e.z;
    sim.body.position.set(x,pickupSurfaceHeight(x,z)+.96,z);sim.body.velocity.setZero();sim.body.angularVelocity.setZero();
    orbitControls.target.set(x,1,z);camera.position.set(phase?e.x-e.width/2-10:x+15,5,z);camera.lookAt(orbitControls.target);
    camera.updateMatrixWorld();return e.id;},
  sample: () => ({...sceneBench.sample(),damageEffects:damageEffects.snapshot()})
};`;
const digest = () => {
  const hash = createHash('sha256');
  for (const file of fs.readdirSync('src').sort()) if (fs.statSync(path.join('src', file)).isFile())
    hash.update(file+'\0').update(fs.readFileSync(path.join('src', file)));
  return hash.digest('hex');
};
(async () => {
  const output = process.env.SCENE_PROFILE_OUT || 'docs/knowledge/scene-optimization/effects-baseline';
  fs.mkdirSync(output, {recursive:true});
  const browser = await chromium.launch({channel:'msedge', headless:true, args:['--enable-webgl']});
  try {
    for (let repeat=1;repeat<=3;repeat++) {
      const context = await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
      const page = await context.newPage(), errors=[];
      page.on('pageerror', error=>errors.push(error.message));
      await page.route('**/src/main.js*', async route=>{
        const response=await route.fetch(),body=await response.text();
        await route.fulfill({response,body:"import {JOYSTICK_RADIUS as benchRadius,JOYSTICK_DEAD_ZONE as benchDeadZone} from './joystick.js';\n"
          +body.replace('window.carLab = {',hook+extra+'window.carLab = {')});
      });
      await page.goto((process.env.CARWARS_BASE_URL||'http://127.0.0.1:5180/')+'?play=1#debug');
      await page.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:120000});
      for (const scenario of ['skid','fade']) {
        const sourceHash=digest();
        await page.evaluate(()=>effectsBench.resetSkid());
        await page.waitForFunction(()=>!carLab.trafficStatus().pending,null,{timeout:180000});
        await page.waitForTimeout(10000);
        await page.evaluate(()=>carLab.startSceneProfile());
        const samples=[];
        for(let second=0;second<60;second++) {
          if(scenario==='skid') {
            if(second%12===0) await page.evaluate(()=>effectsBench.resetSkid());
            await page.evaluate(turn=>effectsBench.skid(turn),second%12<4?0:second%24<12?1:-1);
          } else if(second%3===0) await page.evaluate(phase=>effectsBench.fade(phase),Math.floor(second/3)%2);
          await page.waitForTimeout(1000);
          samples.push(await page.evaluate(()=>effectsBench.sample()));
        }
        const profile=JSON.parse(await page.evaluate(()=>{sceneBench.stop();const result=JSON.stringify(carLab.sceneProfile());carLab.stopSceneProfile();return result;}));
        assert.deepEqual(errors,[]);assert.equal(profile.overwritten,0);assert.equal(digest(),sourceHash);
        const max={tireSmoke:Math.max(...samples.map(s=>s.smoke.active)),damageSmoke:Math.max(...samples.map(s=>s.damageEffects.activeSmoke)),
          proxies:Math.max(...samples.map(s=>s.proxies)),proxyCreated:Math.max(...samples.map(s=>s.occlusion.created))};
        assert.ok(scenario==='skid'?max.tireSmoke>0&&max.damageSmoke>0:max.proxies>0&&max.proxyCreated>1,
          'Scenario did not exercise requested effects: '+JSON.stringify(max));
        fs.writeFileSync(path.join(output,`${scenario}-${repeat}.json`),JSON.stringify({sourceHash,browser:browser.version(),
          environment:await page.evaluate(()=>sceneBench.environment()),affinity:process.env.SCENE_PROFILE_CPU_AFFINITY||null,
          scenario,repeat,durationMs:60000,errors,max,samples,profile},null,2)+'\n');
        console.log(JSON.stringify({scenario,repeat,frames:profile.rows.length,max}));
      }
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
