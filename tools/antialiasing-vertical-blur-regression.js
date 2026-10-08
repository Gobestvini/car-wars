import * as THREE from 'three';
import { createMiniatureBlur } from '../src/miniature-blur.js';
import { ART_LIGHT } from '../src/art-direction.js';

const width = 640, height = 480, dpr = 1;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(dpr);
renderer.setSize(width, height);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = ART_LIGHT.exposure;
const effect = createMiniatureBlur(renderer);
effect.setQuality('high');
effect.setStrength(1);
effect.setDebugFocusY(.5, true);
effect.resize(width, height, dpr);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
camera.position.z = 5;
camera.updateMatrixWorld();
const car = new THREE.Object3D();
car.position.y = -.553;
const frames = document.querySelector('#frames');
const output = document.querySelector('#results');

function pixels() {
  const gl = renderer.getContext();
  const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
}

function pixel(data, x, y) {
  const offset = (Math.round(y) * width + Math.round(x)) * 4;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function saveFrame(label) {
  const url = renderer.domElement.toDataURL('image/png');
  const image = document.createElement('img');
  image.src = url; image.width = width; image.alt = label;
  const link = document.createElement('a');
  link.href = url; link.download = `${label}.png`; link.textContent = `Скачать ${label}`;
  frames.append(link, image);
}

function render(scene, samples, strength = 1, maskEnabled = true) {
  effect.setDebugAntialiasSamples(samples, true);
  effect.setDebugBlurMask(maskEnabled, true);
  effect.setStrength(strength);
  effect.render(scene, camera, { car });
  return pixels();
}

function buildStripeScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b0b0b0');
  for (const x of [.12, .5, .88]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(.08, 2),
      new THREE.MeshBasicMaterial({ color: '#101010' }));
    stripe.position.set(x * 2 - 1, 0, 0);
    scene.add(stripe);
  }
  return scene;
}

function compareVerticalMask(scene, requestedSamples) {
  const sharp = render(scene, requestedSamples, 1, false);
  const blurred = render(scene, requestedSamples, 1, true);
  const edgeProbes = [.12, .5, .88].map(x => ({ x: x * width + 14, y: height * .5 }));
  const rowProbes = [.08, .5, .92];
  const rowSamples = rowProbes.map(y => edgeProbes.map(probe => {
    const before = pixel(sharp, probe.x, y * height);
    const after = pixel(blurred, probe.x, y * height);
    return { sharp: before, blurred: after,
      delta: Math.max(...before.map((channel, i) => Math.abs(channel - after[i]))) };
  }));
  const deltas = rowSamples.map(row => row.map(sample => sample.delta));
  const horizontalSpread = Math.max(...deltas.map(row => Math.max(...row) - Math.min(...row)));
  return { yTop: rowSamples[0], yCenter: rowSamples[1], yBottom: rowSamples[2], horizontalSpread };
}

function buildDiagonalScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eeeeee');
  const shape = new THREE.BufferGeometry();
  const a = [-.85, -.85, 0], b = [.85, .85, 0], c = [.85, -.85, 0];
  shape.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  shape.computeVertexNormals();
  scene.add(new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: '#121212', side: THREE.DoubleSide })));
  return scene;
}

function countIntermediateEdgePixels(data) {
  let intermediate = 0, edgePixels = 0;
  for (let step = 24; step <= 616; step++) {
    const centerX = step;
    const centerY = 36 + (step - 48) * (408 / 544);
    for (let delta = -3; delta <= 3; delta++) {
      const color = pixel(data, centerX + delta * .8, centerY - delta * 1.25);
      if (color[0] > 20 && color[0] < 220) intermediate++;
      edgePixels++;
    }
  }
  return { intermediate, edgePixels, coverage: intermediate / edgePixels };
}

try {
  const diagonal = buildDiagonalScene();
  const aaOff = render(diagonal, 0);
  saveFrame('diagonal-msaa-off');
  const requestedSamples = effect.snapshot().antialiasSamples > 0 ? effect.snapshot().antialiasSamples : 4;
  const aaOn = render(diagonal, requestedSamples);
  saveFrame('diagonal-msaa-on');
  const aliasing = { samples: effect.snapshot().antialiasSamples,
    off: countIntermediateEdgePixels(aaOff), on: countIntermediateEdgePixels(aaOn) };
  diagonal.clear();

  const stripes = buildStripeScene();
  const mask = compareVerticalMask(stripes, effect.snapshot().antialiasSamples);
  const report = { pass: aliasing.on.intermediate > aliasing.off.intermediate
      && mask.yCenter.every(sample => sample.delta === 0)
      && Math.max(...mask.yTop.map(sample => sample.delta)) > Math.max(...mask.yCenter.map(sample => sample.delta))
      && Math.max(...mask.yBottom.map(sample => sample.delta)) > Math.max(...mask.yCenter.map(sample => sample.delta))
      && mask.horizontalSpread <= 6,
    browser: navigator.userAgent,
    webgl: renderer.getContext().getParameter(renderer.getContext().VERSION),
    viewport: { width: innerWidth, height: innerHeight, dpr,
      drawingBuffer: [renderer.domElement.width, renderer.domElement.height] },
    aa: aliasing, mask, snapshot: effect.snapshot(),
    note: 'GPU fixture isolates a diagonal edge and repeated vertical edges; inspect screenshots and browser console.' };
  output.textContent = JSON.stringify(report, null, 2);
  const link = document.createElement('a');
  link.textContent = 'Скачать JSON'; link.download = 'antialiasing-vertical-blur-regression.json';
  link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  frames.prepend(link);
  if (!report.pass) output.textContent = `FAIL\n${output.textContent}`;
  effect.dispose();
  renderer.dispose();
} catch (error) {
  output.textContent = `FAIL: ${error.stack}`;
  effect.dispose();
  renderer.dispose();
  throw error;
}
