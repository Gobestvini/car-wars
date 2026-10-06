const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const baseUrl = process.env.CARWARS_BASE_URL || 'http://localhost:5173/';
const shortMs = Number(process.env.TRAFFIC_PERF_SHORT_MS || 10000);
const longMs = Number(process.env.TRAFFIC_PERF_LONG_MS || 60000);
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;
};

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl);
    await page.waitForFunction(() => window.carLab?.modelReady);
    await page.waitForFunction(() => window.carLab.trafficStatus().count === 60 && !window.carLab.trafficStatus().pending);
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.locator('#settings-button').click();
    await page.locator('#settings-controls').getByText('Трафик', { exact: true }).click();
    const countInput = page.locator('#settings-controls input[type="text"]').nth(4);
    const qualityInput = page.locator('#settings-controls select');

    const setCount = async count => {
      await countInput.fill(String(count)); await countInput.press('Enter');
      await page.waitForFunction(value => window.carLab.trafficStatus().count === value, count, { timeout: 120000 });
    };
    const setQuality = async quality => {
      await qualityInput.selectOption(quality);
      await page.waitForFunction(value => window.carLab.performance().quality === value, quality === 'Лёгкая' ? 'low' : 'high');
    };
    const measure = async (count, quality, durationMs, label) => {
      console.error(`Measuring ${label} from a fresh seeded scene`);
      await page.reload();
      await page.waitForFunction(() => window.carLab?.modelReady);
      await page.locator('#settings-button').click();
      await page.locator('#settings-controls').getByText('Трафик', { exact: true }).click();
      await setCount(count); await setQuality(quality);
      await page.waitForTimeout(5000); // Shader/physics warm-up, excluded from the sample.
      const before = await page.evaluate(() => ({ dropped: window.carLab.performance().droppedSeconds, resources: window.carLab.resources() }));
      const sample = await page.evaluate(duration => new Promise(resolve => {
        const intervals = [], physics = [], frameCpu = [], render = [], ai = [], playerPrepare = [], npcPrepare = [], worldStep = [], post = [];
        let first = null, previous = null, frames = 0;
        const collect = stamp => {
          if (first === null) first = stamp;
          if (previous !== null) intervals.push(stamp - previous);
          previous = stamp; frames++;
          const perf = window.carLab.performance();
          const trafficPerf = window.carLab.trafficPerformance();
          physics.push(perf.physicsMs); frameCpu.push(perf.frameCpuMs); render.push(perf.renderMs);
          ai.push(trafficPerf.aiMs || 0); playerPrepare.push(trafficPerf.playerPrepareMs || 0);
          npcPrepare.push(trafficPerf.npcPrepareMs || 0); worldStep.push(trafficPerf.worldStepMs || 0); post.push(trafficPerf.postMs || 0);
          if (stamp - first < duration) requestAnimationFrame(collect);
          else resolve({ intervals, physics, frameCpu, render, ai, playerPrepare, npcPrepare, worldStep, post, frames, elapsed: stamp - first });
        };
        requestAnimationFrame(collect);
      }), durationMs);
      const after = await page.evaluate(() => ({ dropped: window.carLab.performance().droppedSeconds,
        traffic: window.carLab.trafficPerformance(), resources: window.carLab.resources(), bodies: window.carLab.worldBodies(),
        status: window.carLab.trafficStatus() }));
      assert.equal(after.status.count, count);
      assert.equal(after.status.pending, false);
      assert.deepEqual(errors, []);
      return { label, count, quality, viewport: '390x844 CSS px', durationMs: Math.round(sample.elapsed),
        frames: sample.frames, fps: sample.frames * 1000 / sample.elapsed,
        frameIntervalMs: { p50: percentile(sample.intervals, 0.50), p95: percentile(sample.intervals, 0.95) },
        physicsMs: { p50: percentile(sample.physics, 0.50), p95: percentile(sample.physics, 0.95) },
        frameCpuMs: { p50: percentile(sample.frameCpu, 0.50), p95: percentile(sample.frameCpu, 0.95) },
        renderCpuMs: { p50: percentile(sample.render, 0.50), p95: percentile(sample.render, 0.95) },
        aiMsP95: percentile(sample.ai, 0.95), playerPrepareMsP95: percentile(sample.playerPrepare, 0.95),
        npcPrepareMsP95: percentile(sample.npcPrepare, 0.95), worldStepMsP95: percentile(sample.worldStep, 0.95),
        postMsP95: percentile(sample.post, 0.95), droppedSeconds: after.dropped - before.dropped,
        bodies: after.bodies, trafficBodies: after.traffic.trafficBodies,
        logicalTraffic: after.traffic.logicalTraffic, visibleTraffic: after.traffic.visibleTraffic,
        aiTicks: after.traffic.aiTicks, aiDecisions: after.traffic.aiDecisions,
        sleepingTrafficBodies: after.traffic.sleepingTrafficBodies,
        resourcesBefore: before.resources, resourcesAfter: after.resources };
    };

    const results = [];
    for (const count of [0, 6, 30, 60, 300]) results.push(await measure(count, 'Лёгкая', shortMs, `low-${count}`));
    results.push(await measure(60, 'Высокая', shortMs, 'high-60'));
    results.push(await measure(60, 'Лёгкая', longMs, 'low-60-long'));
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const report = { environment: { browser: 'Microsoft Edge via Playwright', headless: true,
      renderer: 'SwiftShader software WebGL', cpuThrottle: 'CDP 4x (then reset to 1x)', deviceScaleFactor: 1,
      device: 'desktop surrogate; no physical mobile device' }, shortMs, longMs, results: results.map(item => ({
        label: item.label, fps: item.fps, p95FrameMs: item.frameIntervalMs.p95,
        p95PhysicsMs: item.physicsMs.p95, p95RenderMs: item.renderCpuMs.p95,
        aiMsP95: item.aiMsP95, npcPrepareMsP95: item.npcPrepareMsP95, worldStepMsP95: item.worldStepMsP95,
        droppedSeconds: item.droppedSeconds, physical: item.trafficBodies, logical: item.logicalTraffic,
        visible: item.visibleTraffic, bodies: item.bodies, resourcesBefore: item.resourcesBefore, resourcesAfter: item.resourcesAfter,
    })) };
    if (process.env.TRAFFIC_PERF_FILE) await fs.writeFile(process.env.TRAFFIC_PERF_FILE, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
