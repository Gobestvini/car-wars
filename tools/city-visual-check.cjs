const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5173/';
const phase = process.argv[2] || 'after';
const suite = process.argv[3] || 'markings';
const out = `docs/art/verification/${suite === 'markings' ? 'tire-tracks-markings' : 'mockup-light-materials'}/${phase}`;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const report = { phase, suite, environment: 'Desktop Edge / SwiftShader / DPR 1; not a physical phone', scenes: [] };
  try {
    for (const [width, height] of [[1440,900],[390,844]]) {
      const page = await browser.newPage({ viewport: { width, height } }); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && /WebGL|Shader|GL_INVALID/.test(m.text())) errors.push(m.text()); });
      await page.goto(base + 'tools/city-visual-regression.html');
      await page.waitForFunction(() => window.fixtureReady, { timeout: 60000 });
      if (suite === 'markings') {
        const points = await page.evaluate(() => fixture.markingTracks());
        for (const quality of ['low','high']) for (const name of ['dash','stop','dashX','stopX']) {
          const metrics = await page.evaluate(({quality,name,points}) => {
            const f = fixture, p = points[name]; f.pose([p.x,0,p.z],[5,9,-7]);
            const result = f.draw(quality);
            const gl=f.renderer.getContext(), pixel=new Uint8Array(4), screen=f.project(p.x,.009,p.z);
            const read = () => { gl.readPixels(Math.round(screen.x),innerHeight-1-Math.round(screen.y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel); return [...pixel]; };
            const withTrack=read(); f.tracks.mesh.visible=false; f.draw(quality); const withoutTrack=read();
            f.tracks.mesh.visible=true; f.draw(quality);
            return {...result,withTrack,withoutTrack,segments:f.tracks.count};
          },{quality,name,points});
          if (phase !== 'before') assert.ok(metrics.withTrack.slice(0,3).reduce((s,v,i)=>s+metrics.withoutTrack[i]-v,0)>15,`${name} should darken under tire track`);
          await page.screenshot({ path: `${out}/${width}x${height}-${quality}-${name}.png` });
          report.scenes.push({width,height,quality,name,...metrics});
        }
        const depthAndReset = await page.evaluate(points=>{
          const f=fixture,p=points.stop; f.pose([p.x,0,p.z],[5,9,-7]);
          const screen=f.project(p.x,.009,p.z),gl=f.renderer.getContext(),pixel=new Uint8Array(4);
          const read=()=>{gl.readPixels(Math.round(screen.x),innerHeight-1-Math.round(screen.y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return [...pixel];};
          const blocker=new f.THREE.Mesh(new f.THREE.BoxGeometry(2,2,2),new f.THREE.MeshStandardMaterial({color:'#ffefe0'}));
          blocker.castShadow=true;
          const ray=f.sun.position.clone().sub(f.sun.target.position);blocker.position.set(p.x+ray.x/ray.y*3,3,p.z+ray.z/ray.y*3);f.scene.add(blocker);
          f.draw('high'); const shadowWith=read();f.tracks.mesh.visible=false;f.draw('high');const shadowWithout=read();f.tracks.mesh.visible=true;
          f.scene.remove(blocker);blocker.geometry.dispose();blocker.material.dispose();
          f.car.position.set(p.x,.96,p.z);f.car.rotation.y=0;f.draw();const bodyWith=read();
          f.tracks.mesh.visible=false;f.draw();const bodyWithout=read();f.tracks.mesh.visible=true;
          f.tracks.setConfig({intensity:0});const intensityZero=f.tracks.count;
          f.tracks.setConfig({intensity:1});f.markingTracks();const restored=f.tracks.count;f.rebuild();const rebuilt=f.tracks.count;
          return {shadowWith,shadowWithout,bodyWith,bodyWithout,intensityZero,restored,rebuilt,depthTest:f.tracks.material.depthTest,capacity:f.tracks.capacity};
        },points);
        if(phase!=='before') {
          assert.ok(depthAndReset.shadowWith.slice(0,3).reduce((s,v,i)=>s+depthAndReset.shadowWithout[i]-v,0)>15);
          assert.deepEqual(depthAndReset.bodyWith,depthAndReset.bodyWithout);
        }
        assert.ok(depthAndReset.depthTest&&depthAndReset.restored>0);assert.equal(depthAndReset.intensityZero,0);assert.equal(depthAndReset.rebuilt,0);
        report.scenes.push({width,height,depthAndReset});
      } else {
        for (const quality of ['low','high']) for (const strength of [0,1]) {
          const metrics = await page.evaluate(({quality,strength}) => fixture.draw(quality,strength),{quality,strength});
          await page.screenshot({path:`${out}/${width}x${height}-${quality}-blur${strength}.png`});
          report.scenes.push({width,height,quality,strength,...metrics});
        }
      }
      assert.deepEqual(errors,[]); await page.close();
    }
    fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
