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
      const closed = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        panelHidden: document.querySelector('#settings').hidden,
        panelInert: document.querySelector('#settings').inert,
        expanded: document.querySelector('#settings-button').getAttribute('aria-expanded'),
        performanceHidden: document.querySelector('#performance').hidden,
        loadHidden: document.querySelector('#load-status').hidden,
        remainingText: [...document.body.children].filter(node => node.tagName !== 'SCRIPT' && !['scene', 'speedometer', 'settings-button', 'settings', 'load-status', 'retry-load', 'performance', 'touch-marker'].includes(node.id)).length,
        speed: document.querySelector('#speed').textContent,
      }));
      assert.ok(closed.width <= viewport.width && closed.height <= viewport.height, `closed overflow ${JSON.stringify(closed)}`);
      assert.equal(closed.panelHidden, true); assert.equal(closed.panelInert, true); assert.equal(closed.expanded, 'false');
      assert.equal(closed.performanceHidden, true); assert.equal(closed.loadHidden, true); assert.equal(closed.remainingText, 0);
      assert.equal(await page.locator('#speedometer').isVisible(), true);
      const speedBox = await page.locator('#speedometer').boundingBox();
      assert.ok(speedBox.x >= 0 && speedBox.y >= 0 && speedBox.x + speedBox.width <= viewport.width);
      await page.keyboard.down('w');
      await page.waitForFunction(() => Number(document.querySelector('#speed').textContent) >= 5);
      await page.keyboard.up('w');
      await page.keyboard.press('r');
      await page.waitForFunction(() => document.querySelector('#speed').textContent === '0');
      await page.locator('#settings-button').click();
      assert.equal(await page.locator('#settings').isVisible(), true);
      await page.keyboard.press('Tab');
      assert.ok(await page.locator('#settings-controls').evaluate(node => node.contains(document.activeElement)));
      assert.ok(await page.locator('#settings').evaluate(node => node.scrollHeight >= node.clientHeight));
      for (const label of ['Подвеска', 'Сцепление', 'Мощность', 'Качество', 'Следы шин', 'Базовые настройки', 'Вернуть машину']) {
        assert.equal(await page.locator('#settings-controls').getByText(label, { exact: true }).count(), 1, `${label} Tweakpane control should exist once`);
      }
      const valueBoxes = await page.locator('#settings-controls input[type="text"]').evaluateAll(inputs => inputs.map(input => {
        const rect = input.getBoundingClientRect(); return { width: rect.width, height: rect.height };
      }));
      assert.equal(valueBoxes.length, 6);
      assert.ok(valueBoxes.slice(0, 3).every(box => box.width > 0 && box.height > 0 && box.height < 44), `controls should use native compact sizing ${JSON.stringify(valueBoxes)}`);
      assert.equal(await page.locator('#settings-controls .tp-rotv').evaluate(node => getComputedStyle(node).fontSize), '11px');
      const gripInput = page.locator('#settings-controls input[type="text"]').nth(1);
      await gripInput.fill('0.65');
      await gripInput.press('Enter');
      assert.equal(await page.evaluate(() => window.carLab.tuning.grip), 0.65);
      await page.locator('#settings-controls').getByRole('button', { name: 'Базовые настройки' }).click();
      assert.equal(await page.evaluate(() => window.carLab.tuning.grip), 1.8);
      await page.locator('#settings-controls').getByText('Город', { exact: true }).click();
      const cityWidth = page.locator('#settings-controls input[type="text"]').nth(3);
      assert.equal(await cityWidth.inputValue(), '15');
      const cityWidthBox = await cityWidth.boundingBox();
      assert.ok(cityWidthBox.width > 0 && cityWidthBox.height > 0);
      await cityWidth.fill('12'); await cityWidth.press('Enter');
      await page.waitForFunction(() => window.carLab.city().roadWidth === 12);
      await cityWidth.fill('15'); await cityWidth.press('Enter');
      await page.waitForFunction(() => window.carLab.city().roadWidth === 15);
      await page.locator('#settings-controls').getByText('Трафик', { exact: true }).click();
      const trafficCount = page.locator('#settings-controls input[type="text"]').nth(4);
      assert.equal(await trafficCount.inputValue(), '60');
      const trafficCountBox = await trafficCount.boundingBox();
      assert.ok(trafficCountBox.width > 0 && trafficCountBox.height > 0);
      await trafficCount.fill('0'); await trafficCount.press('Enter');
      await page.waitForFunction(() => window.carLab.trafficStatus().count === 0);
      const trafficActual = page.locator('#settings-controls input[type="text"]').nth(5);
      assert.equal(Number(await trafficActual.inputValue()), 0);
      await trafficCount.fill('6'); await trafficCount.press('Enter');
      await page.waitForFunction(() => window.carLab.trafficStatus().count === 6);
      for (const name of ['Базовые настройки', 'Вернуть машину']) {
        const box = await page.locator('#settings-controls').getByRole('button', { name, exact: true }).boundingBox();
        assert.ok(box.height > 0 && box.height < 44, `${name} should use native compact sizing ${JSON.stringify(box)}`);
      }
      assert.ok(await page.locator('#settings').evaluate(node => node.getBoundingClientRect().right <= innerWidth));
      await page.locator('#settings-controls select').selectOption('Лёгкая');
      assert.equal(await page.evaluate(() => window.carLab.performance().quality), 'low');
      await page.locator('#settings-controls select').selectOption('Высокая');
      const trails = page.locator('#settings-controls label.tp-ckbv_l');
      await trails.click();
      assert.equal(await page.evaluate(() => window.carLab.trails().visible), false);
      await trails.click();
      assert.equal(await page.evaluate(() => window.carLab.trails().visible), true);
      await page.screenshot({ path: `tools/screenshots/settings-${viewport.width}x${viewport.height}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(230);
      assert.equal(await page.locator('#settings').evaluate(node => node.hidden && node.inert), true);
      assert.equal(await page.locator('#settings-button').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-button');
      await page.mouse.move(100, viewport.height / 2);
      await page.mouse.down();
      await page.mouse.move(100, viewport.height / 2 - 60);
      assert.equal(await page.evaluate(() => window.carLab.joystick().active), true);
      await page.evaluate(() => document.querySelector('#settings-button').click());
      assert.equal(await page.evaluate(() => window.carLab.joystick().active), false);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await page.screenshot({ path: `tools/screenshots/clean-${viewport.width}x${viewport.height}.png` });
      assert.deepEqual(errors, []);
      results.push({ viewport, closed, panelHeight: await page.locator('#settings').evaluate(node => node.scrollHeight) });
      await page.close();
    }
    const debug = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await debug.goto(`${baseUrl}#debug`);
    await debug.waitForFunction(() => window.carLab?.modelReady);
    await debug.waitForFunction(() => document.querySelector('#performance').textContent.length > 0);
    assert.equal(await debug.locator('#performance').isVisible(), true);
    await debug.locator('#settings-button').click();
    await debug.locator('#settings-controls').getByText('Город', { exact: true }).click();
    const cityWidth = debug.locator('#settings-controls input[type="text"]').nth(3);
    await cityWidth.fill('18'); await cityWidth.press('Enter');
    await debug.locator('#settings-controls').getByText('Трафик', { exact: true }).click();
    const trafficCount = debug.locator('#settings-controls input[type="text"]').nth(4);
    await trafficCount.fill('30'); await trafficCount.press('Enter');
    const grip = debug.locator('#settings-controls input[type="text"]').nth(1);
    await grip.fill('0.65'); await grip.press('Enter');
    const trails = debug.locator('#settings-controls label.tp-ckbv_l');
    await trails.click();
    await debug.locator('#settings-controls').getByRole('button', { name: 'Записать дефолты' }).click();
    assert.equal(await debug.locator('#settings-controls input[type="text"]').last().inputValue(), 'Дефолты записаны');
    const savedProfile = await debug.evaluate(() => JSON.parse(localStorage.getItem('carwars.defaults.v1')));
    assert.equal(savedProfile.values.roadWidth, 18);
    assert.equal(savedProfile.values.trafficCount, 30);
    assert.equal(savedProfile.values.grip, 0.65);
    assert.equal(savedProfile.values.trails, false);
    assert.equal('debugMode' in savedProfile.values, false);
    await debug.reload();
    await debug.waitForFunction(() => window.carLab?.modelReady && window.carLab.trafficStatus().count === 30);
    assert.equal(await debug.evaluate(() => window.carLab.city().roadWidth), 18);
    assert.equal(await debug.evaluate(() => window.carLab.tuning.grip), 0.65);
    assert.equal(await debug.evaluate(() => window.carLab.trails().visible), false);
    await debug.locator('#settings-button').click();
    await debug.locator('#settings-controls').getByRole('button', { name: 'Базовые настройки' }).click();
    assert.equal(await debug.evaluate(() => window.carLab.tuning.grip), 1.8);
    await debug.reload();
    await debug.waitForFunction(() => window.carLab?.modelReady);
    assert.equal(await debug.evaluate(() => window.carLab.tuning.grip), 0.65);
    await debug.goto(baseUrl);
    await debug.waitForFunction(() => window.carLab?.modelReady);
    assert.equal(await debug.evaluate(() => window.carLab.city().roadWidth), 18);
    assert.equal(await debug.locator('#settings-controls').getByText('Записать дефолты', { exact: true }).count(), 0);
    await debug.goto(`${baseUrl}#debug`);
    await debug.waitForFunction(() => window.carLab?.modelReady);
    await debug.locator('#settings-button').click();
    await debug.locator('#settings-controls').getByText('Город', { exact: true }).click();
    const unsavedWidth = debug.locator('#settings-controls input[type="text"]').nth(3);
    await unsavedWidth.fill('12'); await unsavedWidth.press('Enter');
    await debug.reload();
    await debug.waitForFunction(() => window.carLab?.modelReady);
    assert.equal(await debug.evaluate(() => window.carLab.city().roadWidth), 18);
    await debug.locator('#settings-button').click();
    await debug.locator('#settings-controls').getByRole('button', { name: 'Заводские дефолты' }).click();
    await debug.waitForFunction(() => window.carLab?.modelReady && window.carLab.trafficStatus().count === 60);
    assert.equal(await debug.evaluate(() => window.carLab.city().roadWidth), 15);
    assert.equal(await debug.evaluate(() => window.carLab.tuning.grip), 1.8);
    assert.equal(await debug.evaluate(() => localStorage.getItem('carwars.defaults.v1')), null);
    await debug.close();
    console.log(JSON.stringify({ viewports: results, debug: 'visible only by explicit flag' }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
