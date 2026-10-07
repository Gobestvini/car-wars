// Deterministic real-WebGL fixtures plus actual application integration checks for TASK-0039..0042.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PNG } = require(process.env.PNGJS_MODULE || 'pngjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5174/';
const out = process.env.VISUAL_OUTPUT_DIR || 'tools/screenshots';
fs.mkdirSync(out, { recursive: true });

async function fixture(page) {
  await page.route('**/__visual_fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"><canvas></canvas></body></html>' }));
  await page.goto(`${base}__visual_fixture`);
  await page.evaluate(async () => {
    const [THREE, { createCityScene }, { createCityPlan }, { createTrafficSignals }, { CarDamageEffects }, { CarSimulation }, { updateShadowCoverage }, { GLTFLoader }] = await Promise.all([
      import('/node_modules/three/build/three.module.js'), import('/src/city-scene.js'), import('/src/city-generator.js'),
      import('/src/traffic-signals.js'), import('/src/car-damage-effects.js'), import('/src/vehicle.js'),
      import('/src/shadow-coverage.js'), import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js'),
    ]);
    const { ART, ART_LIGHT } = await import('/src/art-direction.js');
    const { stylePlayerBody } = await import('/src/vehicle-visuals.js');
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = ART_LIGHT.exposure;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(ART.fog);
    scene.add(new THREE.HemisphereLight(ART_LIGHT.sky, ART_LIGHT.ground, ART_LIGHT.ambient));
    const sun = new THREE.DirectionalLight(ART_LIGHT.sun, ART_LIGHT.intensity); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0008; sun.shadow.normalBias = .03;
    scene.add(sun, sun.target);
    const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .1, 200);
    const sim = new CarSimulation();
    let plan = createCityPlan(); let city = createCityScene(scene, sim, plan);
    let signals = createTrafficSignals(plan.roadNetwork);
    const effects = new CarDamageEffects(scene), car = new THREE.Group(); scene.add(car);
    const model = (await new GLTFLoader().loadAsync('/models/sedan.glb')).scene;
    const body = model.getObjectByName('body'); body.geometry.computeBoundingBox();
    stylePlayerBody(body);
    const box = body.geometry.boundingBox;
    model.scale.set(1.25, 1.15, 4.45 / (box.max.z - box.min.z)); model.position.y = -.5;
    model.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } }); car.add(model);
    const f = window.fixture = { THREE, renderer, scene, sun, camera, sim, car, effects, city, plan, signals, time: 0 };
    f.pose = (x, z, yaw = 0) => { car.position.set(x, .96, z); car.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw); };
    f.draw = (damage = 0, frames = 1, quality = 'high', free = false) => {
      renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      if (!free) {
        camera.position.copy(car.position).add(new THREE.Vector3(12, 20, -17).multiplyScalar(1.4 * (innerWidth < 700 ? 1.05 : 1)));
        camera.lookAt(car.position.x, .5, car.position.z);
      }
      camera.updateMatrixWorld(); sun.position.set(car.position.x - 14, 24, car.position.z + 10); sun.target.position.set(car.position.x, 0, car.position.z);
      sun.target.updateMatrixWorld();
      const size = quality === 'low' ? 512 : 1024;
      if (sun.shadow.mapSize.x !== size) { sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(size, size); }
      updateShadowCoverage(sun, camera, { resolution: size, casterHeight: 24 });
      for (let i = 0; i < frames; i++) {
        city.updateSignals(signals, f.time, camera, quality);
        city.occlusion.update(camera, car, 1 / 60);
        effects.update({ damage, car, camera, dt: 1 / 60, quality });
      }
      renderer.render(scene, camera);
      return { effects: effects.snapshot(), resources: { ...renderer.info.memory, programs: renderer.info.programs.length }, calls: renderer.info.render.calls };
    };
    f.rebuild = width => {
      city.dispose(); plan = createCityPlan(undefined, { roadWidth: width }); city = createCityScene(scene, sim, plan); signals = createTrafficSignals(plan.roadNetwork);
      Object.assign(f, { city, plan, signals }); effects.reset();
    };
    f.pose(0, 0); f.draw();
  });
}

function brightness(buffer, sample) {
  const png = PNG.sync.read(buffer);
  const x = Math.round(sample.x * png.width), y = Math.round(sample.y * png.height);
  const i = (y * png.width + x) * 4;
  return (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const report = { viewports: [], app: [] };
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport }); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error' && /Shader|WebGL/.test(msg.text())) errors.push(msg.text()); });
      await fixture(page);
      const result = { viewport, signals: [], damage: [], proximity: [], shadow: [] };
      for (const quality of ['high', 'low']) {
        for (const width of [12, 15, 30]) {
          await page.evaluate(width => fixture.rebuild(width), width);
          for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const signals = await page.evaluate(({ fx, fz, quality, width }) => {
              const f = fixture, node = { x: -25, z: -25 };
              const lateral = width / 4;
              f.pose(node.x - fx * 25 - fz * lateral, node.z - fz * 25 + fx * lateral, Math.atan2(fx, fz));
              const observed = new Set(); let snapshot;
              for (let time = 0; time < 38; time += .5) {
                f.time = time; f.city.updateSignals(f.signals, time);
                f.city.signalApproaches.forEach((a, i) => {
                  if (!a.signalVisible) throw new Error('Hidden assembly');
                  const color = f.signals.phase(a.nodeId, a.fromId, time).color;
                  if (color !== a.color) throw new Error('Mismatched phase');
                  const slot = f.city.signalBeam.userData.visibleApproachIndices.indexOf(i);
                  if (color === 'priority') {
                    if (slot !== -1) throw new Error('Priority approach has a visible beam');
                  } else {
                    if (slot === -1) throw new Error('Missing active fog beam');
                    const actual = new f.THREE.Color(); f.city.signalBeam.getColorAt(slot, actual);
                    const matrix = new f.THREE.Matrix4(); f.city.signalBeam.getMatrixAt(slot, matrix);
                    const scale = new f.THREE.Vector3(); matrix.decompose(new f.THREE.Vector3(), new f.THREE.Quaternion(), scale);
                    const expected = new f.THREE.Color({ red: '#f34f45', green: '#51d28b', yellow: '#ffc34a' }[color]);
                    if (actual.getHex() !== expected.getHex() || scale.y === 0) throw new Error('Mismatched fog beam');
                  }
                  if (a.nodeId === '-25:-25' && a.forwardX === fx && a.forwardZ === fz) observed.add(color);
                });
              }
              snapshot = f.draw(0, 1, quality);
              const counts = new Map(); for (const a of f.city.signalApproaches) counts.set(a.nodeId, (counts.get(a.nodeId) || 0) + 1);
              if ([...counts.values()].some(n => n !== 4)) throw new Error('Expected four approaches');
              if (f.city.signalBeam.count !== f.city.signalBeam.userData.visibleApproachIndices.length ||
                  f.city.signalBeam.count > f.city.signalApproaches.length) throw new Error('Invalid visible fog instance count');
              return { colors: [...observed], count: f.city.signalApproaches.length, snapshot };
            }, { fx, fz, quality, width });
            assert.deepEqual([...signals.colors].sort(), ['green', 'red', 'yellow']);
            if (width === 15) await page.screenshot({ path: `${out}/signals-${viewport.width}-${quality}-${fx}-${fz}.png` });
            result.signals.push({ quality, width, fx, fz, count: signals.count });
          }
        }
        await page.evaluate(() => { fixture.rebuild(15); fixture.pose(0, 0); });
        for (const damage of [0, .25, .6, .85, 1]) {
          const data = await page.evaluate(({ damage, quality }) => { fixture.effects.reset(); return fixture.draw(damage, damage === 1 ? 36 : 120, quality); }, { damage, quality });
          assert.equal(data.effects.activeSmoke > 0, damage > 0);
          assert.equal(data.effects.explosions, damage === 1 ? 1 : 0);
          assert.ok(data.effects.activeSmoke + data.effects.activeFire <= data.effects.capacity);
          await page.screenshot({ path: `${out}/damage-${viewport.width}-${quality}-${damage}.png` });
          result.damage.push({ quality, damage, ...data });
        }
        // Smoke particles retain world positions when the emitter is moved/rotated.
        const trail = await page.evaluate(quality => {
          const f = fixture; f.effects.reset(); f.pose(0, 0); f.draw(.85, 90, quality);
          const live = f.effects.smokePool.particles.find(p => p.life > p.age);
          const before = live.position.clone(); f.pose(8, 5, Math.PI / 2); f.draw(.85, 1, quality);
          return { travel: live.position.distanceTo(before), origin: f.effects.snapshot().origin };
        }, quality);
        assert.ok(trail.travel < .15); assert.ok(trail.origin[0] > 9);
        const proximity = await page.evaluate(quality => {
          const f = fixture; f.effects.reset();
          const entry = f.city.entries.find(e => !e.caps.length && e.x > 0 && e.z > 0);
          const rows = [];
          for (const gap of [10, 5, 2, 1, -.15, 5.95, 6.05, 10]) {
            f.pose(entry.x, entry.bounds.min.z - gap - 2.225);
            // Nearby facade must stay opaque when camera rays to the car are clear.
            f.camera.position.set(entry.x, 8, f.car.position.z - 20); f.camera.lookAt(f.car.position);
            f.draw(0, 180, quality, true);
            rows.push({ gap, opacity: entry.opacity, ray: Boolean(entry.wasOccluded), proxy: Boolean(entry.proxy) });
          }
          return rows;
        }, quality);
        assert.equal(proximity[0].opacity, 1); assert.equal(proximity[1].ray, false); assert.equal(proximity[1].opacity, 1);
        assert.ok(proximity.every(row => row.opacity === 1 && !row.proxy && !row.ray)); assert.equal(proximity.at(-1).opacity, 1); assert.equal(proximity.at(-1).proxy, false);
        result.proximity.push({ quality, rows: proximity });
        await page.screenshot({ path: `${out}/proximity-${viewport.width}-${quality}-restored.png` });
        await page.evaluate(quality => {
          const f = fixture, entry = f.city.entries.find(e => !e.caps.length && e.x > 0 && e.z > 0);
          f.pose(entry.x, entry.bounds.min.z - 3.225); f.camera.position.set(entry.x, 8, entry.bounds.max.z + 20); f.camera.lookAt(f.car.position); f.draw(0, 180, quality, true);
        }, quality);
        await page.screenshot({ path: `${out}/proximity-${viewport.width}-${quality}-near.png` });
      }
      // Repeated destruction/reset and city rebuilds use a stable number of GPU resources.
      const lifecycle = await page.evaluate(() => {
        const f = fixture, rows = [];
        for (let i = 0; i < 10; i++) {
          f.rebuild(i % 2 ? 15 : 30); f.pose(0, 0); f.draw(1, 40); f.effects.reset();
          const reset = f.effects.snapshot(); if (reset.exploded || reset.activeSmoke || reset.activeFire) throw new Error('Stale effects');
          rows.push(f.draw(0, 1).resources);
        }
        return rows;
      });
      assert.deepEqual(lifecycle.slice(2).map(v => v.geometries), Array(8).fill(lifecycle[2].geometries));
      result.lifecycle = lifecycle;
      result.physical = await page.evaluate(() => {
        const f = fixture, sim = f.sim;
        f.rebuild(15); f.effects.reset(); sim.reset(); f.pose(0, 0);
        const wall = sim.addStaticBox({ x: 0, y: .9, z: 4.1, halfX: 2, halfY: 1, halfZ: .25 });
        const impacts = [];
        while (sim.damage < 1 && impacts.length < 8) {
          sim.body.position.set(0, .96, 0); sim.body.quaternion.setFromEuler(0, 0, 0);
          sim.body.velocity.setZero(); sim.body.angularVelocity.setZero(); sim.body.aabbNeedsUpdate = true;
          for (let i = 0; i < 90; i++) sim.step({}, 1 / 120);
          sim.drainImpactEvents(); sim.body.velocity.set(0, 0, 17);
          let impact = [];
          for (let i = 0; i < 60 && !impact.length; i++) { sim.step({}, 1 / 120); impact = sim.drainImpactEvents(); }
          if (!impact.length) throw new Error('Missing real collision');
          f.pose(sim.body.position.x, sim.body.position.z); f.draw(sim.damage, 120);
          impacts.push({ damage: sim.damage, effects: f.effects.snapshot() });
        }
        if (sim.damage !== 1 || f.effects.snapshot().explosions !== 1) throw new Error('Destroyed pipeline failed');
        f.draw(sim.damage, 420);
        if (f.effects.snapshot().explosions !== 1 || f.effects.snapshot().activeSmoke) throw new Error('Repeated explosion or stale smoke');
        sim.removeStaticBox(wall); sim.reset(); f.effects.reset();
        const entry = f.city.entries.find(e => !e.caps.length && e.x > 0 && e.z > 0);
        f.pose(entry.x, entry.bounds.min.z - 3.225); f.camera.position.set(entry.x, 8, entry.bounds.max.z + 20); f.camera.lookAt(f.car.position);
        f.draw(0, 180, 'high', true);
        if (entry.opacity > .23) throw new Error('Expected faded facade');
        sim.body.position.copy(f.car.position); sim.body.quaternion.setFromEuler(0, 0, 0); sim.body.velocity.set(0, 0, 12); sim.body.aabbNeedsUpdate = true;
        for (let i = 0; i < 120; i++) sim.step({}, 1 / 120);
        if (sim.damage === 0 || sim.body.position.z >= entry.bounds.min.z) throw new Error('Transparent building lost collision');
        return { impacts, facadeDamage: sim.damage, facadeOpacity: entry.opacity };
      });
      // Deterministic receiver pixel check: actual city meshes, with sunlight and a real shadow caster.
      for (const quality of ['high', 'low']) for (const kind of ['building', 'car']) {
        const samples = await page.evaluate(({ quality, kind }) => {
          const f = fixture, T = f.THREE; f.rebuild(15); f.effects.reset(); f.car.visible = false;
          f.city.group.children.forEach(mesh => { mesh.visible = mesh === f.city.dashes || mesh === f.city.stopLines || mesh.name === 'Road surface'; });
          const matrix = new T.Matrix4().makeScale(0, 0, 0);
          for (let i = 0; i < f.city.dashes.count; i++) f.city.dashes.setMatrixAt(i, matrix);
          for (let i = 0; i < f.city.stopLines.count; i++) f.city.stopLines.setMatrixAt(i, matrix);
          const sampleX = kind === 'car' ? .6 : 0, stopZ = kind === 'car' ? -1 : -2;
          f.city.dashes.setMatrixAt(0, new T.Matrix4().makeTranslation(sampleX, .025, 0));
          matrix.makeScale(4, 1, .4); matrix.setPosition(sampleX, .0275, stopZ); f.city.stopLines.setMatrixAt(0, matrix);
          f.city.dashes.instanceMatrix.needsUpdate = true; f.city.stopLines.instanceMatrix.needsUpdate = true;
          const camera = new T.OrthographicCamera(-10, 10, 10, -10, .1, 100); camera.position.set(0, 40, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
          const caster = new T.Mesh(kind === 'car' ? new T.BoxGeometry(1.6, 1.4, 4.45) : new T.BoxGeometry(4, 20, 4), new T.MeshStandardMaterial());
          if (kind === 'car') caster.position.set(-.8, .9, .6); else caster.position.set(-8, 10, 6);
          caster.castShadow = true; f.scene.add(caster);
          f.sun.position.set(-14, 24, 10); f.sun.target.position.set(0, 0, 0); f.sun.target.updateMatrixWorld();
          f.sun.shadow.map?.dispose(); f.sun.shadow.map = null; f.sun.shadow.mapSize.set(quality === 'low' ? 512 : 1024, quality === 'low' ? 512 : 1024);
          Object.assign(f.sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: .1, far: 100 }); f.sun.shadow.camera.updateProjectionMatrix();
          f.shadowFixture = { camera, caster };
          f.renderer.render(f.scene, camera);
          const project = z => { const p = new T.Vector3(sampleX, .05, z).project(camera); return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 }; };
          return { dash: project(0), stop: project(stopZ) };
        }, { quality, kind });
        const shaded = await page.screenshot({ path: `${out}/marking-shadow-${viewport.width}-${quality}-${kind}.png` });
        await page.evaluate(() => { fixture.shadowFixture.caster.visible = false; fixture.renderer.render(fixture.scene, fixture.shadowFixture.camera); });
        const lit = await page.screenshot({ path: `${out}/marking-sun-${viewport.width}-${quality}-${kind}.png` });
        const data = { quality, kind, dash: { shade: brightness(shaded, samples.dash), sun: brightness(lit, samples.dash) }, stop: { shade: brightness(shaded, samples.stop), sun: brightness(lit, samples.stop) } };
        assert.ok(data.dash.sun - data.dash.shade > 8, JSON.stringify(data)); assert.ok(data.stop.sun - data.stop.shade > 8, JSON.stringify(data));
        result.shadow.push(data);
        await page.evaluate(() => { const f = fixture; f.shadowFixture.caster.removeFromParent(); f.shadowFixture.caster.geometry.dispose(); f.shadowFixture.caster.material.dispose(); f.car.visible = true; });
      }
      assert.deepEqual(errors, []); report.viewports.push(result); await page.close();
      console.log(`Fixture ${viewport.width}x${viewport.height} passed`);
    }
    // Actual app: previews, reset through both control paths, and real collision-driven emission.
    for (const preview of [.25, .6, .85, 1]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error' && /Shader|WebGL/.test(msg.text())) errors.push(msg.text()); });
      await page.goto(`${base}?damagePreview=${preview}#debug`); await page.waitForFunction(() => window.carLab?.modelReady);
      await page.waitForFunction(() => carLab.damageEffects().activeSmoke > 0);
      if (preview === 1) await page.waitForFunction(() => carLab.damageEffects().exploded);
      const before = await page.evaluate(() => ({ damage: carLab.telemetry().damage, effects: carLab.damageEffects(), signals: carLab.signals(), resources: carLab.resources(), performance: carLab.performance() }));
      assert.equal(before.signals.visible, before.signals.approaches);
      if (preview === .85) {
        // Headless CDP freeze does not consistently change document.hidden.
        // Exercise the app's actual hidden branch, with an exact no-advance assertion.
        const clock = await page.evaluate(() => {
          Object.defineProperty(document,'hidden',{ configurable:true,get:()=>true });
          return carLab.trafficClock();
        });
        await page.waitForTimeout(500);
        assert.equal(await page.evaluate(()=>carLab.trafficClock()),clock);
        await page.evaluate(()=>delete document.hidden);
        const resumed = await page.evaluate(() => ({ clock: carLab.trafficClock(), effects: carLab.damageEffects() }));
        assert.equal(resumed.effects.exploded, false);
        report.resume = resumed;
      }
      await page.screenshot({ path: `${out}/app-damage-${preview}.png` });
      await page.keyboard.press('KeyR'); await page.waitForTimeout(150);
      const after = await page.evaluate(() => carLab.damageEffects()); assert.equal(after.exploded, false); assert.equal(after.activeSmoke, 0); assert.equal(after.activeFire, 0);
      await page.locator('#settings-button').click(); await page.getByRole('button', { name: 'Вернуть машину' }).click();
      assert.equal(await page.evaluate(() => carLab.telemetry().damage), 0);
      assert.deepEqual(errors, []); report.app.push({ preview, before, after }); await page.close();
    }
    const page = await browser.newPage(); await page.goto(`${base}?damageTest=front#debug`); await page.waitForFunction(() => window.carLab?.modelReady);
    await page.keyboard.down('KeyW'); await page.waitForFunction(() => carLab.telemetry().damage > .15, { timeout: 15000 }); await page.keyboard.up('KeyW');
    await page.waitForFunction(() => carLab.damageEffects().activeSmoke > 0);
    const impact = await page.evaluate(() => ({ damage: carLab.telemetry().damage, effects: carLab.damageEffects() }));
    assert.ok(impact.damage > .15); assert.ok(impact.effects.activeSmoke > 0);
    report.realImpact = impact; await page.close();
    fs.writeFileSync(process.env.VISUAL_REPORT_PATH || 'docs/knowledge/visual-series-2026-10-06.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ viewports: report.viewports.map(v => ({ viewport: v.viewport, signalChecks: v.signals.length, damageChecks: v.damage.length, shadow: v.shadow, lifecycle: v.lifecycle.at(-1) })), previews: report.app.length, impact: report.realImpact }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
