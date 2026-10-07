// TASK-0051: actual application captures. This desktop run is not a physical-phone benchmark.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5173/';
const phase = process.env.ART_PHASE || 'after';
const out = path.join('docs/art/verification', phase);
fs.mkdirSync(out, { recursive: true });
const percentile = (v, p) => v.slice().sort((a,b)=>a-b)[Math.min(v.length-1, Math.ceil(v.length*p)-1)];
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const report = { phase, environment: 'desktop Edge SwiftShader; viewport emulation is not a phone', scenes: [] };
  try {
    for (const [width, height, quality] of [[390,844,'low'], [844,390,'low'], [1440,900,'high'], [390,844,'high']]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: quality === 'low' ? 1 : 1.75, hasTouch: true, isMobile: true });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type()==='error' && /Shader|WebGL/.test(m.text())) errors.push(m.text()); });
      await page.goto(base + '#debug'); await page.waitForFunction(() => window.carLab?.modelReady);
      const coldStart = await page.evaluate(()=>({quality:carLab.performance().quality,dpr:carLab.performance().dpr,shadow:carLab.shadow().mapSize}));
      assert.equal(coldStart.quality,'low');assert.equal(coldStart.dpr,1);assert.deepEqual(coldStart.shadow,[512,512]);
      await page.locator('#settings-button').click();
      const qualitySelect = page.locator('#settings-controls select').first();
      await qualitySelect.selectOption(quality === 'low' ? 'Лёгкая' : 'Высокая');
      await page.locator('#settings-button').click();
      await page.waitForTimeout(2000);
      const frames = await page.evaluate(() => new Promise(resolve => {
        const values=[]; let previous; const begin=performance.now();
        function tick(now) { if (previous) values.push(now-previous); previous=now;
          if (now-begin<3000) requestAnimationFrame(tick); else resolve(values); }
        requestAnimationFrame(tick);
      }));
      const data = await page.evaluate(() => ({ metrics: carLab.performance(), resources: carLab.resources(), shadow: carLab.shadow(), city: carLab.city(), camera: carLab.camera(), ready: carLab.modelReady }));
      assert.ok(data.ready); assert.equal(data.metrics.quality,quality);
      assert.equal(data.metrics.dpr, quality === 'low' ? 1 : 1.75);
      assert.deepEqual(errors,[]);
      const file = `${width}x${height}-${quality}.png`;
      await page.screenshot({ path: path.join(out,file) });
      const grayscale=await page.addStyleTag({content:'#scene { filter: grayscale(1); }'});
      await page.screenshot({path:path.join(out,`${width}x${height}-${quality}-grayscale.png`)});await grayscale.evaluate(e=>e.remove());
      report.scenes.push({ width,height,quality,file, coldStart,errors,...data, desktopFrameInterval: { p95:percentile(frames,.95),p99:percentile(frames,.99) } });
      await page.close();
    }
    const page=await browser.newPage({viewport:{width:360,height:740},hasTouch:true,isMobile:true});
    await page.goto(base+'#debug');await page.waitForFunction(()=>window.carLab?.modelReady);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const gear=await page.locator('#settings-button').boundingBox();assert.ok(gear.width>=44 && gear.height>=44);
    await page.locator('#settings-button').click();
    await page.locator('#settings-controls').getByText('Трафик',{exact:true}).click();
    for(const label of ['Машины','Полиция']) {
      const input=page.locator('#settings-controls .tp-lblv').filter({has:page.getByText(label,{exact:true})}).locator('input[type="text"]');
      await input.fill('0');await input.press('Enter');
    }
    await page.locator('#settings-controls').getByText('Город',{exact:true}).click();
    const road=page.locator('#settings-controls .tp-lblv').filter({hasText:'Ширина дорог, м'}).locator('input[type="text"]');
    const select=page.locator('#settings-controls select').first();
    const resources=[];
    for(let i=0;i<10;i++) {
      const width=i%2?15:12;await road.fill(String(width));await road.press('Enter');
      await page.waitForFunction(w=>carLab.city().roadWidth===w,width);
      await select.selectOption(i%2?'Высокая':'Лёгкая');
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.waitForFunction(size=>carLab.shadow().resolution===size,i%2?1024:512);
      resources.push(await page.evaluate(()=>carLab.resources()));
    }
    for(let i=4;i<resources.length;i++) assert.deepEqual(resources[i],resources[4+i%2]);
    await page.screenshot({path:path.join(out,'360x740-settings.png')});
    report.ui={width:360,height:740,touchTarget:gear,noHorizontalOverflow:true,lifecycle:resources,workload:'0 NPC/0 police for resource isolation; normal captures use defaults'};
    await page.close();
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report.scenes.map(s=>({ viewport:`${s.width}x${s.height}`,quality:s.quality,calls:s.metrics.calls,triangles:s.metrics.triangles,shadow:s.shadow.mapSize,p95:s.desktopFrameInterval.p95 }))));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
