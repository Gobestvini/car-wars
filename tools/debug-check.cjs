const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5173/';
const key = 'carwars.defaults.v1';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    await fs.mkdir('tools/screenshots', { recursive: true });
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const ready = async () => page.waitForFunction(() => window.carLab?.modelReady);
      const open = async () => { await ready(); await page.locator('#settings-button').click(); };
      const row = label => page.locator('.tp-lblv').filter({ has: page.getByText(label, { exact: true }) });
      const mode = value => row('Режим').locator('select').selectOption({ label: value });
      const distance = async value => {
        const input = row('Дальность, м').locator('input');
        await input.fill(String(value)); await input.press('Enter');
        await page.waitForFunction(expected => window.carLab.camera().far === expected, value);
        const state = await page.evaluate(() => window.carLab.camera());
        assert.equal(state.fogNear, value * 0.5); assert.equal(state.fogFar, value * 0.95);
      };
      await page.goto(base); await open();
      assert.equal(await row('Дальность, м').count(), 0);
      const normal = await page.evaluate(() => window.carLab.camera());
      assert.equal(normal.far, 200); assert.equal(normal.fogNear, 100); assert.equal(normal.fogFar, 260);
      await page.goto(`${base}#debug`); await page.reload(); await open();
      await row('Дальность, м').locator('input').waitFor({ state: 'visible' });
      for (const value of [100, 200, 600, 1000, 300]) await distance(value);
      await distance(100);
      await page.keyboard.press('Escape');
      await page.keyboard.down('KeyW'); await page.waitForTimeout(2800); await page.keyboard.up('KeyW');
      const framed = await page.evaluate(() => window.carLab.camera().projectCar());
      assert.ok(framed.depth < 1 && framed.x > 0.1 && framed.x < 0.9 && framed.y > 0.1 && framed.y < 0.9);
      await page.screenshot({ path: `tools/screenshots/debug-min-follow-${viewport.width}x${viewport.height}.png` });
      await page.locator('#settings-button').click(); await distance(300);
      await mode('Свободная'); await distance(900);
      await mode('Машина'); assert.equal(await row('Дальность, м').locator('input').inputValue(), '300');
      await mode('Свободная'); assert.equal(await row('Дальность, м').locator('input').inputValue(), '900');
      for (const quality of ['Лёгкая', 'Высокая']) {
        await row('Качество').locator('select').selectOption({ label: quality });
        await page.waitForFunction(value => window.carLab.shadow().resolution === value, quality === 'Лёгкая' ? 512 : 1024);
        await page.locator('#settings-controls').getByRole('button', { name: 'Вернуть машину', exact: true }).click();
        assert.equal(await page.evaluate(() => window.carLab.camera().far), 900);
        await page.screenshot({ path: `tools/screenshots/debug-${viewport.width}x${viewport.height}-${quality === 'Лёгкая' ? 'low' : 'high'}.png` });
      }
      await page.locator('#settings-controls').getByRole('button', { name: 'Город', exact: true }).click();
      const width = row('Ширина дорог, м').locator('input');
      await width.fill('20'); await width.press('Enter');
      await page.waitForFunction(() => window.carLab.city().roadWidth === 20);
      assert.equal(await page.evaluate(() => window.carLab.camera().far), 900);
      const count = await page.evaluate(() => window.carLab.trafficStatus().requestedCount);
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      assert.equal(await page.evaluate(() => window.carLab.camera().far), 900);
      assert.equal(await page.evaluate(() => window.carLab.trafficStatus().requestedCount), count);
      await page.setViewportSize(viewport);
      await page.locator('#settings-controls').getByRole('button', { name: 'Записать дефолты', exact: true }).click();
      await page.reload(); await open();
      assert.equal(await page.evaluate(() => window.carLab.camera().far), 300);
      await mode('Свободная'); assert.equal(await page.evaluate(() => window.carLab.camera().far), 900);
      await page.keyboard.press('Escape');
      await page.mouse.move(viewport.width * 0.4, viewport.height * 0.55);
      for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 200);
      await page.mouse.down();
      await page.mouse.move(viewport.width * 0.42, viewport.height * 0.48, { steps: 12 }); await page.mouse.up();
      await page.screenshot({ path: `tools/screenshots/city-plaza-raking-${viewport.width}x${viewport.height}.png` });
      await page.locator('#settings-button').click(); await mode('Машина'); await mode('Свободная');
      await page.keyboard.press('Escape');
      for (let i = 0; i < 45; i++) await page.mouse.wheel(0, 200);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `tools/screenshots/city-distant-${viewport.width}x${viewport.height}.png` });
      await page.mouse.move(viewport.width * 0.4, viewport.height * 0.55); await page.mouse.down();
      await page.mouse.move(viewport.width * 0.55, viewport.height * 0.7, { steps: 12 }); await page.mouse.up();
      await page.screenshot({ path: `tools/screenshots/city-raking-${viewport.width}x${viewport.height}.png` });
      await page.locator('#settings-button').click(); await distance(100);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `tools/screenshots/city-min-distance-${viewport.width}x${viewport.height}.png` });
      await page.locator('#settings-button').click();
      await page.locator('#settings-controls').getByRole('button', { name: 'Заводские дефолты', exact: true }).click();
      await page.waitForTimeout(500); await open();
      assert.equal(await page.evaluate(() => window.carLab.camera().far), 200);
      await mode('Свободная'); assert.equal(await page.evaluate(() => window.carLab.camera().far), 600);
      await page.evaluate(storageKey => localStorage.setItem(storageKey, '{invalid'), key);
      await page.reload(); await open();
      assert.equal(await page.evaluate(() => window.carLab.camera().far), 200);
      await mode('Свободная'); assert.equal(await page.evaluate(() => window.carLab.camera().far), 600);
      assert.deepEqual(errors, []);
      results.push({ viewport, distances: [100, 200, 600, 1000], saved: { follow: 300, free: 900 }, rebuild: true, resize: true, invalidProfileFallback: true, errors });
      await page.close();
    }
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
