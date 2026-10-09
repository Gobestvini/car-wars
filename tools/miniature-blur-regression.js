import * as THREE from 'three';
import { createMiniatureBlur } from '../src/miniature-blur.js';
import { ART, ART_LIGHT } from '../src/art-direction.js';
import { createCityPlan } from '../src/city-generator.js';
import { createCityScene } from '../src/city-scene.js';

// Run in the actual browser GPU; Node tests cannot exercise shader output conversion.
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = ART_LIGHT.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const effect = createMiniatureBlur(renderer);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, .1, 20);
camera.position.z = 10;
const car = new THREE.Object3D();
car.position.set(0, 0, 0);
const swatches = [ART.asphalt, ART.sidewalk, ...ART.facades, ART.player, ART.roof];
swatches.forEach((color, index) => {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2),
    new THREE.MeshBasicMaterial({ color }));
  plane.position.set((index - 3) * 1.15, 0, 0);
  scene.add(plane);
});
function pixels() {
  const gl = renderer.getContext();
  const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
}
function compare(reference, actual, width, height) {
  let maxDelta = 0, count = 0;
  // All seven swatches, well inside the sharp ellipse, away from geometric edges.
  for (let x = Math.floor(width * .19); x < width * .81; x++) {
    for (let y = Math.floor(height * .46); y < height * .54; y++) {
      // Exclude swatch boundaries: compare color interiors, not raster coverage.
      const offset = (y * width + x) * 4;
      if (reference[offset] === 0 || [-2, -1, 1, 2].some(dx =>
        [0, 1, 2].some(c => reference[offset + dx * 4 + c] !== reference[offset + c]))) continue;
      for (let c = 0; c < 3; c++) {
        maxDelta = Math.max(maxDelta, Math.abs(reference[(y * width + x) * 4 + c] - actual[(y * width + x) * 4 + c]));
      }
      count++;
    }
  }
  return { maxDelta, sampledPixels: count };
}
function saveFrame(label) {
  const url = renderer.domElement.toDataURL('image/png');
  const image = document.createElement('img'); image.src = url; image.width = 640; image.alt = label;
  const bytes = Uint8Array.from(atob(url.split(',')[1]), char => char.charCodeAt(0));
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  link.download = `${label}.png`; link.textContent = label;
  const container = document.getElementById('frames');
  container.append(link, document.createElement('br'), image, document.createElement('br'));
}
function rowContrast(data, width, height, normalizedY) {
  const y = Math.round((1 - normalizedY) * (height - 1));
  const values = [];
  for (let x = Math.floor(width * .1); x < width * .9; x++) {
    const index = (y * width + x) * 4;
    values.push((data[index] + data[index + 1] + data[index + 2]) / 3);
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}
try {
  const results = [];
  for (const [width, height, dpr] of [[640, 360, 1], [390, 844, 1.75], [844, 390, 1.75]]) {
    renderer.setPixelRatio(dpr); renderer.setSize(width, height);
    camera.updateMatrixWorld(); effect.resize(width, height, dpr);
    renderer.render(scene, camera); const reference = pixels();
    for (const quality of ['low', 'high']) for (const strength of [0, 1, 2]) {
      effect.setQuality(quality); effect.setStrength(strength); effect.render(scene, camera, { car });
      const gl = renderer.getContext();
      results.push({ width, height, dpr, quality, strength,
        ...compare(reference, pixels(), gl.drawingBufferWidth, gl.drawingBufferHeight), ...effect.snapshot() });
    }
  }
  scene.clear();
  const frequencyCamera = new THREE.OrthographicCamera(-5, 5, 3, -3, .1, 20);
  frequencyCamera.position.z = 10; frequencyCamera.updateMatrixWorld();
  scene.background = new THREE.Color('#999999');
  const stripeMaterial = [new THREE.MeshBasicMaterial({ color: '#111111' }),
    new THREE.MeshBasicMaterial({ color: '#eeeeee' })];
  for (let index = 0; index < 60; index++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(.085, 6), stripeMaterial[index % 2]);
    stripe.position.x = -4.95 + index * .17; scene.add(stripe);
  }
  renderer.setPixelRatio(1); renderer.setSize(640, 360);
  effect.setQuality('high'); effect.setStrength(1); effect.resize(640, 360, 1);
  renderer.render(scene, frequencyCamera); const sharpFrequency = pixels();
  effect.setDebugBlurMask(true, true); effect.render(scene, frequencyCamera, { car });
  const blurredFrequency = pixels();
  const frequencyContrast = [.06, .5, .94].map(y => ({
    y, sharp: rowContrast(sharpFrequency, 640, 360, y), blurred: rowContrast(blurredFrequency, 640, 360, y),
  }));
  effect.setDebugBlurMask(true, false);
  for (const mesh of scene.children) { mesh.geometry?.dispose(); }
  for (const material of stripeMaterial) material.dispose();
  // A representative static city rendered twice with identical scene/camera/light.
  scene.clear();
  const plan = createCityPlan();
  const city = createCityScene(scene, { addStaticBox: spec => spec, removeStaticBox() {} }, plan);
  scene.background = new THREE.Color(ART.fog);
  scene.add(new THREE.HemisphereLight(ART_LIGHT.sky, ART_LIGHT.ground, ART_LIGHT.ambient));
  const sun = new THREE.DirectionalLight(ART_LIGHT.sun, ART_LIGHT.intensity); sun.position.set(-14, 24, 10); scene.add(sun);
  const view = new THREE.PerspectiveCamera(50, 16 / 9, .1, 600);
  view.position.set(42, 48, -55); view.lookAt(0, 0, 0); view.updateMatrixWorld();
  car.position.set(0, .5, 0); car.quaternion.identity();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 4), new THREE.MeshStandardMaterial({ color: ART.player }));
  body.position.copy(car.position); scene.add(body);
  renderer.setPixelRatio(1); renderer.setSize(1280, 720); effect.resize(1280, 720, 1); effect.setQuality('high');
  effect.setStrength(0); effect.render(scene, view, { car }); saveFrame('city-direct');
  effect.setStrength(1); effect.render(scene, view, { car }); saveFrame('city-blur');
  const warmMemory = { ...renderer.info.memory, programs: renderer.info.programs.length };
  for (let i = 0; i < 10; i++) {
    renderer.setSize(640 + i % 2, 360); effect.resize(640 + i % 2, 360, 1);
    effect.setQuality(i % 2 ? 'high' : 'low'); effect.setStrength(i % 3);
    effect.render(scene, view, { car });
  }
  effect.setStrength(1); effect.render(scene, view, { car });
  const treeTriangles = [city.trees.trunks, ...city.trees.crownBatches].reduce((sum, mesh) =>
    sum + mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
  const frequencyPass = frequencyContrast[1].blurred > frequencyContrast[0].blurred * 1.5
    && frequencyContrast[1].blurred > frequencyContrast[2].blurred * 1.5;
  const report = { pass: results.every(row => row.enabled && !row.failure && row.maxDelta <= 2) && frequencyPass,
    frequencyPass, frequencyContrast, results,
    trees: city.trees.count, treeTriangles, warmMemory,
    afterCycles: { ...renderer.info.memory, programs: renderer.info.programs.length },
    note: 'Desktop WebGL regression; no physical-phone timing claim.' };
  document.getElementById('results').textContent = JSON.stringify(report, null, 2);
  const reportLink = document.createElement('a'); reportLink.textContent = 'Скачать отчёт'; reportLink.download = 'blur-color-regression.json';
  reportLink.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  document.getElementById('frames').prepend(reportLink);
  effect.dispose(); city.dispose(); renderer.dispose();
} catch (error) {
  document.getElementById('results').textContent = `FAIL: ${error.stack}`;
  throw error;
}
