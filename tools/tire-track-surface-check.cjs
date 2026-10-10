const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const out = `docs/art/verification/tire-tracks-markings/${process.argv[2] || 'surface-rework'}`;
fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const report={environment:'Desktop Edge SwiftShader DPR1; not a physical phone',scenes:[]};
  try {
    for(const [width,height] of [[1440,900],[390,844]]) {
      const page=await browser.newPage({viewport:{width,height}}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error'&&/WebGL|Shader|GL_INVALID/.test(m.text()))errors.push(m.text());});
      await page.goto((process.env.CARWARS_BASE_URL||'http://127.0.0.1:5173/')+'tools/city-visual-regression.html');
      await page.waitForFunction(()=>window.fixtureReady);
      for(const quality of ['low','high']) for(const [name,a,b,id] of [
        ['up',[0,80],[0,86],'player'],['down',[0,86],[0,80],'police-1'],
        ['oblique',[-2,80],[2,86],'player'],['rounded',[81.5,81.5],[84.1,84.1],'police-1'],
      ]) {
        const data=await page.evaluate(({a,b,id,quality})=>{
          const f=fixture; f.tracks.reset();
          const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
          for(let i=0;i<=240;i++) f.tracks.updateVehicles([{id,wheels:[{grounded:true,longitudinal:15,lateral:9,
            position:{x:a[0]+(b[0]-a[0])*i/240,z:a[1]+(b[1]-a[1])*i/240}}]}],true,1/120);
          let lo=0,hi=1;const startLow=f.tracks.surfaceHeight(...a)<.1;
          for(let i=0;i<20;i++) {const t=(lo+hi)/2;
            if((f.tracks.surfaceHeight(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)<.1)===startLow)lo=t;else hi=t;}
          const edge=(lo+hi)/2,point=t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
          const target=point(edge);f.pose([target[0],0,target[1]],[3,2,-4]);f.draw(quality);
          const positions=[.01,.025,.05,.08,.12,.18].map(d=>point(edge+(startLow?1:-1)*d/length));
          const gl=f.renderer.getContext(),pixel=new Uint8Array(4);
          const read=([x,z])=>{const p=f.project(x,.159,z);gl.readPixels(Math.round(p.x),innerHeight-1-Math.round(p.y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return [...pixel];};
          const withTrack=positions.map(read);f.tracks.mesh.visible=false;f.draw(quality);const withoutTrack=positions.map(read);
          f.tracks.mesh.visible=true;f.draw(quality);
          return {positions,withTrack,withoutTrack,segments:f.tracks.count,calls:f.renderer.info.render.calls};
        },{a,b,id,quality});
        await page.screenshot({path:`${out}/${width}x${height}-${quality}-${name}.png`});
        fs.writeFileSync(out+'/last-scene.json',JSON.stringify({width,height,quality,name,...data},null,2)+'\n');
        data.withTrack.forEach((p,i)=>assert.ok(p.slice(0,3).reduce((s,v,c)=>s+data.withoutTrack[i][c]-v,0)>15,`${width}/${quality}/${name}: curb gap at ${data.positions[i]}`));
        report.scenes.push({width,height,quality,name,id,...data});
      }
      assert.deepEqual(errors,[]);await page.close();
    }
    fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(`PASS ${report.scenes.length} curb scenes`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
