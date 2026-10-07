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
      await page.goto(base + '#debug'); await page.waitForFunction(() => window.carLab?.modelReady);
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
      report.scenes.push({ width,height,quality,file, errors,...data, desktopFrameInterval: { p95:percentile(frames,.95),p99:percentile(frames,.99) } });
      await page.close();
    }
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report.scenes.map(s=>({ viewport:`${s.width}x${s.height}`,quality:s.quality,calls:s.metrics.calls,triangles:s.metrics.triangles,shadow:s.shadow.mapSize,p95:s.desktopFrameInterval.p95 }))));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
