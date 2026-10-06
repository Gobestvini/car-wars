const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const baseUrl = process.env.CARWARS_BASE_URL || 'http://localhost:5173/';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl);
    await page.waitForFunction(() => window.carLab?.modelReady);
    await page.waitForFunction(() => window.carLab.trafficStatus().count === window.carLab.trafficStatus().requestedCount
      && !window.carLab.trafficStatus().pending);
    const initialCity = await page.evaluate(() => window.carLab.city());
    assert.equal(initialCity.bounds, 210);
    assert.equal(initialCity.roadWidth, 15);
    assert.equal(initialCity.buildings, 192);
    assert.equal(initialCity.roadNetwork.intersections.length, 64);
    const initialBodies = await page.evaluate(() => window.carLab.worldBodies());
    const initialTraffic = await page.evaluate(() => window.carLab.trafficStatus());
    const staticBodies = initialBodies - initialTraffic.bodies;
    const initialResources = await page.evaluate(() => window.carLab.resources());
    await page.locator('#settings-button').click();
    await page.locator('#settings-controls').getByText('Город', { exact: true }).click();
    const width = page.locator('#settings-controls input[type="text"]').nth(3);
    const sequence = [12, 30, 15, 12, 30, 15, 30, 12, 15, 30, 12, 15];
    for (const value of sequence) {
      await width.fill(String(value));
      await width.press('Enter');
      await page.waitForFunction(expected => window.carLab.city().roadWidth === expected, value);
      const city = await page.evaluate(() => window.carLab.city());
      assert.equal(city.bounds, 210);
      assert.equal(city.buildings, 192);
      assert.equal(city.roadNetwork.intersections.length, 64);
      assert.ok(city.roads.every(Number.isFinite));
    }
    await page.waitForTimeout(200);
    const finalBodies = await page.evaluate(() => window.carLab.worldBodies());
    const finalTraffic = await page.evaluate(() => window.carLab.trafficStatus());
    assert.equal(finalTraffic.count, initialTraffic.count);
    assert.equal(finalTraffic.bodies + finalTraffic.logical, finalTraffic.count);
    assert.equal(finalBodies, staticBodies + finalTraffic.bodies, `physics bodies leaked: ${staticBodies} static + ${finalTraffic.bodies} physical -> ${finalBodies}`);
    const finalResources = await page.evaluate(() => window.carLab.resources());
    assert.equal(finalResources.geometries, initialResources.geometries,
      `geometry resources leaked: ${initialResources.geometries} -> ${finalResources.geometries}`);
    assert.equal(finalResources.textures, initialResources.textures,
      `texture resources leaked: ${initialResources.textures} -> ${finalResources.textures}`);
    const speedElement = await page.locator('#speedometer').isVisible();
    assert.equal(speedElement, true, 'speed display should remain visible after city rebuilds');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ defaultCity: initialCity, rebuilds: sequence.length, widths: [...new Set(sequence)], worldBodies: finalBodies, resources: finalResources, speedometer: speedElement, errors }, null, 2));
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
