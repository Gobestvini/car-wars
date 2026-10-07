const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const baseUrl = process.env.CARWARS_BASE_URL || 'http://localhost:5173/';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl);
    await page.waitForFunction(() => window.carLab?.modelReady);
    const marks = await page.evaluate(() => window.carLab.roadMarkings());
    const stopLines = await page.evaluate(() => window.carLab.stopLines());
    assert.ok(marks.length > 0);
    const alongX = marks.filter(mark => mark.axis === 'x');
    const alongZ = marks.filter(mark => mark.axis === 'z');
    assert.ok(alongX.length > 0 && alongZ.length > 0);
    assert.ok(alongX.every(mark => Math.abs(mark.longAxisX) > Math.abs(mark.longAxisZ) * 100));
    assert.ok(alongZ.every(mark => Math.abs(mark.longAxisZ) > Math.abs(mark.longAxisX) * 100));
    assert.equal(stopLines.length, 144);
    assert.ok(stopLines.every(line => Math.abs(line.length - 7.2) < 1e-8 && line.thickness === 0.4 && line.distance === 9));
    assert.ok(stopLines.every(line => Math.abs(line.forwardX) + Math.abs(line.forwardZ) === 1));
    await page.screenshot({ path: 'tools/screenshots/road-markings.png' });
    await page.screenshot({ path: 'tools/screenshots/stop-lines-15m.png' });
    await page.locator('#settings-button').click();
    await page.locator('#settings-controls').getByText('Город', { exact: true }).click();
    const roadWidth = page.locator('#settings-controls .tp-lblv').filter({ hasText: 'Ширина дорог, м' }).locator('input[type="text"]');
    await roadWidth.fill('30'); await roadWidth.press('Enter');
    await page.waitForFunction(() => window.carLab.city().roadWidth === 30);
    const wideLines = await page.evaluate(() => window.carLab.stopLines());
    assert.ok(wideLines.every(line => line.length === 14.7 && line.distance === 16.5));
    await page.screenshot({ path: 'tools/screenshots/stop-lines-30m.png' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ marks: marks.length, alongX: alongX.length, alongZ: alongZ.length,
      stopLines: stopLines.length, defaultLength: stopLines[0]?.length, wideLength: wideLines[0]?.length,
      instanceMatrices: 'aligned on both street axes', errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
