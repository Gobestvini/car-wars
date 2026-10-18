const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const baseUrl = process.env.CARWARS_BASE_URL || 'http://localhost:5173/';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const runs = [];
    fs.mkdirSync('tools/screenshots', { recursive: true });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/shader error|GL_INVALID|VALIDATE_STATUS/i.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript(() => localStorage.setItem('carwars.defaults.v1', JSON.stringify({
      version: 1, values: { trafficCount: 0, policeCount: 0, blurStrength: 0 },
    })));
    // Diagnostic access exists only in the intercepted response, never in the shipped app.
    await page.route(/\/src\/main\.js(?:\?.*)?$/, async route => {
      const response = await route.fetch(), source = await response.text();
      const marker = 'return { retry: loadCar };';
      assert.ok(source.includes(marker));
      await route.fulfill({ response, body: source.replace(marker, `window.markingProbe={
        pause:()=>cancelAnimationFrame(frameRequest),
        rebuild:width=>rebuildCity(width),
        view:(level,shallow=false)=>{
          settings.values.quality=level;applyQuality();
          const node=cityPlan.roadNetwork.intersections.filter(n=>cityState.signalApproaches.some(a=>a.nodeId===n.id))
            .sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
          camera.position.set(node.x,shallow?16:65,node.z+(shallow?48:28));
          camera.lookAt(node.x,0,node.z);camera.updateMatrixWorld();
          cityState.updateSignals(trafficSignals,0,camera,quality);renderer.render(scene,camera);
          return {node:node.id,memory:renderer.info.memory};
        }
      };${marker}`) });
    });
    await page.goto(new URL('?debug&seed=5', baseUrl).href);
    await page.waitForFunction(() => window.carLab?.modelReady && window.markingProbe, null, { timeout: 120000 });
    await page.evaluate(() => markingProbe.pause());
    await page.addStyleTag({ content: '#start-screen, #settings, #settings-button, #hud, #topbar { visibility:hidden!important }' });
    for (const roadWidth of [15, 12, 30, 15]) {
      await page.evaluate(width => markingProbe.rebuild(width), roadWidth);
      const { marks, stopLines, network } = await page.evaluate(() => ({
        marks: carLab.roadMarkings(), stopLines: carLab.stopLines(), network: carLab.city().roadNetwork,
      }));
      const controlled = network.intersections.filter(n => network.edges.filter(e => e.from === n.id || e.to === n.id).length === 4);
      assert.equal(stopLines.length, controlled.length * 4);
      assert.ok(stopLines.length > 0);
      assert.ok(stopLines.every(line => Math.abs(line.length - (roadWidth / 2 - .3)) < 1e-8 && line.thickness === .6 && line.distance === roadWidth / 2 + 1.5));
      for (const axis of ['x', 'z']) for (const kind of ['dash', 'solid']) {
        const items = marks.filter(m => m.axis === axis && m.kind === kind);
        assert.ok(items.length > 0, `${axis} ${kind}`);
        assert.ok(items.every(m => axis === 'x' ? Math.abs(m.longAxisX) > Math.abs(m.longAxisZ) * 100
          : Math.abs(m.longAxisZ) > Math.abs(m.longAxisX) * 100));
        assert.ok(items.every(m => Math.abs(Math.hypot(m.longAxisX, m.longAxisZ) - m.length) < 1e-5));
      }
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        for (const level of ['Высокая', 'Лёгкая']) {
          const view = await page.evaluate(level => markingProbe.view(level), level);
          const label = level === 'Высокая' ? 'high' : 'low';
          await page.screenshot({ path: `tools/screenshots/stop-approaches-${roadWidth}-${viewport.width}-${label}.png` });
          runs.push({ roadWidth, viewport, quality: label, marks: marks.length, stopLines: stopLines.length, ...view });
        }
      }
    }
    await page.evaluate(() => markingProbe.view('Высокая', true));
    await page.screenshot({ path: 'tools/screenshots/stop-approaches-shallow.png' });
    assert.deepEqual(errors, []);
    const report = { runs, errors, renderer: 'Edge software WebGL; viewport emulation, not a physical phone' };
    fs.writeFileSync('tools/screenshots/stop-approaches-report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ runs: runs.length, errors, report: 'tools/screenshots/stop-approaches-report.json' }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
