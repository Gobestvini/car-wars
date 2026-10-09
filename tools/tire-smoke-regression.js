import * as THREE from 'three';
import { TireSmoke } from '../src/tire-smoke.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(960, 540);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#99b5c9');
const camera = new THREE.PerspectiveCamera(42, 16 / 9, .1, 100);
camera.position.set(0, 7, 12); camera.lookAt(0, .5, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x78869a, 1.7));
const sun = new THREE.DirectionalLight(0xffeed5, 2.1); sun.position.set(-4, 9, 5); scene.add(sun);
const road = new THREE.Mesh(new THREE.PlaneGeometry(24, 18),
  new THREE.MeshStandardMaterial({ color: '#58677a', roughness: .98 }));
road.rotation.x = -Math.PI / 2; road.position.y = -.02; scene.add(road);
const car = new THREE.Mesh(new THREE.BoxGeometry(2, .8, 4),
  new THREE.MeshStandardMaterial({ color: '#ffc34a', roughness: .72 }));
car.position.y = .4; scene.add(car);
const smoke = new TireSmoke(scene);
const wheels = [-1, 1].flatMap(x => [-1, 1].map(z => ({ grounded: true, detached: false,
  longitudinal: 18, lateral: 12, contact: { x, y: .12, z: z * 1.5 } })));
const result = document.querySelector('#result');
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
  smoke.sample([{ id: 'player', role: 'player', wheels, x: 0, z: 0 }], dt,
    { quality: 'high', cameraPosition: camera.position });
  const stats = smoke.update(dt, camera, { quality: 'high' });
  renderer.render(scene, camera);
  result.textContent = JSON.stringify({ active: stats.active, capacity: stats.capacity,
    emitted: stats.emitted, maxAlpha: Math.max(...smoke.alpha.array),
    materialOpacity: smoke.material.opacity, depthWrite: smoke.material.depthWrite,
    drawCalls: renderer.info.render.calls }, null, 2);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
