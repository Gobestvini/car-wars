// One-finger donut check. Set PLAYWRIGHT_MODULE to an existing Playwright module path.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const baseUrl = process.env.CARWARS_BASE_URL || 'http://localhost:5173';

async function exercise(page, touch = false) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  await page.waitForFunction(() => window.carLab?.modelReady);
  const bounds = await page.locator('#scene').evaluate(canvas => {
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const radius = 60;
  const position = angle => ({ x: center.x + Math.cos(angle) * radius, y: center.y - Math.sin(angle) * radius });
  const session = touch ? await page.context().newCDPSession(page) : null;
  if (touch) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, id: 1 }] });
    for (const angle of [0, 1.15, 2.3]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...position(angle), id: 1 }] });
      await page.waitForTimeout(40);
    }
  } else {
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    for (const angle of [0, 1.15, 2.3]) {
      const p = position(angle);
      await page.mouse.move(p.x, p.y);
    }
  }
  const gestureState = await page.evaluate(() => ({ donut: window.carLab.donut(), joystick: window.carLab.joystick(), speed: window.carLab.telemetry().speed }));
  assert.equal(gestureState.donut.active, true, `${touch ? 'touch' : 'mouse'} gesture should activate: ${JSON.stringify(gestureState)}`);
  let previousHeading = (await page.evaluate(() => window.carLab.telemetry().heading));
  let unwrapped = 0;
  let rotationDirection = 0;
  const lapEnds = [];
  const points = [];
  for (let i = 0; i < 40; i++) {
    const angle = 2.3 + (Math.PI * 2 * 4 * i) / 40;
    if (touch) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...position(angle), id: 1 }] });
    else {
      const p = position(angle);
      await page.mouse.move(p.x, p.y, { steps: 3 });
    }
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => window.carLab.telemetry());
    unwrapped += Math.atan2(Math.sin(state.heading - previousHeading), Math.cos(state.heading - previousHeading));
    previousHeading = state.heading;
    rotationDirection = rotationDirection || Math.sign(unwrapped);
    if (rotationDirection * unwrapped >= Math.PI * 2 * (lapEnds.length + 1)) lapEnds.push(i);
    points.push({ x: state.position.x, z: state.position.z });
  }
  assert.ok(Math.abs(unwrapped) >= Math.PI * 4, `two circles, observed heading ${unwrapped}`);
  assert.ok(lapEnds.length >= 2, 'two complete circles should be visible in the trajectory');
  assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.z)));
  const circle = (from, to) => {
    const segment = points.slice(from, to);
    const center = { x: segment.reduce((sum, p) => sum + p.x, 0) / segment.length,
      z: segment.reduce((sum, p) => sum + p.z, 0) / segment.length };
    const radius = segment.reduce((sum, p) => sum + Math.hypot(p.x - center.x, p.z - center.z), 0) / segment.length;
    return { center, radius };
  };
  const first = circle(0, lapEnds[0]);
  const second = circle(lapEnds[0], lapEnds[1]);
  assert.ok(first.radius <= 8 && second.radius <= 8, `radii ${first.radius}, ${second.radius}`);
  assert.ok(Math.hypot(first.center.x - second.center.x, first.center.z - second.center.z) <= 4, 'circle center drift');
  const beforeRelease = await page.evaluate(() => window.carLab.telemetry());
  if (touch) await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await page.mouse.up();
  await page.waitForTimeout(650);
  const afterRelease = await page.evaluate(() => ({ active: window.carLab.donut().active, telemetry: window.carLab.telemetry() }));
  assert.equal(afterRelease.active, false, 'release should clear donut mode');
  assert.ok(afterRelease.telemetry.speed > 0, 'car coasts after release');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `tools/screenshots/donut-${touch ? 'touch' : 'mouse'}.png` });
  return { mode: touch ? 'touch' : 'mouse', unwrappedHeading: unwrapped, beforeRelease, afterRelease: afterRelease.telemetry, errors };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const entryPage = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await entryPage.goto(baseUrl);
    await entryPage.waitForFunction(() => window.carLab?.modelReady);
    await entryPage.keyboard.down('KeyW'); await entryPage.waitForTimeout(1600); await entryPage.keyboard.up('KeyW');
    const entrySpeed = await entryPage.evaluate(() => window.carLab.telemetry().speed);
    assert.ok(entrySpeed >= 45 && entrySpeed <= 60, `entry speed should cover normal driving pace, got ${entrySpeed}`);
    await entryPage.mouse.move(500, 400); await entryPage.mouse.down();
    for (const angle of [0, 0.8, 1.6]) {
      await entryPage.mouse.move(500 + Math.cos(angle) * 40, 400 - Math.sin(angle) * 40);
      await entryPage.waitForTimeout(150);
    }
    assert.equal(await entryPage.evaluate(() => window.carLab.donut().active), true, 'a short-radius circle should enter drift while moving');
    await entryPage.mouse.up(); await entryPage.close();
    const desktop = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const mouse = await exercise(desktop);
    await desktop.close();
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const touch = await exercise(mobile, true);
    console.log(JSON.stringify({ movingEntry: { speed: entrySpeed, active: true, radius: 40 }, mouse, touch }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
