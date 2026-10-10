// Real application integration and a game-lighting close-up of the authored GLB.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.CARWARS_BASE_URL || 'http://127.0.0.1:5176/';
const out = 'docs/art/models/player-sedan-v2/verification';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const report = { environment: 'Desktop Edge SwiftShader; not a physical phone benchmark', scenes: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /Shader|WebGL/.test(message.text())) errors.push(message.text()); });
    // Isolate visual/physics integration from traffic randomness during driving checks.
    await page.addInitScript(() => localStorage.setItem('carwars.defaults.v1', JSON.stringify({ version: 1, values: {
      quality: 'Лёгкая', trafficCount: 0, policeCount: 0, blurStrength: 0,
    } })));
    await page.route('**/models/player-sedan.glb', route => route.abort());
    await page.goto(base + '#debug');
    await page.locator('#loading-retry').waitFor({ state: 'visible', timeout: 60000 });
    assert.equal(await page.evaluate(() => carLab.modelReady), false);
    await page.unroute('**/models/player-sedan.glb');
    await page.locator('#loading-retry').click();
    await page.waitForFunction(() => window.carLab?.modelReady, null, { timeout: 60000 });
    await page.waitForFunction(() => carLab.telemetry().grounded === 4, null, { timeout: 20000 });
    const initial = await page.evaluate(() => ({ model: carLab.playerModel(), telemetry: carLab.telemetry(), wheels: carLab.wheelTransforms() }));
    assert.equal(initial.model.meshes, 5);
    assert.equal(initial.model.materials, 1);
    assert.equal(initial.model.textures, 1);
    assert.ok(initial.model.triangles <= 4500);
    assert.ok(initial.model.lights.lensVertices.every(count => count > 0));
    assert.equal(initial.model.lights.reverse, false);
    assert.equal(initial.telemetry.grounded, 4);
    assert.equal(initial.telemetry.damage, 0);
    await page.screenshot({ path: `${out}/game-desktop.png` });
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => carLab.telemetry().speed > 18, null, { timeout: 20000 });
    const driving = await page.evaluate(() => carLab.telemetry());
    await page.keyboard.down('KeyD');
    await page.waitForFunction(() => carLab.wheelTransforms().slice(0, 2).every(wheel => Math.abs(wheel.steeringAngle) > .08), null, { timeout: 5000 });
    const steering = await page.evaluate(() => carLab.wheelTransforms());
    assert.ok(steering.slice(2).every(wheel => Math.abs(wheel.steeringAngle) < .001));
    await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => carLab.telemetry().speed < .1 && carLab.playerModel().deformedVertices === 0);
    await page.keyboard.down('KeyS');
    await page.waitForFunction(() => carLab.telemetry().signedSpeed < -1 && carLab.playerModel().lights.reverse);
    report.reverse = await page.evaluate(() => ({ telemetry: carLab.telemetry(), lights: carLab.playerModel().lights }));
    await page.keyboard.up('KeyS');
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => !carLab.playerModel().lights.reverse);
    report.driving = { initial, driving, steering, reset: 'passed', loadRetry: 'passed' };
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => carLab.modelReady), true);
      await page.screenshot({ path: `${out}/game-${viewport.width}x${viewport.height}.png` });
      report.scenes.push({ viewport, model: await page.evaluate(() => carLab.playerModel()) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + '?damageTest=front#debug');
    await page.waitForFunction(() => window.carLab?.modelReady, null, { timeout: 60000 });
    await page.locator('#loading-screen').waitFor({ state: 'hidden' });
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => carLab.telemetry().damage > .01 && carLab.playerModel().deformedVertices > 0, null, { timeout: 30000 });
    await page.keyboard.up('KeyW');
    report.collision = await page.evaluate(() => ({ telemetry: carLab.telemetry(), model: carLab.playerModel() }));
    await page.screenshot({ path: `${out}/front-impact.png` });
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => carLab.telemetry().damage === 0 && carLab.playerModel().deformedVertices === 0);
    report.collision.reset = 'passed';
    await page.goto(base + '?damageTest=wheel#debug');
    await page.waitForFunction(() => window.carLab?.modelReady && carLab.wheels().some(wheel => wheel.detached), null, { timeout: 30000 });
    report.detachment = await page.evaluate(() => ({ wheels: carLab.wheels(), model: carLab.playerModel(), telemetry: carLab.telemetry() }));
    assert.equal(report.detachment.wheels.filter(wheel => wheel.detached).length, 1);
    await page.screenshot({ path: `${out}/detached-wheel.png` });
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => carLab.wheels().every(wheel => !wheel.detached) && carLab.playerModel().deformedVertices === 0);
    report.detachment.reset = 'passed';
    assert.deepEqual(errors, []);
    report.errors = errors;
    // Render the same GLB using the game's exact light intensities and ACES setup.
    await page.route('**/__player_preview', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas></canvas>' }));
    await page.goto(base + '__player_preview');
    report.preview = await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
      const { preparePlayerModel, PLAYER_MODEL_URL } = await import('/src/player-model.js');
      const { ART_LIGHT } = await import('/src/art-direction.js');
      const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true });
      renderer.setSize(innerWidth, innerHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = ART_LIGHT.exposure;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#e8e5dc');
      scene.add(new THREE.HemisphereLight(ART_LIGHT.sky, ART_LIGHT.ground, ART_LIGHT.ambient));
      const sun = new THREE.DirectionalLight(ART_LIGHT.sun, ART_LIGHT.intensity);
      sun.position.set(-14,24,10); sun.castShadow = true; sun.shadow.mapSize.set(1024,1024);
      sun.shadow.bias = -.0008; sun.shadow.normalBias = .03;
      sun.shadow.camera.near = .1; sun.shadow.camera.far = 100;
      sun.shadow.camera.left = sun.shadow.camera.bottom = -5;
      sun.shadow.camera.right = sun.shadow.camera.top = 5;
      scene.add(sun);
      const { createPlayerLights } = await import('/src/player-lights.js');
      const { model, body, wheels } = preparePlayerModel((await new GLTFLoader().loadAsync('/'+PLAYER_MODEL_URL)).scene);
      const lights = createPlayerLights(body); model.add(lights.glow);
      scene.add(model);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(100,100), new THREE.MeshStandardMaterial({ color: '#dbd8cf', roughness: 1 }));
      floor.rotation.x = -Math.PI/2; floor.position.y = -.87; floor.receiveShadow = true; scene.add(floor);
      const camera = new THREE.PerspectiveCamera(38, innerWidth/innerHeight,.1,100);
      window.preview = { renderer, scene, camera, model, body, wheels, lights, draw: (rear=false, reverse=false) => {
        lights.update({ signedSpeed: reverse ? -2 : 0 });
        camera.position.set(6,3.4,rear ? -7 : 7); camera.lookAt(0,-.05,0); renderer.render(scene,camera);
      }};
      preview.draw();
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, lighting: ART_LIGHT };
    });
    await page.screenshot({ path: `${out}/game-lighting-front.png` });
    await page.evaluate(() => preview.draw(true));
    await page.screenshot({ path: `${out}/game-lighting-rear.png` });
    report.redTailPixels = await page.evaluate(() => {
      preview.draw(true,true);
      const canvas = document.createElement('canvas');
      canvas.width = innerWidth; canvas.height = innerHeight;
      const context = canvas.getContext('2d');
      context.drawImage(preview.renderer.domElement,0,0);
      const pixels = context.getImageData(0,0,canvas.width,canvas.height).data;
      let red = 0;
      for (let i=0;i<pixels.length;i+=4) {
        if (pixels[i]>180 && pixels[i+1]<65 && pixels[i+2]<65) red++;
      }
      return red;
    });
    assert.ok(report.redTailPixels > 500, `Rear lamps must stay saturated red under game tone mapping: ${report.redTailPixels}`);
    await page.screenshot({ path: `${out}/game-lighting-reverse.png` });
    await page.evaluate(async () => {
      const { CarDeformation } = await import('/src/car-deformation.js');
      const THREE = await import('/node_modules/three/build/three.module.js');
      const damage = new CarDeformation(preview.body.geometry, new THREE.Matrix4(), { preserveHardEdges:true });
      damage.apply([{point:{x:.7,y:.60,z:.6},normal:{x:-1,y:0,z:-.2},impact:{depth:.22,radius:1.2}}]);
      preview.wheels[0].rotation.y = -.475;
      preview.wheels[1].rotation.y = -.475;
      preview.draw(false);
    });
    await page.screenshot({ path: `${out}/damaged-glass-full-steering.png` });
    fs.writeFileSync(`${out}/report.json`, JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
