const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5173/';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}#debug`); await page.waitForFunction(() => window.carLab?.modelReady);
    await page.locator('#settings-button').click();
    await page.locator('#settings-controls select').first().selectOption('Лёгкая');
    await page.locator('#settings-controls').getByText('Трафик', { exact: true }).click();
    const count = page.locator('#settings-controls input[type="text"]').nth(4);
    await count.fill('6'); await count.press('Enter');
    await page.waitForFunction(() => window.carLab.trafficStatus().count === 6);
    await page.locator('#settings-controls select').nth(1).selectOption({ label: 'Свободная' });
    await page.keyboard.press('Escape'); await page.mouse.move(700, 500);
    for (let i = 0; i < 25; i++) await page.mouse.wheel(0, 200);
    const previous = new Map(), pending = new Map(), completed = new Map();
    for (let tick = 0; tick < 240 && completed.size < 2; tick++) {
      const data = await page.evaluate(() => ({ cars: window.carLab.traffic(), ai: window.carLab.trafficAI(), city: window.carLab.city() }));
      const nodes = new Map(data.city.roadNetwork.intersections.map(node => [node.id, node]));
      data.ai.forEach((ai, index) => {
        const before = previous.get(ai.id), [from, to] = ai.segment;
        if (before && before[1] === from && before[0] !== from) {
          const a = nodes.get(before[0]), b = nodes.get(from), c = nodes.get(to);
          const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
          if (cross) pending.set(ai.id, cross > 0 ? 'right' : 'left');
        }
        previous.set(ai.id, ai.segment);
        const turn = pending.get(ai.id), car = data.cars[index];
        if (!turn || completed.has(turn)) return;
        const a = nodes.get(from), b = nodes.get(to), length = Math.hypot(b.x - a.x, b.z - a.z);
        const fx = (b.x - a.x) / length, fz = (b.z - a.z) / length;
        const progress = (car.x - a.x) * fx + (car.z - a.z) * fz;
        const alignment = Math.sin(car.heading) * fx + Math.cos(car.heading) * fz;
        if (progress < 22 || progress > length - 12 || alignment < 0.98) return;
        const lateral = fx ? (car.z - a.z) * fx : -(car.x - a.x) * fz;
        assert.ok(Math.abs(lateral - data.city.roadWidth / 4) < 1.5, `${turn} exit lane: ${lateral}`);
        completed.set(turn, { id: ai.id, segment: ai.segment, position: [car.x, car.z], heading: car.heading, lateral, progress });
      });
      await page.waitForTimeout(250);
    }
    assert.equal(completed.size, 2, `both turns must exit onto the right lane: ${JSON.stringify([...completed])}`);
    await page.screenshot({ path: 'tools/screenshots/traffic-right-hand-turns.png' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ turns: Object.fromEntries(completed), errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
