import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CarSimulation, DEFAULT_TUNING, STEP } from './vehicle.js';
import { joystickVector } from './joystick.js';
import { directionalInput } from './driving-input.js';
import { FixedStepper } from './game-loop.js';
import { TireTracks } from './tire-tracks.js';
import { smoothCameraScale, targetCameraScale } from './camera-distance.js';
import { createCityPlan, CITY_BOUNDS, ROAD_WIDTH } from './city-generator.js';
import { createTraffic } from './traffic.js';
import { CarDeformation } from './car-deformation.js';
import { BuildingOcclusion } from './building-occlusion.js';
import './style.css';

const $ = id => document.getElementById(id);
const canvas = $('scene');
const sim = new CarSimulation();
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  $('load-status').textContent = 'Для 3D нужен браузер с поддержкой WebGL.';
  throw error;
}
let quality = matchMedia('(pointer: coarse)').matches ? 'low' : 'high';
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'low' ? 1 : 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#ecece6');
scene.fog = new THREE.Fog('#ecece6', 65, 150);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
const follow = new THREE.Vector3();
const cameraOffset = new THREE.Vector3(12, 20, -17);
let cameraDistanceScale = 1;
scene.add(new THREE.HemisphereLight(0xf7fbf0, 0x9aa69b, 2.6));
const sun = new THREE.DirectionalLight(0xfff5df, 3.1);
sun.position.set(-14, 24, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -16;
sun.shadow.camera.right = sun.shadow.camera.top = 16;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

const cityPlan = createCityPlan();
const city = new THREE.Group(); city.name = 'Procedural City'; scene.add(city);
const pavementMaterial = new THREE.MeshStandardMaterial({ color: '#bdb9aa', roughness: 1 });
const roadMaterial = new THREE.MeshStandardMaterial({ color: '#353a3c', roughness: 0.96 });
function cityPlane(width, depth, material, x = 0, z = 0, y = 0.015) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); mesh.receiveShadow = true; city.add(mesh);
}
cityPlane(CITY_BOUNDS * 2, CITY_BOUNDS * 2, pavementMaterial, 0, 0, -0.015);
for (const road of cityPlan.roads) {
  cityPlane(ROAD_WIDTH, CITY_BOUNDS * 2, roadMaterial, road, 0, 0.005);
  cityPlane(CITY_BOUNDS * 2, ROAD_WIDTH, roadMaterial, 0, road, 0.005);
}
// Short connectors turn the empty central block into an open, four-way start plaza.
cityPlane(ROAD_WIDTH, 50, roadMaterial, 0, 0, 0.006);
cityPlane(50, ROAD_WIDTH, roadMaterial, 0, 0, 0.006);
const dashGeometry = new THREE.BoxGeometry(0.16, 0.025, 2.2);
const dashMaterial = new THREE.MeshStandardMaterial({ color: '#d6cdb4', roughness: 1 });
const dashPositions = [];
const dashMatrix = new THREE.Matrix4(); let dashIndex = 0;
for (const road of cityPlan.roads) for (let offset = -CITY_BOUNDS + 6; offset <= CITY_BOUNDS - 6; offset += 6) {
  if (cityPlan.roads.some(cross => Math.abs(offset - cross) < ROAD_WIDTH / 2 + 3)) continue;
  dashPositions.push([road, offset], [offset, road]);
}
const dashes = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashPositions.length);
for (const [x, z] of dashPositions) { dashMatrix.makeTranslation(x, 0.025, z); dashes.setMatrixAt(dashIndex++, dashMatrix); }
city.add(dashes);
const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
const buildings = new THREE.InstancedMesh(buildingGeometry, buildingMaterial, cityPlan.buildings.length);
const buildingMatrix = new THREE.Matrix4();
const buildingEntries = [];
for (let i = 0; i < cityPlan.buildings.length; i++) {
  const b = cityPlan.buildings[i];
  buildingMatrix.compose(new THREE.Vector3(b.x, b.height / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.width, b.height, b.depth));
  buildings.setMatrixAt(i, buildingMatrix); buildings.setColorAt(i, new THREE.Color(b.color));
  const entry = { ...b, index: i, opacity: 1, proxy: null, proxyMaterial: null,
    bounds: { min: { x: b.x - b.width / 2, y: 0, z: b.z - b.depth / 2 }, max: { x: b.x + b.width / 2, y: b.height, z: b.z + b.depth / 2 } }, caps: [] };
  buildingEntries.push(entry);
  if (b.landmark) {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(b.width * 0.55, b.kind === 'tower' ? 5 : 2.5, b.kind === 'clock' ? 4 : 8), new THREE.MeshStandardMaterial({ color: '#675e53', roughness: 0.9 }));
    cap.position.set(b.x, b.height + (b.kind === 'tower' ? 2.5 : 1.25), b.z); cap.castShadow = true; city.add(cap);
    entry.caps.push(cap);
  }
}
buildings.castShadow = true; buildings.receiveShadow = true; city.add(buildings);
const buildingOcclusion = new BuildingOcclusion(THREE, city, buildings, buildingGeometry, buildingEntries);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ color: '#71816c', roughness: 1 }));
grass.rotation.x = -Math.PI / 2; grass.position.y = -0.04; grass.receiveShadow = true; scene.add(grass);
for (const [x, z, sx, sz] of [[0, -CITY_BOUNDS, CITY_BOUNDS * 2 + ROAD_WIDTH, 3], [0, CITY_BOUNDS, CITY_BOUNDS * 2 + ROAD_WIDTH, 3], [-CITY_BOUNDS, 0, 3, CITY_BOUNDS * 2 + ROAD_WIDTH], [CITY_BOUNDS, 0, 3, CITY_BOUNDS * 2 + ROAD_WIDTH]]) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, 3.2, sz), new THREE.MeshStandardMaterial({ color: '#8a8980', roughness: 1 }));
  wall.position.set(x, 1.6, z); wall.castShadow = true; city.add(wall);
}
for (const b of cityPlan.buildings) sim.addStaticBox({ x: b.x, y: b.height / 2, z: b.z, halfX: b.width / 2, halfY: b.height / 2, halfZ: b.depth / 2 });
for (const [x, z, sx, sz] of [[0, -CITY_BOUNDS, CITY_BOUNDS * 2 + ROAD_WIDTH, 3], [0, CITY_BOUNDS, CITY_BOUNDS * 2 + ROAD_WIDTH, 3], [-CITY_BOUNDS, 0, 3, CITY_BOUNDS * 2 + ROAD_WIDTH], [CITY_BOUNDS, 0, 3, CITY_BOUNDS * 2 + ROAD_WIDTH]]) sim.addStaticBox({ x, y: 1.6, z, halfX: sx / 2, halfY: 1.6, halfZ: sz / 2 });
const damageTestType = new URLSearchParams(location.search).get('damageTest');
const damageTest = damageTestType !== null;
const damageTestObstacles = damageTestType === 'wheel' ? [[-1.72, 0.44, 0.3, 0.7, 1.4, -0.45]]
  : damageTestType === 'side' ? [[-6, 10, 1.2, 14]]
  : damageTestType === 'rear' ? [[4, -10, 8, 1.2]]
    : damageTestType === 'front' ? [[-8, 18, 10, 1.2]]
      : [[-8, 18, 10, 1.2], [-6, 10, 1.2, 14], [4, -10, 8, 1.2]];
if (damageTest) for (const [x, z, sx, sz, height = 1.4, yaw = 0] of damageTestObstacles) {
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(sx, height, sz), new THREE.MeshStandardMaterial({ color: '#c4a45f', roughness: 0.95 }));
  obstacle.position.set(x, height / 2, z); obstacle.rotation.y = yaw; obstacle.castShadow = true; obstacle.receiveShadow = true; city.add(obstacle);
  sim.addStaticBox({ x, y: height / 2, z, halfX: sx / 2, halfY: height / 2, halfZ: sz / 2, yaw });
}

const car = new THREE.Group(); scene.add(car);
const traffic = createTraffic(scene, THREE, 6);
const visualWheels = [];
let modelReady = false;
let loading = false;
let bodyDeformation = null;
const treadGeometry = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 48, 1, true);
const treadMaterial = new THREE.MeshStandardMaterial({ color: '#252b2c', roughness: 0.92 });
async function loadCar() {
  if (loading || modelReady) return;
  loading = true;
  $('retry-load').hidden = true;
  try {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => { $('load-status').textContent = `Загрузка ресурсов: ${loaded}/${total}`; };
    const gltf = await new GLTFLoader(manager).loadAsync(`${import.meta.env.BASE_URL}models/sedan.glb`);
    const model = gltf.scene;
    const wheelNodes = [];
    model.traverse(node => {
      if (node.name.startsWith('wheel-')) wheelNodes.push(node);
      if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; node.material.roughness = 0.6; }
    });
    // Model's +Z is its nose. Scale bodywork to a full-size 4.5m sedan.
    const body = model.getObjectByName('body');
    body.geometry.computeBoundingBox();
    const bounds = body.geometry.boundingBox;
    const scale = 4.45 / (bounds.max.z - bounds.min.z);
    model.scale.set(1.25, 1.15, scale);
    model.position.y = -0.50;
    body.geometry = body.geometry.clone();
    model.updateMatrixWorld(true);
    body.updateWorldMatrix(true, false);
    bodyDeformation = new CarDeformation(body.geometry, body.matrixWorld.clone());
    car.add(model);
    // Detach wheels so suspension, steering and wheel spin remain independent of chassis roll.
    wheelNodes.sort((a, b) => (b.position.z - a.position.z) || (a.position.x - b.position.x));
    for (const node of wheelNodes) {
      node.geometry.computeBoundingBox();
      const box = node.geometry.boundingBox;
      const center = box.getCenter(new THREE.Vector3());
      node.geometry = node.geometry.clone();
      node.geometry.translate(-center.x, -center.y, -center.z);
      const wheelScale = sim.wheels[visualWheels.length].radius * 2 / (box.max.y - box.min.y);
      node.removeFromParent();
      node.position.set(0, 0, 0);
      // Keep a 30cm tire width: uniformly scaling the asset made the wheels protrude.
      node.scale.set(0.3 / (box.max.x - box.min.x), wheelScale * 0.98, wheelScale * 0.98);
      const pivot = new THREE.Group(); const spin = new THREE.Group();
      const tread = new THREE.Mesh(
        treadGeometry,
        treadMaterial,
      );
      tread.rotation.z = Math.PI / 2; tread.castShadow = true;
      spin.add(node, tread); pivot.add(spin); scene.add(pivot);
      visualWheels.push({ pivot, spin });
    }
    // Compile while the loading indicator is visible, before accepting movement.
    $('load-status').textContent = 'Подготовка сцены…';
    sim.reset();
    // The wheel test preset starts with the same direct 18 m/s side impact as its physics test.
    if (damageTestType === 'wheel') sim.body.velocity.set(-16.2, 0, -7.83);
    car.position.copy(sim.body.position);
    car.quaternion.copy(sim.body.quaternion);
    visualWheels.forEach(({ pivot }, i) => { pivot.position.copy(sim.wheels[i].position); pivot.quaternion.copy(car.quaternion); });
    updateCamera(1);
    await renderer.compileAsync(scene, camera);
    modelReady = true;
    $('load-status').textContent = '';
  } catch (error) {
    console.error('Car model failed to load', error);
    // A retry must not duplicate partially prepared meshes after a compile failure.
    for (const { pivot } of visualWheels) pivot.removeFromParent();
    visualWheels.length = 0;
    car.traverse(node => { if (node.isMesh) { node.geometry?.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose(); } });
    bodyDeformation = null;
    car.clear();
    $('load-status').textContent = 'Не удалось загрузить машину.';
    $('retry-load').hidden = false;
  } finally {
    loading = false;
  }
}
loadCar();
$('retry-load').addEventListener('click', loadCar);

const tracks = new TireTracks(scene);

const pointer = { active: false, id: null, x: 0, y: 0, startX: 0, startY: 0 };
let driveDirection = 1;
const keys = new Set();
// The camera has a fixed yaw: convert screen directions to horizontal world axes.
const screenRight = new THREE.Vector3();
const screenUp = new THREE.Vector3();
const desiredDirection = new THREE.Vector3();
function updatePointer(event) {
  pointer.x = event.clientX; pointer.y = event.clientY;
  const stick = joystickVector(pointer.startX, pointer.startY, pointer.x, pointer.y);
  $('touch-marker').firstElementChild.style.transform = `translate(${stick.knobX}px, ${stick.knobY}px)`;
}
canvas.addEventListener('pointerdown', event => {
  if (pointer.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
  if (!modelReady) return;
  pointer.active = true; pointer.id = event.pointerId;
  pointer.startX = event.clientX; pointer.startY = event.clientY;
  $('touch-marker').style.left = `${pointer.startX}px`; $('touch-marker').style.top = `${pointer.startY}px`;
  updatePointer(event);
  canvas.setPointerCapture(event.pointerId);
  $('touch-marker').style.display = 'block';
});
canvas.addEventListener('pointermove', event => { if (pointer.active && pointer.id === event.pointerId) updatePointer(event); });
function releasePointer(event) {
  if (event && event.pointerId !== pointer.id) return;
  pointer.active = false; pointer.id = null;
  $('touch-marker').style.display = 'none';
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('lostpointercapture', releasePointer);
window.addEventListener('blur', () => { releasePointer(); keys.clear(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { releasePointer(); keys.clear(); }
  stepper.reset();
  previousTime = performance.now();
});
window.addEventListener('keydown', event => {
  if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.code === 'KeyR' && !event.repeat) reset();
});
window.addEventListener('keyup', event => keys.delete(event.code));
const has = (...codes) => codes.some(code => keys.has(code));
function getInput() {
  const telemetry = sim.telemetry();
  const speed = telemetry.signedSpeed;
  const keyboard = has('KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space');
  let input = { steer: 0, throttle: 0, brake: 0.18, handbrake: false };
  if (keyboard) {
    const forward = has('KeyW', 'ArrowUp'); const back = has('KeyS', 'ArrowDown');
    input.steer = Number(has('KeyD','ArrowRight')) - Number(has('KeyA','ArrowLeft'));
    input.brake = back && speed > 0.5 ? 1 : forward && speed < -0.5 ? 1 : 0;
    input.throttle = input.brake ? 0 : Number(forward) - Number(back);
    input.handbrake = has('Space');
  } else if (pointer.active) {
    const stick = joystickVector(pointer.startX, pointer.startY, pointer.x, pointer.y);
    if (stick.strength > 0) {
      screenRight.setFromMatrixColumn(camera.matrixWorld, 0); screenRight.y = 0; screenRight.normalize();
      screenUp.setFromMatrixColumn(camera.matrixWorld, 1); screenUp.y = 0; screenUp.normalize();
      desiredDirection.copy(screenRight).multiplyScalar(stick.x).addScaledVector(screenUp, -stick.y);
      input = directionalInput(Math.atan2(desiredDirection.x, desiredDirection.z), telemetry.heading, speed, stick.strength, driveDirection);
      driveDirection = input.direction;
    }
  }
  return input;
}

function reset() {
  releasePointer(); keys.clear(); sim.reset(); traffic.reset(); driveDirection = 1;
  bodyDeformation?.restore();
  follow.set(0, 0, 0);
  cameraDistanceScale = 1;
  tracks.reset();
  car.position.copy(sim.body.position);
  car.quaternion.copy(sim.body.quaternion);
  visualWheels.forEach(({ pivot }, i) => { pivot.position.copy(sim.wheels[i].position); pivot.quaternion.copy(sim.body.quaternion); });
  stepper.reset();
  updateCamera(1);
}
$('reset').addEventListener('click', reset);
$('settings-button').addEventListener('click', () => {
  setSettingsOpen(settingsButton.getAttribute('aria-expanded') !== 'true');
});
const settingsPanel = $('settings');
const settingsButton = $('settings-button');
let settingsCloseTimer = 0;
function setSettingsOpen(open) {
  clearTimeout(settingsCloseTimer);
  settingsButton.setAttribute('aria-expanded', String(open));
  if (open) {
    settingsPanel.hidden = false;
    settingsPanel.inert = false;
    requestAnimationFrame(() => settingsPanel.classList.add('is-open'));
  } else {
    settingsPanel.inert = true;
    settingsPanel.classList.remove('is-open');
    settingsCloseTimer = setTimeout(() => { settingsPanel.hidden = true; }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 210);
    settingsButton.focus({ preventScroll: true });
  }
}
$('close-settings').addEventListener('click', () => setSettingsOpen(false));
window.addEventListener('keydown', event => { if (event.code === 'Escape' && settingsButton.getAttribute('aria-expanded') === 'true') setSettingsOpen(false); });
function updateTuning() {
  sim.tuning.softness = +$('softness').value; sim.tuning.grip = +$('grip').value; sim.tuning.power = +$('power').value;
  $('softness-value').textContent = sim.tuning.softness > 0.6 ? 'Мягкая' : sim.tuning.softness > 0.3 ? 'Средняя' : 'Жёсткая';
  $('grip-value').textContent = sim.tuning.grip.toFixed(2);
  $('power-value').textContent = `${Math.round(sim.tuning.power * 100)}%`;
}
for (const id of ['softness','grip','power']) $(id).addEventListener('input', updateTuning);
$('reset-tuning').addEventListener('click', () => { for (const id of ['softness','grip','power']) $(id).value = DEFAULT_TUNING[id]; updateTuning(); });
$('trails').addEventListener('change', () => { tracks.mesh.visible = $('trails').checked; });

const cameraGoal = new THREE.Vector3();
function updateCamera(dt) {
  const goal = cameraGoal.set(car.position.x, 0, car.position.z);
  follow.lerp(goal, 1 - Math.exp(-dt * 8));
  const speedKmh = Math.hypot(sim.body.velocity.x, sim.body.velocity.z) * 3.6;
  cameraDistanceScale = smoothCameraScale(cameraDistanceScale, targetCameraScale(speedKmh), dt);
  const mobile = innerWidth < 700;
  camera.position.copy(follow).addScaledVector(cameraOffset, cameraDistanceScale * (mobile ? 1.1 : 1));
  camera.lookAt(follow.x, 0.5, follow.z);
  camera.updateMatrixWorld();
  sun.position.set(follow.x - 14, 24, follow.z + 10); sun.target.position.copy(follow);
}
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize(); updateCamera(1);
const currentChassisQuaternion = new THREE.Quaternion();
const stepper = new FixedStepper(STEP);
let previousTime = performance.now(), hudTime = 0;
let input = { brake: 0, handbrake: false };
const debug = location.hash === '#debug' || new URLSearchParams(location.search).has('debug');
$('performance').hidden = !debug;
const metrics = { fps: 0, physicsMs: 0, frameCpuMs: 0, calls: 0, triangles: 0, quality };
let metricTime = 0, metricFrames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const cpuStart = performance.now();
  const elapsed = Math.max(0, (now - previousTime) / 1000); previousTime = now;
  const dt = Math.min(elapsed, 0.08);
  if (document.hidden || !modelReady) { stepper.reset(); return; }
  const physicsStart = performance.now();
  const { alpha } = stepper.advance(elapsed, () => {
    input = getInput();
    sim.step(input);
    bodyDeformation?.apply(sim.drainImpactEvents());
    traffic.update(STEP);
    tracks.update(sim.wheels, $('trails').checked, STEP);
  });
  metrics.physicsMs = performance.now() - physicsStart;
  car.position.lerpVectors(sim.body.previousPosition, sim.body.position, alpha);
  currentChassisQuaternion.copy(sim.body.quaternion);
  car.quaternion.copy(sim.body.previousQuaternion).slerp(currentChassisQuaternion, alpha);
  visualWheels.forEach(({ pivot, spin }, i) => {
    const wheel = sim.wheels[i];
    if (wheel.detached && wheel.detachedBody) {
      pivot.position.set(wheel.detachedBody.position.x, wheel.detachedBody.position.y, wheel.detachedBody.position.z);
      pivot.quaternion.set(wheel.detachedBody.quaternion.x, wheel.detachedBody.quaternion.y, wheel.detachedBody.quaternion.z, wheel.detachedBody.quaternion.w);
    } else {
      pivot.position.lerpVectors(wheel.previousPosition, wheel.position, alpha);
      pivot.quaternion.copy(car.quaternion);
      if (wheel.front) pivot.rotateY(THREE.MathUtils.lerp(sim.previousSteering, sim.steering, alpha));
    }
    spin.rotation.x = THREE.MathUtils.lerp(wheel.previousRotation, wheel.rotation, alpha);
  });
  traffic.render(alpha);
  updateCamera(dt);
  buildingOcclusion.update(camera, car, dt);
  hudTime += dt;
  if (hudTime > 0.08) {
    hudTime = 0;
    const t = sim.telemetry();
    $('speed-value').textContent = String(Math.round(t.speed));
    $('speed-bar').style.width = `${Math.min(t.speed / 160 * 100, 100)}%`;
    $('gear').textContent = t.gear;
    $('damage-value').textContent = `${Math.round(t.damage * 100)}%`;
    $('damage-label').textContent = t.damageState === 'destroyed' ? 'РАЗРУШЕНА' : t.damageState === 'damaged' ? 'ПОВРЕЖДЕНА' : 'ИСПРАВНА';
    $('damage-bar').style.width = `${Math.round(t.damage * 100)}%`;
    $('drive-status').textContent = t.grounded < 2 ? 'В ВОЗДУХЕ' : input.handbrake ? 'РУЧНОЙ ТОРМОЗ' : t.slip > 0.55 && t.speed > 12 ? 'СКОЛЬЖЕНИЕ' : input.brake > 0.5 && t.speed > 3 ? 'ТОРМОЖЕНИЕ' : t.speed > 2 ? 'В ДВИЖЕНИИ' : 'ГОТОВ К ПОЕЗДКЕ';
  }
  tracks.prepareRender();
  renderer.render(scene, camera);
  metrics.frameCpuMs = performance.now() - cpuStart;
  metrics.calls = renderer.info.render.calls;
  metrics.triangles = renderer.info.render.triangles;
  metricTime += elapsed; metricFrames++;
  if (metricTime >= .5) {
    metrics.fps = metricFrames / metricTime;
    metricFrames = 0; metricTime = 0;
    if (debug) $('performance').textContent = `${metrics.fps.toFixed(0)} FPS · CPU ${metrics.frameCpuMs.toFixed(1)} ms · физика ${metrics.physicsMs.toFixed(1)} ms\n${metrics.calls} draw calls · ${metrics.triangles} triangles · ${quality} · DPR ${renderer.getPixelRatio()}`;
  }
}
requestAnimationFrame(frame);
// Read-only diagnostics for browser smoke tests and future handling comparisons.
window.carLab = {
  performance: () => ({ ...metrics, dpr: renderer.getPixelRatio(), droppedSeconds: stepper.droppedSeconds, trailSegments: tracks.count }),
  telemetry: () => sim.telemetry(), get modelReady() { return modelReady; }, get tuning() { return { ...sim.tuning }; },
  city: () => ({ seed: cityPlan.seed, buildings: cityPlan.buildings.length, landmarks: cityPlan.landmarks.length, bounds: cityPlan.bounds, roadWidth: ROAD_WIDTH, roads: cityPlan.roads, hasBuildingWindows: false,
    fadedBuildings: buildingEntries.filter(entry => entry.opacity < 0.999).length }),
  damageTest,
  joystick: () => ({ active: pointer.active, startX: pointer.startX, startY: pointer.startY, direction: driveDirection, ...joystickVector(pointer.startX, pointer.startY, pointer.x, pointer.y) }),
  wheelTransforms: () => visualWheels.map(({ pivot }, i) => ({ position: pivot.position.toArray(), radius: sim.wheels[i].radius })),
  wheels: () => sim.wheels.map(wheel => ({ detached: wheel.detached, grounded: wheel.grounded })),
  traffic: () => traffic.states.map(({ x, z, heading, speed }) => ({ x, z, heading, speed })),
};
for (const id of ['softness', 'grip', 'power']) $(id).value = DEFAULT_TUNING[id];
updateTuning();

function applyQuality() {
  quality = $('quality').value;
  metrics.quality = quality;
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'low' ? 1 : 1.75));
  const size = quality === 'low' ? 512 : 1024;
  sun.shadow.mapSize.set(size, size);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  sun.shadow.needsUpdate = true;
  resize();
}
$('quality').value = quality;
$('quality').addEventListener('change', applyQuality);
applyQuality();
