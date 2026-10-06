// Camera framing check. Set PLAYWRIGHT_MODULE to an existing Playwright module path.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const baseUrl = process.env.CARWARS_BASE_URL || 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(baseUrl);
      await page.waitForFunction(() => window.carLab?.modelReady);
      await page.waitForTimeout(300);
      const fixedOrientation = await page.evaluate(() => window.carLab.camera().orientation);
      for (const controls of [['KeyW'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyS']]) {
        await page.keyboard.press('KeyR');
        for (const key of controls) await page.keyboard.down(key);
        await page.waitForTimeout(2600);
        for (const key of controls) await page.keyboard.up(key);
        const state = await page.evaluate(() => ({ telemetry: window.carLab.telemetry(), camera: window.carLab.camera(), car: window.carLab.camera().projectCar(), point: window.carLab.camera().projectAhead(2) }));
        if (state.telemetry.speed < 25) continue;
        assert.ok(state.car.x >= 0.2 && state.car.x <= 0.8 && state.car.y >= 0.2 && state.car.y <= 0.8 && state.car.depth < 1,
          `${viewport.width}x${viewport.height} car drifted away from screen center: ${JSON.stringify(state.car)}`);
        assert.ok(Number.isFinite(state.point.x) && Number.isFinite(state.point.y), 'ahead point should project finitely');
        assert.ok(state.point.carLengthPx >= 24, `${viewport.width}x${viewport.height} car length ${state.point.carLengthPx}px`);
        assert.ok(state.camera.orientation.slice(0, 3).every((value, index) => Math.abs(value - fixedOrientation[index]) < 1e-6),
          `${viewport.width}x${viewport.height} camera angle changed under ${controls.join('+')}`);
        results.push({ viewport, controls, speed: state.telemetry.speed, car: state.car, point: state.point });
        await page.screenshot({ path: `tools/screenshots/camera-${viewport.width}x${viewport.height}-${controls.join('')}.png` });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    const debug = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await debug.goto(`${baseUrl}#debug`);
    await debug.waitForFunction(() => window.carLab?.modelReady);
    await debug.locator('#settings-button').click();
    await debug.locator('#settings-controls select').nth(1).selectOption('Свободная');
    const before = await debug.evaluate(() => window.carLab.camera().position);
    await debug.keyboard.down('w'); await debug.waitForTimeout(700); await debug.keyboard.up('w');
    const free = await debug.evaluate(() => ({ camera: window.carLab.camera(), speed: window.carLab.telemetry().speed }));
    assert.equal(free.camera.mode, 'free');
    assert.ok(Math.hypot(...free.camera.position.map((value, index) => value - before[index])) > 3, 'free camera should move');
    assert.ok(free.speed < 1, 'free-camera movement must not accelerate the car');
    await debug.locator('#settings-controls select').nth(1).selectOption('Машина');
    assert.equal(await debug.evaluate(() => window.carLab.camera().mode), 'follow');
    await debug.close();
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
