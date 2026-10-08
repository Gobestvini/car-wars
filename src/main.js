import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CarSimulation, DEFAULT_TUNING, STEP } from './vehicle.js';
import { joystickVector } from './joystick.js';
import { directionalInput } from './driving-input.js';
import { DonutGesture, donutDriveInput } from './donut-input.js';
import { FixedStepper } from './game-loop.js';
import { TireTracks, DEFAULT_SKID_THRESHOLD, DEFAULT_TRACK_INTENSITY } from './tire-tracks.js';
import { smoothCameraScale, targetCameraScale } from './camera-distance.js';
import { createCityPlan, ROAD_WIDTH } from './city-generator.js';
import { createCityScene } from './city-scene.js';
import { createSurfaceHeightSampler } from './road-surface.js';
import { updateShadowCoverage } from './shadow-coverage.js';
import { createVehicleRuntime } from './traffic.js';
import { createPolicePursuit } from './police-pursuit.js';
import { createTrafficSignals } from './traffic-signals.js';
import { createWantedSystem } from './wanted-system.js';
import { createTrafficViolationDetector } from './traffic-violations.js';
import { createArrestSystem } from './arrest-system.js';
import { createMiniatureBlur } from './miniature-blur.js';
import { CarDeformation } from './car-deformation.js';
import { CarDamageEffects } from './car-damage-effects.js';
import { createSettings } from './settings.js';
import { clearSettingsDefaults, readSettingsDefaults, saveSettingsDefaults } from './settings-defaults.js';
import './style.css';
import packageInfo from '../package.json';
import { ART, ART_LIGHT, artQuality } from './art-direction.js';
import { stylePlayerBody } from './vehicle-visuals.js';

const $ = id => document.getElementById(id);
const debug = location.hash === '#debug' || new URLSearchParams(location.search).has('debug');
let cameraMode = 'follow';
const freeCameraSpeed = 15;
const factorySettings = {
  ...DEFAULT_TUNING,
  quality: matchMedia('(pointer: coarse)').matches ? 'Лёгкая' : 'Высокая',
  blurStrength: 1,
  blurFocusSize: 68,
  trails: true,
  skidThreshold: DEFAULT_SKID_THRESHOLD,
  trackIntensity: DEFAULT_TRACK_INTENSITY,
  roadWidth: ROAD_WIDTH,
  trafficCount: 60,
  policeCount: 2,
  cameraSpeed: freeCameraSpeed,
  drawDistanceFollow: 200,
  drawDistanceFree: 600,
};
const getSettingsStorage = () => { try { return window.localStorage; } catch { return null; } };
const savedDefaults = readSettingsDefaults(getSettingsStorage(), factorySettings);
const canvas = $('scene');
const speedDisplay = $('speed');
const wantedDisplay = $('wanted');
const wantedStars = [...document.querySelectorAll('#wanted-stars .wanted-star')];
const wanted = createWantedSystem();
const violations = createTrafficViolationDetector();
const arrest = createArrestSystem();
const arrestBanner = $('arrest-banner');
const arrestStatus = $('arrest-status');
const arrestProgress = $('arrest-progress');
const arrestTimer = $('arrest-timer');
const arrestRestart = $('arrest-restart');
let lastArrestHudState = '';
let wantedRenderKey = '';
function renderWantedHud() {
  const state = wanted.snapshot();
  const key = `${state.level}:${state.pendingStar || 0}:${Math.ceil(state.warningRemaining * 2)}`;
  if (key === wantedRenderKey) return;
  wantedRenderKey = key;
  wantedDisplay.setAttribute('aria-label', `Розыск: ${state.level} из 6${state.pendingStar ? ', предупреждение' : ''}`);
  wantedStars.forEach((star, index) => {
    const pending = state.pendingStar === index + 1;
    star.dataset.state = index < state.level ? 'filled' : pending ? 'pending' : 'empty';
    star.classList.toggle('is-warning', pending);
  });
}
function renderArrestHud(result = arrest.snapshot()) {
  const visible = result.state !== 'idle';
  arrestBanner.hidden = !visible;
  arrestRestart.hidden = result.state !== 'arrested';
  if (result.state !== lastArrestHudState) {
    lastArrestHudState = result.state;
    arrestStatus.textContent = result.state === 'holding' ? 'Полиция удерживает машину — уезжайте, чтобы вырваться'
      : result.state === 'arresting' ? 'Арест — уезжайте, чтобы вырваться'
        : result.state === 'arrested' ? 'Арестован' : '';
  }
  arrestProgress.value = result.state === 'holding' ? result.holdProgress : result.progress;
  arrestProgress.setAttribute('aria-valuetext', result.state === 'holding'
    ? `${Math.ceil((1 - result.holdProgress) * 2)} секунд до ареста`
    : `${Math.ceil(result.remainingSeconds)} секунд`);
  arrestTimer.textContent = result.state === 'holding' ? `Удержание ${Math.ceil((1 - result.holdProgress) * 2)} с`
    : result.state === 'arresting' ? `${Math.ceil(result.remainingSeconds)} с — нажмите газ или уезжайте`
      : result.state === 'arrested' ? 'Нажмите R или начните заново' : '';
}
const sim = new CarSimulation();
Object.assign(sim.tuning, { softness: savedDefaults.softness, grip: savedDefaults.grip, power: savedDefaults.power });
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  $('load-status').textContent = 'Для 3D нужен браузер с поддержкой WebGL.';
  throw error;
}
let quality = savedDefaults.quality === 'Лёгкая' ? 'low' : 'high';
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'low' ? 1 : 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = ART_LIGHT.exposure;
const scene = new THREE.Scene();
scene.background = new THREE.Color(ART.fog);
scene.fog = new THREE.Fog(ART.fog, 100, 260);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
const miniatureBlur = createMiniatureBlur(renderer);
miniatureBlur.setStrength(savedDefaults.blurStrength);
miniatureBlur.setFocusSize(savedDefaults.blurFocusSize / 100);
const orbitControls = debug ? new OrbitControls(camera, canvas) : null;
if (orbitControls) {
  orbitControls.enabled = false;
  orbitControls.enableDamping = false;
  orbitControls.minDistance = 5;
  orbitControls.maxDistance = 600;
  orbitControls.minPolarAngle = 0.08;
  orbitControls.maxPolarAngle = Math.PI / 2 - 0.01;
}
const follow = new THREE.Vector3();
const cameraOffset = new THREE.Vector3(12, 20, -17);
const cameraLookAt = new THREE.Vector3();
let cameraDistanceScale = 1;
let shadowBounds = null;
scene.add(new THREE.HemisphereLight(ART_LIGHT.sky, ART_LIGHT.ground, ART_LIGHT.ambient));
const sun = new THREE.DirectionalLight(ART_LIGHT.sun, ART_LIGHT.intensity);
sun.position.set(-14, 24, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -48;
sun.shadow.camera.right = sun.shadow.camera.top = 48;
sun.shadow.camera.near = 0.1; sun.shadow.camera.far = 100;
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

const damageTestType = new URLSearchParams(location.search).get('damageTest');
const damageTest = damageTestType !== null;
const damageTestObstacles = damageTestType === 'wheel' ? [[-1.72, 0.44, 0.3, 0.7, 1.4, -0.45]]
  : damageTestType === 'side' ? [[-6, 10, 1.2, 14]]
  : damageTestType === 'rear' ? [[4, -10, 8, 1.2]]
    : damageTestType === 'front' ? [[-8, 18, 10, 1.2]]
      : [[-8, 18, 10, 1.2], [-6, 10, 1.2, 14], [4, -10, 8, 1.2]];
let cityPlan = createCityPlan(undefined, { roadWidth: savedDefaults.roadWidth });
let cityState = createCityScene(scene, sim, cityPlan, damageTest ? damageTestObstacles : []);
let buildingEntries = cityState.entries;
let buildingOcclusion = cityState.occlusion;
const spawnObstaclesForPlan = plan => [...plan.buildings.map(building => ({ x: building.x, z: building.z,
  halfX: building.width / 2, halfZ: building.depth / 2, heading: 0 })),
...(damageTest ? damageTestObstacles.map(([x, z, width, depth, , heading = 0]) =>
  ({ x, z, halfX: width / 2, halfZ: depth / 2, heading })) : [])];
let trafficSpawnObstacles = spawnObstaclesForPlan(cityPlan);

const car = new THREE.Group(); scene.add(car);
const damageEffects = new CarDamageEffects(scene);
const damagePreview = debug ? Number(new URLSearchParams(location.search).get('damagePreview') || 0) : 0;
const traffic = createVehicleRuntime(scene, THREE, savedDefaults.trafficCount, cityPlan.roadNetwork,
  cityPlan.roadWidth, trafficSpawnObstacles, { minX: -cityPlan.bounds, maxX: cityPlan.bounds,
    minZ: -cityPlan.bounds, maxZ: cityPlan.bounds });
traffic.attachPhysics(sim);
traffic.registerRole('police', { maxCount: 2, physicalOnly: true,
  create: ({ targetId }) => createPolicePursuit({ targetId }),
  update: (controller, context) => wanted.snapshot().level > 0 && arrest.snapshot().state !== 'arrested'
    ? controller.update(context)
    : (controller.reset(), { state: 'idle', reason: arrest.snapshot().state === 'arrested' ? 'arrest-complete' : 'no-wanted-level',
      control: { steer: 0, throttle: 0, brake: 1 } }),
  onContact: (controller, time) => controller.onContact(time),
  reset: controller => controller.reset() });
const policeSpawnSpecs = () => [-1, 1].map(side => ({ targetId: 'player', position: {
  x: sim.body.position.x + side * 8, y: 0, z: sim.body.position.z - 9 }, yaw: side * 0.25,
  options: { placement: 'nearest-safe', maxDistance: 48 } }));
traffic.setRoleCount('police', savedDefaults.policeCount, policeSpawnSpecs());
let trafficSignals = createTrafficSignals(cityPlan.roadNetwork);
traffic.setSignalController(trafficSignals);
const visualWheels = [];
const playerVisualSteeringScale = 0.5;
let modelReady = false;
let loading = false;
let bodyDeformation = null;
const treadGeometry = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 20, 1, true);
const treadMaterial = new THREE.MeshStandardMaterial({ color: '#252b2c', roughness: 0.92 });
async function loadCar() {
  if (loading || modelReady) return;
  loading = true;
  $('load-status').hidden = false;
  $('load-status').textContent = 'Загрузка машины…';
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
    stylePlayerBody(body);
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
    if (Number.isFinite(damagePreview)) sim.damage = Math.max(0, Math.min(1, damagePreview));
    // The wheel test preset starts with the same direct 18 m/s side impact as its physics test.
    if (damageTestType === 'wheel') sim.body.velocity.set(-16.2, 0, -7.83);
    car.position.copy(sim.body.position);
    car.quaternion.copy(sim.body.quaternion);
    visualWheels.forEach(({ pivot }, i) => { pivot.position.copy(sim.wheels[i].position); pivot.quaternion.copy(car.quaternion); });
    updateCamera(1);
    await renderer.compileAsync(scene, camera);
    await miniatureBlur.compile();
    modelReady = true;
    $('load-status').hidden = true;
  } catch (error) {
    console.error('Car model failed to load', error);
    // A retry must not duplicate partially prepared meshes after a compile failure.
    const failedGeometry = new Set(), failedMaterials = new Set(), failedTextures = new Set();
    const collectFailedResources = node => { if (node.isMesh) {
      if (node.geometry !== treadGeometry) failedGeometry.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!material || material === treadMaterial) continue;
        failedMaterials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) failedTextures.add(value);
      }
    } };
    for (const { pivot } of visualWheels) { pivot.traverse(collectFailedResources); pivot.removeFromParent(); }
    visualWheels.length = 0;
    car.traverse(collectFailedResources);
    for (const geometry of failedGeometry) geometry?.dispose();
    for (const material of failedMaterials) material.dispose();
    for (const texture of failedTextures) texture.dispose();
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

const tracks = new TireTracks(scene, undefined, { surfaceHeight: createSurfaceHeightSampler(cityPlan),
  threshold: savedDefaults.skidThreshold, intensity: savedDefaults.trackIntensity });
tracks.mesh.visible = savedDefaults.trails;

const pointer = { active: false, id: null, x: 0, y: 0, startX: 0, startY: 0 };
const donutGesture = new DonutGesture();
let driveDirection = 1;
const keys = new Set();
// The camera has a fixed yaw: convert screen directions to horizontal world axes.
const screenRight = new THREE.Vector3();
const screenUp = new THREE.Vector3();
const desiredDirection = new THREE.Vector3();
function updatePointer(event) {
  pointer.x = event.clientX; pointer.y = event.clientY;
  const stick = joystickVector(pointer.startX, pointer.startY, pointer.x, pointer.y);
  donutGesture.update(Math.atan2(-stick.y, stick.x), stick.strength, Math.abs(sim.signedSpeed) * 3.6, performance.now() / 1000);
  $('touch-marker').firstElementChild.style.transform = `translate(${stick.knobX}px, ${stick.knobY}px)`;
}
canvas.addEventListener('pointerdown', event => {
  if (cameraMode === 'free') return;
  if (pointer.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
  if (!modelReady) return;
  pointer.active = true; pointer.id = event.pointerId;
  donutGesture.begin();
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
  donutGesture.reset();
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
  if (event.target.closest?.('#settings')) return;
  if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.code === 'KeyR' && !event.repeat && cameraMode !== 'free') reset();
});
window.addEventListener('keyup', event => keys.delete(event.code));
const has = (...codes) => codes.some(code => keys.has(code));
function getInput() {
  if (cameraMode === 'free') return { steer: 0, throttle: 0, brake: 1, handbrake: false };
  if (arrest.snapshot().state === 'arrested') return { steer: 0, throttle: 0, brake: 1, handbrake: false };
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
      const donut = donutGesture.read(stick.strength, performance.now() / 1000);
      if (donut.active) {
        driveDirection = 1;
        return donutDriveInput(donut.direction, stick.strength);
      }
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
  violations.reset(); wanted.reset(); arrest.reset(); wantedRenderKey = ''; renderWantedHud();
  lastArrestHudState = ''; renderArrestHud();
  damageEffects.reset();
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
const settingsPanel = $('settings');
const settingsButton = $('settings-button');
let settingsCloseTimer = 0;
function setSettingsOpen(open) {
  clearTimeout(settingsCloseTimer);
  settingsButton.setAttribute('aria-expanded', String(open));
  if (open) {
    releasePointer(); keys.clear();
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
arrestRestart.addEventListener('click', reset);
window.addEventListener('keydown', event => { if (event.code === 'Escape' && settingsButton.getAttribute('aria-expanded') === 'true') setSettingsOpen(false); });
settingsButton.addEventListener('click', () => setSettingsOpen(settingsButton.getAttribute('aria-expanded') !== 'true'));
function setCameraMode(mode) {
  if (!debug || !orbitControls) return;
  releasePointer(); keys.clear();
  if (mode === 'free') {
    cameraMode = 'free';
    settings.values.drawDistance = settings.values.drawDistanceFree;
    settings.pane.refresh();
    updateCamera(0);
    orbitControls.target.copy(cameraLookAt);
    applyDrawDistance(settings.values.drawDistanceFree);
    orbitControls.enabled = true;
    orbitControls.update();
  } else {
    orbitControls.enabled = false;
    cameraMode = 'follow';
    settings.values.drawDistance = settings.values.drawDistanceFollow;
    settings.pane.refresh();
    applyDrawDistance(settings.values.drawDistanceFollow);
    updateCamera(0);
  }
}
let settingsReady = false;
const settings = createSettings($('settings-controls'), {
  ...savedDefaults,
  roadWidth: cityPlan.roadWidth,
  trafficCount: traffic.status().requestedCount,
  policeCount: traffic.roleCount('police'),
  trafficActual: traffic.status().count,
  trafficPendingReason: traffic.status().insertionReason || '—',
  debugMode: debug,
  cameraMode,
  cameraSpeed: savedDefaults.cameraSpeed,
  drawDistanceFollow: savedDefaults.drawDistanceFollow,
  drawDistanceFree: savedDefaults.drawDistanceFree,
  drawDistance: savedDefaults.drawDistanceFollow,
  defaultsStatus: '',
}, {
  onTuning: values => {
    sim.tuning.softness = values.softness;
    sim.tuning.grip = values.grip;
    sim.tuning.power = values.power;
    traffic.setRoleTuning('police', sim.tuning);
  },
  onQuality: value => {
    if (settingsReady) applyQuality();
    else quality = value === 'Лёгкая' ? 'low' : 'high';
  },
  onTrails: visible => { tracks.mesh.visible = visible; },
  onBlur: strength => miniatureBlur.setStrength(strength),
  onBlurFocusSize: size => miniatureBlur.setFocusSize(size / 100),
  onTrackConfig: values => tracks.setConfig({ threshold: values.skidThreshold, intensity: values.trackIntensity }),
  onRoadWidth: width => { if (settingsReady && width !== cityPlan.roadWidth) rebuildCity(width); },
  onTrafficCount: count => { if (settingsReady) traffic.setCount(count); },
  onPoliceCount: count => { if (settingsReady) traffic.setRoleCount('police', count, policeSpawnSpecs()); },
  onCameraMode: setCameraMode,
  onCameraSpeed: value => { settings.values.cameraSpeed = value; },
  onDrawDistance: value => {
    const key = cameraMode === 'free' ? 'drawDistanceFree' : 'drawDistanceFollow';
    settings.values[key] = value;
    applyDrawDistance(value);
  },
  onSaveDefaults: values => {
    values.defaultsStatus = saveSettingsDefaults(getSettingsStorage(), values, factorySettings)
      ? 'Дефолты записаны' : 'Не удалось записать';
    settings.pane.refresh();
  },
  onClearDefaults: () => {
    if (clearSettingsDefaults(getSettingsStorage())) location.reload();
    else {
      settings.values.defaultsStatus = 'Не удалось очистить';
      settings.pane.refresh();
    }
  },
  onReset: reset,
  onResetTuning: (values, pane) => {
    Object.assign(values, DEFAULT_TUNING);
    sim.tuning.softness = values.softness;
    sim.tuning.grip = values.grip;
    sim.tuning.power = values.power;
    pane.refresh();
  },
});
settingsReady = true;

function applyDrawDistance(distance) {
  const far = Math.min(1000, Math.max(100, distance));
  camera.far = Math.max(camera.near + 1, far);
  camera.updateProjectionMatrix();
  if (debug || far !== 200) {
    scene.fog.near = far * 0.5;
    scene.fog.far = far * 0.95;
  } else {
    scene.fog.near = 100;
    scene.fog.far = 260;
  }
}
applyDrawDistance(cameraMode === 'free' ? settings.values.drawDistanceFree : settings.values.drawDistanceFollow);

function rebuildCity(roadWidth) {
  const nextPlan = createCityPlan(cityPlan.seed, { roadWidth });
  releasePointer(); keys.clear();
  cityState.dispose();
  cityPlan = nextPlan;
  tracks.setSurfaceHeightSampler(createSurfaceHeightSampler(cityPlan));
  cityState = createCityScene(scene, sim, cityPlan, damageTest ? damageTestObstacles : []);
  trafficSpawnObstacles = spawnObstaclesForPlan(cityPlan);
  traffic.setRoadNetwork(cityPlan.roadNetwork, cityPlan.roadWidth, trafficSpawnObstacles);
  trafficSignals = createTrafficSignals(cityPlan.roadNetwork);
  traffic.setSignalController(trafficSignals);
  buildingEntries = cityState.entries;
  buildingOcclusion = cityState.occlusion;
  reset();
}

const cameraGoal = new THREE.Vector3();
function updateCamera(dt) {
  const goal = cameraGoal.set(car.position.x, 0, car.position.z);
  follow.copy(goal);
  const speedKmh = Math.hypot(sim.body.velocity.x, sim.body.velocity.z) * 3.6;
  cameraDistanceScale = smoothCameraScale(cameraDistanceScale, targetCameraScale(speedKmh), dt);
  cameraLookAt.copy(follow); cameraLookAt.y = 0.5;
  if (cameraMode === 'follow') {
    // Scale the fixed offset around the fixed aim point so speed changes distance, never camera angle.
    const viewportScale = innerWidth < 700 ? 1.05 : innerHeight < 500 ? 0.82 : 1;
    camera.position.copy(cameraLookAt).addScaledVector(cameraOffset, cameraDistanceScale * 1.4 * viewportScale);
    camera.lookAt(cameraLookAt);
  } else orbitControls?.update();
  camera.updateMatrixWorld();
  const shadowTarget = cameraMode === 'free' ? orbitControls.target : follow;
  sun.position.set(shadowTarget.x - 14, 24, shadowTarget.z + 10); sun.target.position.copy(shadowTarget);
  shadowBounds = updateShadowCoverage(sun, camera, { resolution: sun.shadow.mapSize.x, casterHeight: 24 });
}
function segmentHitsRect(ax, az, bx, bz, minX, minZ, maxX, maxZ) {
  let enter = 0, leave = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [origin, direction, minimum, maximum] of [[ax, dx, minX, maxX], [az, dz, minZ, maxZ]]) {
    if (Math.abs(direction) < 1e-8) { if (origin < minimum || origin > maximum) return false; continue; }
    let first = (minimum - origin) / direction, last = (maximum - origin) / direction;
    if (first > last) [first, last] = [last, first];
    enter = Math.max(enter, first); leave = Math.min(leave, last);
    if (enter > leave) return false;
  }
  return true;
}
function arrestCorridorIsClear(playerPose, policeUnit) {
  return !cityPlan.buildings.some(building => segmentHitsRect(playerPose.x, playerPose.z, policeUnit.x, policeUnit.z,
    building.x - building.width / 2 - 0.65, building.z - building.depth / 2 - 0.65,
    building.x + building.width / 2 + 0.65, building.z + building.depth / 2 + 0.65));
}
const freeMove = new THREE.Vector3(), cameraForward = new THREE.Vector3(), cameraRight = new THREE.Vector3();
const previousFreeCameraPosition = new THREE.Vector3();
function moveFreeCamera(dt) {
  if (!orbitControls?.enabled) return;
  orbitControls.update();
  camera.getWorldDirection(cameraForward).setY(0).normalize();
  cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  freeMove.set(0, 0, 0)
    .addScaledVector(cameraForward, Number(has('KeyW')) - Number(has('KeyS')))
    .addScaledVector(cameraRight, Number(has('KeyD')) - Number(has('KeyA')));
  freeMove.y = Number(has('KeyE')) - Number(has('KeyQ'));
  if (freeMove.lengthSq() > 1) freeMove.normalize();
  freeMove.multiplyScalar((settings.values.cameraSpeed || freeCameraSpeed) * Math.min(dt, 0.05));
  previousFreeCameraPosition.copy(camera.position);
  camera.position.add(freeMove);
  camera.position.y = Math.max(3, Math.min(300, camera.position.y));
  freeMove.copy(camera.position).sub(previousFreeCameraPosition);
  orbitControls.target.add(freeMove);
  orbitControls.target.y = Math.max(0.5, Math.min(210, orbitControls.target.y));
}
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  miniatureBlur.resize(innerWidth, innerHeight, renderer.getPixelRatio());
  camera.aspect = innerWidth / innerHeight;
  camera.fov = 50;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize(); updateCamera(1);
const currentChassisQuaternion = new THREE.Quaternion();
const stepper = new FixedStepper(STEP);
let previousTime = performance.now();
let input = { brake: 0, handbrake: false };
$('performance').hidden = !debug;
const metrics = { fps: 0, physicsMs: 0, renderMs: 0, frameCpuMs: 0, frameIntervalMs: 0, calls: 0, triangles: 0, quality };
let metricTime = 0, metricFrames = 0;
let previousFrameTimestamp = null;
function frame(now) {
  requestAnimationFrame(frame);
  const cpuStart = performance.now();
  if (previousFrameTimestamp !== null) metrics.frameIntervalMs = now - previousFrameTimestamp;
  previousFrameTimestamp = now;
  const elapsed = Math.max(0, (now - previousTime) / 1000); previousTime = now;
  const dt = Math.min(elapsed, 0.08);
  if (document.hidden || !modelReady) { stepper.reset(); return; }
  const physicsStart = performance.now();
  const { alpha } = stepper.advance(elapsed, () => {
    input = getInput();
    const enabled = cameraMode !== 'free';
    const actorsBefore = traffic.physicalActors();
    const velocitiesBefore = new Map([[sim.body, { ...sim.body.velocity }],
      ...actorsBefore.map(actor => [actor.body, { ...actor.body.velocity }])]);
    traffic.stepWorld(input, STEP);
    const observed = violations.update({ dt: STEP, enabled, player: { x: sim.body.position.x, z: sim.body.position.z,
      heading: Math.atan2(2 * (sim.body.quaternion.x * sim.body.quaternion.z + sim.body.quaternion.w * sim.body.quaternion.y),
        1 - 2 * (sim.body.quaternion.x ** 2 + sim.body.quaternion.y ** 2)), vx: sim.body.velocity.x,
      vz: sim.body.velocity.z, body: sim.body }, actors: traffic.physicalActors(), contacts: sim.world.contacts,
      velocitiesBefore, approaches: cityState.signalApproaches,
      phaseAt: approach => trafficSignals.phase(approach.nodeId, approach.fromId, traffic.simulationTime()) });
    if (enabled) wanted.update(STEP, observed);
    renderWantedHud();
    const playerArrestPose = { x: sim.body.position.x, z: sim.body.position.z,
      speed: Math.hypot(sim.body.velocity.x, sim.body.velocity.z) };
    const policeForArrest = traffic.physicalActors().map(actor => ({ ...actor,
      speed: Math.hypot(actor.vx, actor.vz), clearPath: arrestCorridorIsClear(playerArrestPose, actor) }));
    const arrestResult = arrest.update(STEP, { wantedLevel: wanted.snapshot().level, player: playerArrestPose,
      police: policeForArrest, enabled: cameraMode !== 'free', damage: sim.damage });
    renderArrestHud(arrestResult);
    const trafficStatus = traffic.status();
    const pendingReason = trafficStatus.insertionReason || '—';
    if (settings.values.trafficActual !== trafficStatus.count || settings.values.trafficPendingReason !== pendingReason) {
      settings.values.trafficActual = trafficStatus.count;
      settings.values.trafficPendingReason = pendingReason;
      settings.pane.refresh();
    }
    bodyDeformation?.apply(sim.drainImpactEvents());
    tracks.update(sim.wheels, settings.values.trails, STEP);
  });
  metrics.physicsMs = performance.now() - physicsStart;
  speedDisplay.textContent = String(Math.round(Math.hypot(sim.body.velocity.x, sim.body.velocity.z) * 3.6));
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
      if (wheel.front) pivot.rotateY(THREE.MathUtils.lerp(sim.previousSteering, sim.steering, alpha) * playerVisualSteeringScale);
    }
    spin.rotation.x = THREE.MathUtils.lerp(wheel.previousRotation, wheel.rotation, alpha);
  });
  if (cameraMode === 'free') moveFreeCamera(dt);
  updateCamera(dt);
  cityState.updateSignals(trafficSignals, traffic.simulationTime(), camera, quality);
  traffic.render(alpha, camera);
  buildingOcclusion.update(camera, car, dt);
  damageEffects.update({ damage: sim.damage, car, camera, dt, quality });
  tracks.prepareRender();
  const renderStart = performance.now();
  miniatureBlur.render(scene, camera, { mode: cameraMode, car });
  metrics.renderMs = performance.now() - renderStart;
  metrics.frameCpuMs = performance.now() - cpuStart;
  metrics.calls = renderer.info.render.calls;
  metrics.triangles = renderer.info.render.triangles;
  metrics.signalBeams = cityState.signalBeam.count;
  metrics.signalBeamTotal = cityState.signalApproaches.length;
  metrics.signalBeamSamples = cityState.signalBeam.material.uniforms.sampleCount.value;
  metricTime += elapsed; metricFrames++;
  if (metricTime >= .5) {
    metrics.fps = metricFrames / metricTime;
    metricFrames = 0; metricTime = 0;
    Object.assign(metrics, traffic.performance());
    if (debug) $('performance').textContent = `${metrics.fps.toFixed(0)} FPS · CPU ${metrics.frameCpuMs.toFixed(1)} ms · рендер ${metrics.renderMs.toFixed(1)} ms · физика ${metrics.physicsMs.toFixed(1)} ms · AI ${metrics.aiMs.toFixed(2)} ms\n${metrics.calls} draw calls · ${metrics.triangles} triangles · bodies ${metrics.totalBodies} · traffic ${metrics.trafficBodies} · ${quality} · DPR ${renderer.getPixelRatio()} · beams ${metrics.signalBeams}/${metrics.signalBeamTotal} · ${metrics.signalBeamSamples} samples`;
  }
}
requestAnimationFrame(frame);
// Read-only diagnostics for browser smoke tests and future handling comparisons.
window.carLab = {
  version: packageInfo.version,
  performance: () => ({ ...metrics, dpr: renderer.getPixelRatio(), droppedSeconds: stepper.droppedSeconds, trailSegments: tracks.count }),
  trafficPerformance: () => traffic.performance(),
  resources: () => ({ ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 }),
  miniatureBlur: () => miniatureBlur.snapshot(),
  setMiniatureBlurBypass: value => miniatureBlur.setDebugBypass(value, debug),
  setMiniatureBlurSamples: value => miniatureBlur.setDebugAntialiasSamples(value, debug),
  setMiniatureBlurMask: value => miniatureBlur.setDebugBlurMask(value, debug),
  setMiniatureBlurFocusY: value => miniatureBlur.setDebugFocusY(value, debug),
  shadow: () => ({ ...shadowBounds, mapSize: sun.shadow.mapSize.toArray(), enabled: renderer.shadowMap.enabled }),
  trails: () => ({ visible: tracks.mesh.visible }),
  camera: () => ({ position: camera.position.toArray(), target: cameraMode === 'free' ? orbitControls.target.toArray() : cameraLookAt.toArray(), mode: cameraMode, scale: cameraDistanceScale, far: camera.far, fogNear: scene.fog.near, fogFar: scene.fog.far, orientation: camera.rotation.toArray(),
    projectCar: () => {
      const point = car.position.clone(); point.y += 0.8;
      const screen = point.project(camera);
      return { x: (screen.x + 1) / 2, y: (1 - screen.y) / 2, depth: screen.z };
    },
    projectAhead: (seconds = 2) => {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion).setY(0).normalize();
      const distance = sim.signedSpeed * Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, 4));
      const point = car.position.clone().addScaledVector(forward, distance); point.y = 0;
      const screen = point.project(camera);
      const nose = car.position.clone().addScaledVector(forward, 2.2).project(camera);
      const tail = car.position.clone().addScaledVector(forward, -2.2).project(camera);
      return { x: (screen.x + 1) / 2, y: (1 - screen.y) / 2, depth: screen.z,
        carLengthPx: Math.hypot((nose.x - tail.x) * innerWidth / 2, (nose.y - tail.y) * innerHeight / 2) };
    } }),
  telemetry: () => sim.telemetry(), get modelReady() { return modelReady; }, get tuning() { return { ...sim.tuning }; },
  damageEffects: () => damageEffects.snapshot(),
  buildingVisibility: () => buildingEntries.map(entry => ({ id: entry.id, bounds: entry.bounds, opacity: entry.opacity,
    proximity: Boolean(entry.nearCar), gap: entry.carGap, occluded: Boolean(entry.wasOccluded), proxy: Boolean(entry.proxy) })),
  city: () => ({ seed: cityPlan.seed, buildings: cityPlan.buildings.length, trees: cityState.trees.count, landmarks: cityPlan.landmarks.length, bounds: cityPlan.bounds, roadWidth: cityPlan.roadWidth, roads: cityPlan.roads, roadNetwork: cityPlan.roadNetwork, hasBuildingWindows: false,
    fadedBuildings: buildingEntries.filter(entry => entry.opacity < 0.999).length }),
  roadMarkings: () => cityState.roadMarkings(),
  worldBodies: () => sim.world.bodies.length,
  damageTest,
  joystick: () => ({ active: pointer.active, startX: pointer.startX, startY: pointer.startY, direction: driveDirection, ...joystickVector(pointer.startX, pointer.startY, pointer.x, pointer.y) }),
  donut: () => donutGesture.snapshot(),
  wheelTransforms: () => visualWheels.map(({ pivot }, i) => {
    const wheel = sim.wheels[i];
    const localOrientation = car.quaternion.clone().invert().multiply(pivot.quaternion);
    return { position: pivot.position.toArray(), radius: wheel.radius, front: wheel.front,
      steeringAngle: wheel.detached ? null : 2 * Math.atan2(localOrientation.y, localOrientation.w) };
  }),
  wheels: () => sim.wheels.map(wheel => ({ detached: wheel.detached, grounded: wheel.grounded })),
  traffic: () => traffic.states.filter(state => state.role === 'civilian').map(({ x, z, heading, speed }) => ({ x, z, heading, speed })),
  police: () => traffic.states.filter(state => state.role === 'police').map(({ id, x, z, heading, speed, ai }) => ({
    id, x, z, heading, speed, targetId: ai.targetId, state: ai.state, waitReason: ai.waitReason,
    pursuit: ai.roleState?.diagnostics?.() || null })),
  wanted: () => wanted.snapshot(),
  arrest: () => arrest.snapshot(),
  requestVehicleSpawn: input => traffic.requestSpawn(input),
  getSpawnRequest: requestId => traffic.spawnRequest(requestId),
  cancelVehicleSpawn: requestId => traffic.cancelSpawn(requestId),
  trafficClock: () => traffic.simulationTime(),
  trafficStatus: () => traffic.status(),
  trafficAI: () => traffic.debug().filter(state => state.role === 'civilian'),
  signals: () => ({ controlled: trafficSignals.controlled.size, approaches: cityState.signalApproaches.length,
    visible: cityState.signalApproaches.filter(approach => approach.signalVisible).length,
    phase: trafficSignals.phase('-25:-25', '-75:-25', traffic.simulationTime()) }),
  signalApproaches: () => cityState.signalApproaches.map(approach => ({ ...approach })),
  stopLines: () => cityState.signalApproaches.map(({ nodeId, fromId, forwardX, forwardZ, stopX, stopZ,
    stopDistance, stopLineLength, stopLineThickness }) => ({ nodeId, fromId, forwardX, forwardZ, x: stopX, z: stopZ,
    distance: stopDistance, length: stopLineLength, thickness: stopLineThickness })),
};
function applyQuality() {
  quality = settings.values.quality === 'Лёгкая' ? 'low' : 'high';
  metrics.quality = quality;
  miniatureBlur.setQuality(quality);
  const preset = artQuality(quality);
  renderer.setPixelRatio(Math.min(devicePixelRatio, preset.dpr));
  const size = preset.shadow;
  sun.shadow.mapSize.set(size, size);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  sun.shadow.needsUpdate = true;
  resize();
}
applyQuality();
window.addEventListener('pagehide', () => miniatureBlur.dispose(), { once: true });
