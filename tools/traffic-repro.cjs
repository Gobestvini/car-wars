// Captures deterministic browser traces for startup, count changes, and a traffic reset.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const baseUrl = process.env.CARWARS_BASE_URL || 'http://localhost:5173/';

async function capture(page, label) {
  return page.evaluate(label => {
    const ai = window.carLab.trafficAI(), cars = window.carLab.traffic();
    const stopped = ai.flatMap((car, i) => cars[i].speed < 0.3
      ? [{ id: car.id, state: car.state, reason: car.reason, noProgressTime: car.noProgressTime,
        logical: car.logical, x: cars[i].x, z: cars[i].z, speed: cars[i].speed }]
      : []);
    const overlap = (a, b, gap = 0) => {
      const axes = [[Math.sin(a.heading), Math.cos(a.heading)], [Math.cos(a.heading), -Math.sin(a.heading)],
        [Math.sin(b.heading), Math.cos(b.heading)], [Math.cos(b.heading), -Math.sin(b.heading)]];
      const dx = b.x - a.x, dz = b.z - a.z;
      return axes.every(([x, z]) => {
        const separation = Math.abs(dx * x + dz * z);
        const extentA = 2.08 * Math.abs(Math.sin(a.heading) * x + Math.cos(a.heading) * z)
          + 0.87 * Math.abs(Math.cos(a.heading) * x - Math.sin(a.heading) * z);
        const extentB = 2.08 * Math.abs(Math.sin(b.heading) * x + Math.cos(b.heading) * z)
          + 0.87 * Math.abs(Math.cos(b.heading) * x - Math.sin(b.heading) * z);
        return separation < extentA + extentB + gap;
      });
    };
    const overlaps = [];
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      if (Math.hypot(cars[i].x - cars[j].x, cars[i].z - cars[j].z) < 7 && overlap(cars[i], cars[j])) {
        overlaps.push([ai[i].id, ai[j].id]);
      }
    }
    const vehicles = ai.map((car, i) => ({ id: car.id, state: car.state, reason: car.reason, waitReason: car.waitReason,
      noProgressTime: car.noProgressTime, logical: car.logical, x: cars[i].x, z: cars[i].z,
      heading: cars[i].heading, speed: cars[i].speed, route: car.route, segment: car.segment,
      signal: car.signal, reservationNode: car.reservationNode, reservationAge: car.reservationAge }));
    return { label, simulationTime: window.carLab.trafficClock(), status: window.carLab.trafficStatus(),
      stoppedCount: stopped.length, unexplainedNearZero: stopped.filter(car => car.speed < 0.05 && !car.reason).length,
      stoppedExamples: stopped.filter(car => car.speed < 0.05).slice(0, 10), overlapPairs: overlaps, vehicles };
  }, label);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl);
    await page.waitForFunction(() => window.carLab?.modelReady);
    await page.waitForFunction(() => window.carLab.trafficStatus().count === 60);
    const trace = [await capture(page, 'startup-60')];
    await page.waitForTimeout(5000);
    trace.push(await capture(page, 'after-5s-60'));
    await page.locator('#settings-button').click();
    await page.locator('#settings-controls').getByText('Трафик', { exact: true }).click();
    const count = page.locator('#settings-controls input[type="text"]').nth(4);
    for (const requested of [6, 300]) {
      await count.fill(String(requested)); await count.press('Enter');
      await page.waitForFunction(value => window.carLab.trafficStatus().count === value, requested);
      trace.push(await capture(page, `count-${requested}-immediate`));
      await page.waitForTimeout(1500);
      trace.push(await capture(page, `count-${requested}-after-1.5s`));
    }
    await page.locator('#settings-controls').getByRole('button', { name: 'Вернуть машину' }).click();
    await page.waitForFunction(() => window.carLab.trafficStatus().count === 300);
    trace.push(await capture(page, 'reset-300-immediate'));
    await page.waitForTimeout(1000);
    trace.push(await capture(page, 'reset-300-after-1s'));
    assert.deepEqual(errors, []);
    await fs.writeFile('docs/knowledge/traffic-repro-2026-10-06.json', JSON.stringify({ capturedAt: new Date().toISOString(), errors, trace }, null, 2));
    console.log(JSON.stringify({ errors, traceFile: 'docs/knowledge/traffic-repro-2026-10-06.json',
      overlapPairs: trace.map(({ label, overlapPairs }) => ({ label, count: overlapPairs.length, examples: overlapPairs.slice(0, 8) })),
      stationary: trace.map(({ label, simulationTime, stoppedCount, unexplainedNearZero, stoppedExamples }) =>
        ({ label, simulationTime, count: stoppedCount, unexplainedNearZero, examples: stoppedExamples.slice(0, 8) })) }, null, 2));
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
