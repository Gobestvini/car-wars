// Task-specific browser smoke check. Requires an existing Playwright module and Edge.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const baseUrl = process.env.CARWARS_BASE_URL || 'http://localhost:5173/';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    fs.mkdirSync('tools/screenshots', { recursive: true });
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    desktop.on('pageerror', error => errors.push(error.message));
    desktop.on('response', response => { if (response.status() >= 400 && response.url().includes('localhost')) errors.push(`${response.status()} ${response.url()}`); });
    await desktop.goto(`${baseUrl}?damageTest=front#debug`);
    await desktop.waitForFunction(() => window.carLab?.modelReady);
    await desktop.waitForFunction(() => window.carLab.trafficStatus().count === 60 && !window.carLab.trafficStatus().pending);
    await desktop.waitForTimeout(1300);
    const city = await desktop.evaluate(() => window.carLab.city());
    const idle = await desktop.evaluate(() => window.carLab.telemetry());
    const trafficStart = await desktop.evaluate(() => window.carLab.traffic());
    assert.ok(city.buildings >= 24 && city.landmarks >= 3);
    assert.equal(trafficStart.length, 60);
    assert.equal(idle.damage, 0);
    await desktop.screenshot({ path: 'tools/screenshots/city-desktop.png' });

    await desktop.keyboard.down('KeyW'); await desktop.waitForTimeout(2200); await desktop.keyboard.up('KeyW');
    const impact = await desktop.evaluate(() => window.carLab.telemetry());
    assert.ok(impact.damage > 0, `Expected collision damage, got ${impact.damage}`);
    assert.ok(impact.lastImpactSpeed >= 15 && impact.lastImpactSpeed <= 20, `Expected a 15–20 m/s front impact, got ${impact.lastImpactSpeed}`);
    assert.ok(impact.damage > 0, 'Damage remains available through telemetry without a persistent HUD');
    const impactMetrics = await desktop.evaluate(() => window.carLab.performance());
    await desktop.screenshot({ path: 'tools/screenshots/damage-impact.png' });
    await desktop.locator('#settings-button').click();
    await desktop.getByRole('button', { name: 'Вернуть машину' }).click(); await desktop.waitForTimeout(100);
    assert.equal((await desktop.evaluate(() => window.carLab.telemetry())).damage, 0);
    const resetTraffic = await desktop.evaluate(() => window.carLab.traffic());
    const resetTrafficAI = await desktop.evaluate(() => window.carLab.trafficAI());
    assert.equal(resetTraffic.length, 60, 'Reset should restore the selected traffic count');
    assert.ok(resetTraffic.every((car, index) => Math.hypot(car.x - resetTrafficAI[index].spawn.x, car.z - resetTrafficAI[index].spawn.z) < 1.5),
      'Reset should return NPCs to their seeded road spawns');
    await desktop.locator('#settings-controls select').first().selectOption('Лёгкая');
    assert.equal(await desktop.evaluate(() => window.carLab.performance().dpr), 1);
    await desktop.locator('#settings-controls select').first().selectOption('Высокая');
    await desktop.keyboard.press('Escape');
    await desktop.close();

    for (const [direction, key, minimumSpeed, maximumSpeed] of [['side', 'KeyW', 3, 8], ['rear', 'KeyS', 8, 12]]) {
      const impactPage = await browser.newPage({ viewport: { width: 1000, height: 800 } });
      impactPage.on('pageerror', error => errors.push(error.message));
      await impactPage.goto(`${baseUrl}?damageTest=${direction}#debug`);
      await impactPage.waitForFunction(() => window.carLab?.modelReady);
      await impactPage.waitForFunction(() => window.carLab.trafficStatus().count === 60 && !window.carLab.trafficStatus().pending);
      await impactPage.keyboard.down(key); await impactPage.waitForTimeout(2500); await impactPage.keyboard.up(key);
      const orientedImpact = await impactPage.evaluate(() => window.carLab.telemetry());
      assert.ok(orientedImpact.damage > 0, `${direction} impact should cause damage`);
      assert.ok(orientedImpact.lastImpactSpeed >= minimumSpeed && orientedImpact.lastImpactSpeed <= maximumSpeed, `${direction} impact speed ${orientedImpact.lastImpactSpeed}`);
      await impactPage.screenshot({ path: `tools/screenshots/damage-${direction}.png` });
      await impactPage.close();
    }

    const cityDrive = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    cityDrive.on('pageerror', error => errors.push(error.message));
    await cityDrive.goto(`${baseUrl}#debug`);
    await cityDrive.waitForFunction(() => window.carLab?.modelReady);
    await cityDrive.waitForFunction(() => window.carLab.trafficStatus().count === 60 && !window.carLab.trafficStatus().pending);
    await cityDrive.keyboard.down('KeyW'); await cityDrive.waitForTimeout(3200); await cityDrive.keyboard.up('KeyW');
    const roadRun = await cityDrive.evaluate(() => window.carLab.telemetry());
    assert.ok(Math.hypot(roadRun.position.x, roadRun.position.z) > 15, `Player should travel out through connected streets: ${JSON.stringify(roadRun.position)}`);
    assert.equal(roadRun.damage, 0, 'A clear street route should not hit a building');
    await cityDrive.keyboard.down('KeyW'); await cityDrive.keyboard.down('KeyD'); await cityDrive.waitForTimeout(700);
    await cityDrive.keyboard.up('KeyD'); await cityDrive.keyboard.up('KeyW');
    const turn = await cityDrive.evaluate(() => window.carLab.telemetry());
    assert.ok(Math.abs(turn.heading - roadRun.heading) > 0.1, 'Player should turn through the district');
    await cityDrive.screenshot({ path: 'tools/screenshots/city-drive.png' });
    await cityDrive.locator('#settings-button').click();
    await cityDrive.getByRole('button', { name: 'Вернуть машину' }).click();
    assert.equal((await cityDrive.evaluate(() => window.carLab.telemetry())).damage, 0);
    await cityDrive.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(baseUrl);
    await mobile.waitForFunction(() => window.carLab?.modelReady);
    await mobile.waitForFunction(() => window.carLab.trafficStatus().count === 60 && !window.carLab.trafficStatus().pending);
    await mobile.waitForTimeout(700);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal((await mobile.evaluate(() => window.carLab.traffic())).length, 60);
    await mobile.screenshot({ path: 'tools/screenshots/city-mobile.png' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ city, idleDamage: idle.damage, trafficCount: trafficStart.length, frontImpact: { damage: impact.damage, speed: impact.lastImpactSpeed }, sideImpact: 'passed', rearImpact: 'passed', resetDamage: 0, roadRun, turn, impactMetrics, mobileWidth: 390, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
