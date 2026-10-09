// Loading retry and frozen-tab terminal timing on the actual application.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5174/';
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    await page.route('**/models/sedan.glb', route => route.abort());
    await page.goto(`${base}?damagePreview=.85#debug`);
    await page.locator('#loading-retry').waitFor({ state: 'visible' });
    const failed = await page.evaluate(() => ({ ready: carLab.modelReady, effects: carLab.damageEffects() }));
    assert.equal(failed.ready, false); assert.equal(failed.effects.activeSmoke, 0); assert.equal(failed.effects.activeFire, 0);
    await page.unroute('**/models/sedan.glb'); await page.locator('#loading-retry').click();
    await page.waitForFunction(() => carLab.modelReady && carLab.damageEffects().activeFire > 0);
    const recovered = await page.evaluate(() => carLab.damageEffects()); assert.equal(recovered.capacity, 288);
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => carLab.telemetry().damage === 0 && carLab.damageEffects().activeSmoke === 0 && carLab.damageEffects().activeFire === 0);
    // Headless Chrome may keep a visible page running despite CDP freeze. Exercise the
    // application's actual document.hidden branch with a controlled visibility input.
    await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
    await page.goto(`${base}?damagePreview=1#debug`); await page.waitForFunction(() => window.carLab?.modelReady, { polling: 50 });
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => carLab.damageEffects().terminalTime), 0);
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
    const resumed = await page.evaluate(() => carLab.damageEffects()); assert.equal(resumed.exploded, false);
    await page.waitForFunction(() => carLab.damageEffects().exploded);
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => carLab.damageEffects().explosions), 1);
    await page.keyboard.press('KeyR'); await page.waitForFunction(() => carLab.damageEffects().explosions === 0);
    console.log(JSON.stringify({ loadingRetry: 'passed', reset: 'passed', terminalHiddenBranchResume: 'passed (controlled document.hidden)', recovered, resumed }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
