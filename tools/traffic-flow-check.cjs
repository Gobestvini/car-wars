const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5173/';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge',
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    await fs.mkdir('tools/screenshots', { recursive: true });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}#debug`); await page.waitForFunction(() => window.carLab?.modelReady);
      await page.waitForFunction(() => window.carLab.trafficStatus().count === 60);
      await page.locator('#settings-button').click();
      const row = label => page.locator('.tp-lblv').filter({ has: page.getByText(label, { exact: true }) });
      await row('Качество').locator('select').selectOption({ label: 'Лёгкая' });
      await row('Режим').locator('select').selectOption({ label: 'Свободная' });
      await row('Дальность, м').locator('input').fill('1000');
      await row('Дальность, м').locator('input').press('Enter');
      await page.keyboard.press('Escape');
      await page.mouse.move(viewport.width * 0.4, viewport.height * 0.45);
      for (let i = 0; i < 35; i++) await page.mouse.wheel(0, 200);
      await page.mouse.down();
      await page.mouse.move(viewport.width * 0.4, viewport.height * 0.7, { steps: 15 }); await page.mouse.up();
      await page.waitForTimeout(600);
      const sample = () => page.evaluate(() => ({ time: window.carLab.trafficClock(), cars: window.carLab.traffic(),
        ai: window.carLab.trafficAI(), status: window.carLab.trafficStatus(), camera: window.carLab.camera() }));
      let previous = await sample(), windowStart = previous.time;
      const start = previous.time, distance = new Map(), windows = [];
      const duration = viewport.width > 1000 ? 180 : 60;
      let minimumMoving = 60, maximumStillTime = 0, stillTime = 0;
      const deadline = Date.now() + duration * 2500;
      await page.screenshot({ path: `tools/screenshots/traffic-flow-start-${viewport.width}.png` });
      while (previous.time - start < duration) {
        assert.ok(Date.now() < deadline, 'simulation failed to advance');
        await page.waitForTimeout(500);
        const current = await sample(), elapsed = current.time - previous.time;
        const before = new Map(previous.ai.map((ai, index) => [ai.id, previous.cars[index]]));
        current.ai.forEach((ai, index) => {
          const old = before.get(ai.id), car = current.cars[index];
          if (old) distance.set(ai.id, (distance.get(ai.id) || 0) + Math.hypot(car.x - old.x, car.z - old.z));
        });
        const moving = current.cars.filter(car => car.speed > 0.5).length;
        minimumMoving = Math.min(minimumMoving, moving);
        stillTime = moving < 6 ? stillTime + elapsed : 0;
        maximumStillTime = Math.max(maximumStillTime, stillTime);
        if (current.time - windowStart >= 60) {
          const active = [...distance.values()].filter(metres => metres > 5).length;
          assert.equal(active, 60, `traffic froze: ${active}/60 active at ${current.time}s`);
          assert.ok(current.ai.every(ai => ai.reservationAge === null || ai.reservationAge < 20), 'stale junction owner');
          windows.push({ time: current.time, active, moving, minimumTravel: Math.min(...distance.values()) });
          console.log(JSON.stringify({ viewport, window: windows.at(-1) }));
          windowStart = current.time; distance.clear();
        }
        previous = current;
      }
      if (previous.time - windowStart > 10) {
        const active = [...distance.values()].filter(metres => metres > 5).length;
        assert.equal(active, 60, `traffic froze in final window: ${active}/60 active`);
        windows.push({ time: previous.time, active, moving: previous.cars.filter(car => car.speed > 0.5).length,
          minimumTravel: Math.min(...distance.values()), duration: previous.time - windowStart });
      }
      assert.ok(maximumStillTime < 2, `city froze for ${maximumStillTime}s`);
      assert.equal(previous.camera.mode, 'free');
      assert.ok(previous.camera.position[1] > 100, 'camera is not above city');
      assert.ok(previous.status.visible > 10, 'overhead scene lost the traffic');
      const path = `tools/screenshots/traffic-flow-end-${viewport.width}.png`;
      await page.screenshot({ path });
      const { data } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const colors = new Set();
      for (let i = 0; i < data.length; i += 27) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      assert.ok(colors.size > 30, 'canvas is blank');
      assert.deepEqual(errors, []);
      results.push({ viewport, duration: previous.time - start, windows, minimumMoving, maximumStillTime,
        visible: previous.status.visible, camera: previous.camera.position, colors: colors.size, errors });
      await page.close();
    }
    await fs.writeFile('docs/knowledge/traffic-flow-2026-10-06.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
