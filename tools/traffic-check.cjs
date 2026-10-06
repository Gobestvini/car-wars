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
    await page.waitForFunction(() => window.carLab.trafficStatus().count === 60 && !window.carLab.trafficStatus().pending);
    const initial = await page.evaluate(() => ({ city: window.carLab.city(), ai: window.carLab.trafficAI(),
      positions: window.carLab.traffic(), bodies: window.carLab.worldBodies() }));
    assert.equal(initial.ai.length, 60);
    assert.ok(new Set(initial.ai.map(car => car.goal)).size >= 3);
    assert.ok(initial.ai.every(car => car.route.length > 1 && car.segment.every(Boolean)));
    await page.waitForTimeout(1800);
    const moving = await page.evaluate(() => window.carLab.traffic());
    assert.ok(moving.some((car, index) => Math.hypot(car.x - initial.positions[index].x, car.z - initial.positions[index].z) > 1), 'NPCs should move under physics');

    await page.locator('#settings-button').click();
    await page.locator('#settings-controls').getByText('Трафик', { exact: true }).click();
    const count = page.locator('#settings-controls input[type="text"]').nth(4);
    await count.fill('30'); await count.press('Enter');
    await page.waitForFunction(() => window.carLab.trafficStatus().count === 30);
    assert.equal((await page.evaluate(() => window.carLab.trafficAI())).length, 30);
    await page.screenshot({ path: 'tools/screenshots/traffic-ai-30.png' });
    await count.fill('0'); await count.press('Enter');
    await page.waitForFunction(() => window.carLab.trafficStatus().count === 0);
    assert.equal(await page.evaluate(() => window.carLab.trafficPerformance().trafficBodies), 0);
    assert.equal(await page.evaluate(() => window.carLab.trafficStatus().reservations), 0);
    await count.fill('6'); await count.press('Enter');
    await page.waitForFunction(() => window.carLab.trafficStatus().count === 6);
    await page.locator('#settings-controls').getByText('Город', { exact: true }).click();
    const roadWidth = page.locator('#settings-controls input[type="text"]').nth(3);
    await roadWidth.fill('12'); await roadWidth.press('Enter');
    await page.waitForFunction(() => window.carLab.city().roadWidth === 12);
    assert.equal((await page.evaluate(() => window.carLab.trafficAI())).length, 6);
    await page.locator('#settings-controls').getByRole('button', { name: 'Вернуть машину' }).click();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.carLab.trafficStatus().count), 6);
    assert.ok(await page.locator('#speedometer').isVisible());
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ defaultRoutes: initial.ai.map(car => car.route), defaultGoals: new Set(initial.ai.map(car => car.goal)).size,
      initialWorldBodies: initial.bodies, traffic30WorldBodies: initial.bodies + 24, traffic0WorldBodies: initial.bodies - 6,
      roadWidthAfterRebuild: 12, errors }, null, 2));
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
