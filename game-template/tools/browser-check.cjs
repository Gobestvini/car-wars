// Optional tool: set PLAYWRIGHT_MODULE or install Playwright separately.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const baseUrl = process.env.GAME_BASE_URL || 'http://127.0.0.1:5173';
(async () => {
  const options = { headless: true };
  if (process.env.BROWSER_CHANNEL) options.channel = process.env.BROWSER_CHANNEL;
  const browser = await chromium.launch(options);
  try {
    fs.mkdirSync('artifacts/screenshots', { recursive: true });
    for (const [name, viewport, touch] of [
      ['desktop', { width: 1280, height: 900 }, false],
      ['mobile', { width: 390, height: 844 }, true],
    ]) {
      const page = await browser.newPage({ viewport, hasTouch: touch, isMobile: touch });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('response', response => { if (response.status() >= 400 && response.url().startsWith(baseUrl)) errors.push(`HTTP ${response.status()}`); });
      await page.goto(baseUrl);
      await page.waitForFunction(() => window.gameDebug?.snapshot().elapsed > 0);
      await page.getByRole('button', { name: 'Пауза', exact: true }).click();
      const before = await page.evaluate(() => window.gameDebug.snapshot().elapsed);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.gameDebug.snapshot().elapsed), before);
      await page.keyboard.down('KeyW');
      assert.ok((await page.evaluate(() => window.gameDebug.snapshot().keys)).includes('KeyW'));
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.deepEqual(await page.evaluate(() => window.gameDebug.snapshot().keys), []);
      await page.keyboard.up('KeyW');
      await page.getByRole('button', { name: 'Сброс', exact: true }).click();
      assert.equal(await page.evaluate(() => window.gameDebug.snapshot().elapsed), 0);
      await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
      await page.waitForFunction(() => window.gameDebug.snapshot().elapsed > 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `artifacts/screenshots/${name}.png` });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Desktop/mobile layout, pause/reset, input and runtime errors: passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
