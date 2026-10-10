// Deterministic WebGL scene made from production modules. No simulation clocks or random traffic.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCityPlan } from '../src/city-generator.js';
import { createCityScene } from '../src/city-scene.js';
import { createSurfaceHeightSampler } from '../src/road-surface.js';
import { TireTracks } from '../src/tire-tracks.js';
import { ART, ART_LIGHT } from '../src/art-direction.js';
import { createTrafficSignals } from '../src/traffic-signals.js';
import { updateShadowCoverage } from '../src/shadow-coverage.js';
import { createMiniatureBlur } from '../src/miniature-blur.js';
import { preparePlayerModel } from '../src/player-model.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = ART_LIGHT.exposure;
document.body.append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(ART.fog);
scene.add(new THREE.HemisphereLight(ART_LIGHT.sky, ART_LIGHT.ground, ART_LIGHT.ambient));
const sun = new THREE.DirectionalLight(ART_LIGHT.sun, ART_LIGHT.intensity);
sun.castShadow = true; sun.shadow.bias = -.0008; sun.shadow.normalBias = .03; scene.add(sun, sun.target);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .1, 400);
const car = preparePlayerModel((await new GLTFLoader().loadAsync('/models/player-sedan.glb')).scene).model;
car.position.set(-78, .96, -65); car.rotation.y = -.4; scene.add(car);
const plan = createCityPlan();
const simulation = { addStaticBox: s => s, addStaticConvex: s => s, removeStaticBox() {} };
let city = createCityScene(scene, simulation, plan);
const signals = createTrafficSignals(plan.roadNetwork);
const tracks = new TireTracks(scene, 6000, { surfaceHeight: createSurfaceHeightSampler(plan) });
const blur = createMiniatureBlur(renderer);
const f = window.fixture = { THREE, renderer, scene, camera, sun, car, plan, tracks, blur, city };
f.pose = (target = [-73, 0, -68], offset = [45, 60, -48]) => {
  camera.position.fromArray(target).add(new THREE.Vector3(...offset)); camera.lookAt(...target); camera.updateMatrixWorld();
  sun.target.position.fromArray(target);
  sun.position.copy(sun.target.position).add(new THREE.Vector3(...(ART_LIGHT.offset || [-14, 24, 10])));
  sun.target.updateMatrixWorld();
};
f.draw = (quality = 'high', strength = 0) => {
  const size = quality === 'low' ? 512 : 1024;
  if (sun.shadow.mapSize.x !== size) { sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(size, size); }
  city.updateSignals(signals, 0, camera, quality);
  updateShadowCoverage(sun, camera, { resolution: size, casterHeight: 24 });
  tracks.prepareRender();
  blur.setQuality(quality); blur.resize(innerWidth, innerHeight, 1); blur.setStrength(strength); blur.setFocusSize(58);
  blur.render(scene, camera, { mode: 'follow', car });
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    resources: { ...renderer.info.memory, programs: renderer.info.programs.length },
    props: city.streetProps?.counts, camera: camera.position.toArray(), target: sun.target.position.toArray() };
};
f.project = (x, y, z) => {
  const p = new THREE.Vector3(x, y, z).project(camera);
  return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
};
f.rebuild = () => { city.dispose(); city = createCityScene(scene, simulation, plan); f.city = city; tracks.setSurfaceHeightSampler(createSurfaceHeightSampler(plan)); };
f.markingTracks = () => {
  tracks.reset();
  const mark = city.marks.find(m => m.axis === 'z' && m.z > 0 && m.x === -25);
  const stop = city.signalApproaches.find(a => a.forwardZ === 1 && a.nodeId === '-25:-25');
  const markX = city.marks.find(m => m.axis === 'x' && m.x > 0 && m.z === -25);
  const stopX = city.signalApproaches.find(a => a.forwardX === 1 && a.nodeId === '-25:-25');
  const strip = (id, x, z, dx, dz, span) => {
    for (let i = 0; i <= 120; i++) {
      const wheels = [{ grounded: true, longitudinal: 15, lateral: 9, position: { x: x + dx * (i / 120 - .5) * span, z: z + dz * (i / 120 - .5) * span } }];
      tracks.updateVehicles([{ id, wheels }], true, 1 / 60);
    }
  };
  strip('player', mark.x, mark.z, 1, 0, 10);
  strip('police-1', stop.stopX, stop.stopZ, 0, 1, 8);
  strip('player', markX.x, markX.z, 0, 1, 10);
  strip('police-2', stopX.stopX, stopX.stopZ, 1, 0, 8);
  tracks.prepareRender();
  return { dash: { x: mark.x, z: mark.z }, stop: { x: stop.stopX, z: stop.stopZ },
    dashX: {x:markX.x,z:markX.z}, stopX:{x:stopX.stopX,z:stopX.stopZ},segments: tracks.count };
};
f.pose(); f.draw(); window.fixtureReady = true;
