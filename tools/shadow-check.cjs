const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const baseUrl = process.env.CARWARS_BASE_URL || 'http://localhost:5173/';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(baseUrl);
      await page.waitForFunction(() => window.carLab?.modelReady);
      const checkBounds = async label => {
        await page.waitForTimeout(100);
        const shadow = await page.evaluate(() => window.carLab.shadow());
        assert.equal(shadow.enabled, true);
        assert.ok(shadow.width >= 32 && shadow.height >= 32, `${label}: shadow bounds ${JSON.stringify(shadow)}`);
        assert.ok(shadow.near > 0 && shadow.far > shadow.near && shadow.far < 400, `${label}: invalid depth ${JSON.stringify(shadow)}`);
        assert.ok(shadow.margin >= 16 && shadow.frustumCorners >= 2, `${label}: incomplete ground/caster coverage ${JSON.stringify(shadow)}`);
        assert.ok([shadow.left, shadow.right, shadow.top, shadow.bottom, shadow.centreX, shadow.centreY].every(Number.isFinite));
        return shadow;
      };
      const initial = await checkBounds(`${viewport.width}x${viewport.height} initial`);
      await page.screenshot({ path: `tools/screenshots/shadows-${viewport.width}x${viewport.height}-initial.png` });
      await page.keyboard.down('KeyW'); await page.waitForTimeout(1100); await page.keyboard.up('KeyW');
      const moving = await checkBounds(`${viewport.width}x${viewport.height} moving`);
      assert.ok(Number.isFinite(moving.width) && Number.isFinite(moving.height));
      await page.locator('#settings-button').click();
      await page.locator('#settings-controls select').selectOption('Лёгкая');
      const low = await checkBounds(`${viewport.width}x${viewport.height} low quality`);
      assert.equal(low.resolution, 512);
      await page.locator('#settings-controls select').selectOption('Высокая');
      const high = await checkBounds(`${viewport.width}x${viewport.height} high quality`);
      assert.equal(high.resolution, 1024);
      await page.locator('#close-settings').click();
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      const resized = await checkBounds(`${viewport.height}x${viewport.width} resized`);
      const cost = await page.evaluate(() => window.carLab.performance());
      await page.screenshot({ path: `tools/screenshots/shadows-${viewport.width}x${viewport.height}-resized.png` });
      assert.deepEqual(errors, []);
      results.push({ viewport, initial: { width: initial.width, height: initial.height, margin: initial.margin },
        moving: { width: moving.width, height: moving.height }, lowResolution: low.resolution,
        highResolution: high.resolution, resized: { width: resized.width, height: resized.height },
        renderCost: { fps: cost.fps, frameCpuMs: cost.frameCpuMs, physicsMs: cost.physicsMs, drawCalls: cost.calls } });
      await page.close();
    }
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
