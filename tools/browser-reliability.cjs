const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/shader error|VALIDATE_STATUS|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
    await page.route('**/models/sedan.glb', route => route.abort());
    await page.goto('http://localhost:5173/#debug');
    await page.locator('#loading-retry').waitFor({ state: 'visible' });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.carLab.modelReady), false);
    assert.equal(await page.evaluate(() => window.carLab.telemetry().speed), 0);
    await page.keyboard.up('KeyW');
    await page.unroute('**/models/sedan.glb');
    await page.locator('#loading-retry').click();
    await page.waitForFunction(() => window.carLab.modelReady);
    await page.locator('#loading-screen').waitFor({ state: 'hidden' });
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#loading-retry').isVisible(), false);
    assert.equal(await page.locator('#performance').isVisible(), true);
    await page.locator('#settings-button').click();
    await page.locator('#settings-controls select').selectOption('Лёгкая');
    assert.equal(await page.evaluate(() => window.carLab.performance().dpr), 1);
    await page.locator('#settings-controls select').selectOption('Высокая');
    assert.equal(await page.evaluate(() => window.carLab.performance().dpr), 1.75);
    await page.locator('#close-settings').click();
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1800);
    await page.keyboard.down('KeyD'); await page.waitForTimeout(1800);
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
    assert.ok(await page.evaluate(() => window.carLab.performance().trailSegments) > 0);
    await page.screenshot({ path: 'tools/screenshots/reliability.png' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ loadingRetry: 'passed', quality: 'passed', shaders: 'passed', metrics: await page.evaluate(() => window.carLab.performance()) }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
