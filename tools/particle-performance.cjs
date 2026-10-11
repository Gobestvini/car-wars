// Pixel parity and isolated CPU timings against a saved Git revision.
// Usage: CARWARS_BASE_URL=http://127.0.0.1:5186/ node tools/particle-performance.cjs <commit>
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const revision = process.argv[2];
assert.ok(/^[0-9a-f]{7,40}$/.test(revision || ''), 'Pass a reference commit SHA');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5186/';
const output = 'tools/screenshots/performance-audit';
const files = ['tire-smoke.js', 'car-damage-effects.js', 'traffic-signals.js'];
const reference = Object.fromEntries(files.map(file => [file, execFileSync('git', [
  '-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', `${revision}:src/${file}`,
], { encoding: 'utf8' })]));

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl'] });
  const report = { revision, browser: browser.version(), cases: [] };
  try {
    for (const scenario of ['empty', 'skid', 'sparse', 'fire', 'explosion', 'low-fire']) {
      const pair = {};
      for (const version of ['before', 'after']) {
        const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/__particle_audit', route => route.fulfill({
          contentType: 'text/html', body: '<html><body style="margin:0"></body></html>',
        }));
        if (version === 'before') for (const file of files) {
          // Keep Vite's dependency resolution, substitute only the source body.
          await page.route(`**/src/${file}*`, async route => {
            const response = await route.fetch();
            const source = await response.text();
            const legacy = reference[file].replace("from 'three'", 'from "/node_modules/three/build/three.module.js"');
            assert.ok(source.length > 0);
            await route.fulfill({ response, body: legacy });
          });
        }
        await page.goto(new URL('__particle_audit', base).href);
        pair[version] = await page.evaluate(async scenario => {
          const THREE = await import('/node_modules/three/build/three.module.js');
          const { TireSmoke } = await import('/src/tire-smoke.js');
          const { CarDamageEffects } = await import('/src/car-damage-effects.js');
          let seed = 12345;
          Math.random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
          const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
          renderer.setSize(480, 320); renderer.setPixelRatio(1);
          document.body.append(renderer.domElement);
          const scene = new THREE.Scene(); scene.background = new THREE.Color('#899aaa');
          const camera = new THREE.PerspectiveCamera(42, 1.5, .1, 100);
          camera.position.set(0, 5, 12); camera.lookAt(0, 1, 0);
          const car = new THREE.Group(); car.position.y = .6;
          const smoke = new TireSmoke(scene, { seed: 42 });
          const damage = new CarDamageEffects(scene);
          const quality = scenario === 'low-fire' ? 'low' : 'high';
          if (scenario === 'skid' || scenario === 'sparse') {
            for (let i = 0; i < 32; i++) smoke.emit({ x: (i % 4 - 1.5) * .5, y: .2, z: (i % 3 - 1) * .4 });
            if (scenario === 'sparse') for (let i = 0; i < 32; i += 2) smoke.particles[i].life = .01;
          }
          const damageValue = scenario === 'explosion' ? 1 : scenario.includes('fire') ? .9 : 0;
          for (let i = 0; i < 60; i++) {
            smoke.update(1 / 60, camera, { quality });
            damage.update({ damage: damageValue, dt: 1 / 60, car, camera, quality });
          }
          renderer.render(scene, camera);
          const gl = renderer.getContext(), pixels = new Uint8Array(480 * 320 * 4);
          gl.readPixels(0, 0, 480, 320, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))]
            .map(byte => byte.toString(16).padStart(2, '0')).join('');
          const triangles = renderer.info.render.triangles;
          // Freeze visual time: measure CPU packing, excluding WebGL submission and physics.
          const update = () => {
            smoke.update(0, camera, { quality });
            damage.smokePool.update(0, camera, 160); damage.firePool.update(0, camera, 128);
          };
          for (let i = 0; i < 1000; i++) update();
          const timings = [];
          for (let batch = 0; batch < 7; batch++) {
            const start = performance.now();
            for (let i = 0; i < 2000; i++) update();
            timings.push((performance.now() - start) / 2000);
          }
          timings.sort((a, b) => a - b);
          const result = { hash, triangles, updateMedianMs: timings[3], timings,
            activeSmoke: smoke.activeCount, damage: damage.snapshot() };
          window.auditCleanup = () => {
            smoke.dispose(); damage.dispose(); renderer.dispose(); renderer.forceContextLoss();
          };
          return result;
        }, scenario);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(output, `${scenario}-${version}.png`) });
        await page.evaluate(() => window.auditCleanup());
        await page.close();
      }
      assert.equal(pair.after.hash, pair.before.hash, `${scenario}: visible pixels changed`);
      assert.equal(pair.after.activeSmoke, pair.before.activeSmoke);
      assert.deepEqual(pair.after.damage, pair.before.damage);
      report.cases.push({ scenario, ...pair });
    }
    fs.writeFileSync(path.join(output, 'particles.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
