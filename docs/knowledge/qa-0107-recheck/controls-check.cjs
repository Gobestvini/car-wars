// Independent QA artifact; no hooks are written to application sources.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const report = { environment: 'Windows Edge headless WebGL; viewport emulation', controls: [], resize: [], errors: [] };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
(async () => {
  process.env.CARWARS_FIXED_SEED = '42';
  const { startHostedServer } = await import('../../../tools/multiplayer-spike/deploy/server.js');
  const server = await startHostedServer({ port: 2577, host: '127.0.0.1' });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    await page.route('**/src/multiplayer/game.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('window.__multiplayer={snapshot:', 'window.__qaControls={network};window.__multiplayer={snapshot:') });
    });
    await page.goto('http://127.0.0.1:5173/?online=1&netdebug=1');
    await page.locator('#online-create').click();
    await page.waitForFunction(() => window.__multiplayer?.snapshot().ready && __multiplayer.camera().subject !== null && document.body.dataset.loading === 'false');
    const read = async label => {
      const s = await page.evaluate(() => {
        const snapshot = __multiplayer.snapshot(), own = snapshot.actors.find(a => a.id === snapshot.playerId);
        const [, , , x, y, z, w, vx, , vz] = own.pose;
        return { input: { ...__qaControls.network.input }, signedMs: vx * 2 * (x * z + w * y) + vz * (1 - 2 * (x * x + y * y)), own: { id: own.id, generation: own.generation, pose: own.pose }, camera: __multiplayer.camera() };
      });
      assert.equal(s.camera.subject, `${s.own.id}:${s.own.generation}`);
      near(s.camera.target[0], s.own.pose[0]); near(s.camera.target[1], .5); near(s.camera.target[2], s.own.pose[2]);
      assert.equal(s.camera.fov, 50);
      report.controls.push({ label, ...s }); return s;
    };
    await page.keyboard.down('KeyW'); await page.waitForTimeout(500);
    const forward = await read('W forward'); assert.equal(forward.input.throttle, 1); assert.ok(forward.signedMs > 1);
    await page.keyboard.up('KeyW'); await page.keyboard.down('KeyS'); await page.waitForTimeout(60);
    const brake = await read('S brakes forward'); assert.equal(brake.input.brake, 1); assert.equal(brake.input.throttle, 0);
    await page.waitForFunction(() => {
      const snapshot = __multiplayer.snapshot(), a = snapshot.actors.find(a => a.id === snapshot.playerId).pose;
      return a[7] * 2 * (a[3] * a[5] + a[6] * a[4]) + a[9] * (1 - 2 * (a[3] * a[3] + a[4] * a[4])) < -1;
    }, null, { timeout: 8000 });
    const reverse = await read('S reverse'); assert.equal(reverse.input.throttle, -1); assert.ok(reverse.signedMs < -1);
    await page.keyboard.up('KeyS');
    for (const [key, expected] of [['KeyA', -1], ['KeyD', 1]]) {
      await page.keyboard.down(key); await page.waitForTimeout(60); const s = await read(key); assert.equal(s.input.steer, expected); await page.keyboard.up(key);
    }
    for (const [width, height, factor] of [[699, 500, 1.05], [700, 500, 1], [700, 499, .82]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(80); const s = await read(`resize ${width}x${height}`);
      near(s.camera.position[0] - s.camera.target[0], 16.8 * factor * s.camera.scale);
      near(s.camera.position[1] - .5, 28 * factor * s.camera.scale);
      near(s.camera.position[2] - s.camera.target[2], -23.8 * factor * s.camera.scale);
      report.resize.push({ width, height, factor, camera: s.camera });
    }
    await page.evaluate(() => __qaControls.network.leave());
    assert.deepEqual(report.errors, []); report.passed = true;
  } finally { await browser.close(); await server.close(); }
})().catch(e => { report.failure = e.stack; process.exitCode = 1; }).finally(() => { fs.writeFileSync(path.join(__dirname, 'controls-report.json'), JSON.stringify(report, null, 2)); });
