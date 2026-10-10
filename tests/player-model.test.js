import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { preparePlayerModel, PLAYER_WHEEL_NAMES, offsetPlayerWheel } from '../src/player-model.js';
import { createPlayerLights } from '../src/player-lights.js';
import { CarDeformation } from '../src/car-deformation.js';
import { CarSimulation } from '../src/vehicle.js';

async function loadAsset() {
  const bytes = await readFile(new URL('../public/models/player-sedan.glb', import.meta.url));
  // Node has no browser image decoder. Validate the embedded texture declaration,
  // then parse the real geometry without fetching its PNG; browser QA decodes it.
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  assert.equal(json.images.length, 1);
  assert.equal(json.images[0].mimeType, 'image/png');
  assert.ok(json.materials[0].pbrMetallicRoughness.baseColorTexture);
  delete json.materials[0].pbrMetallicRoughness.baseColorTexture;
  const text = JSON.stringify(json);
  const padded = Buffer.from(text + ' '.repeat((4 - Buffer.byteLength(text) % 4) % 4));
  const binary = bytes.subarray(20 + length);
  const header = Buffer.alloc(20);
  bytes.copy(header,0,0,12);
  header.writeUInt32LE(20 + padded.length + binary.length,8);
  header.writeUInt32LE(padded.length,12);
  header.writeUInt32LE(0x4e4f534a,16);
  const stripped = Buffer.concat([header,padded,binary]);
  const data = stripped.buffer.slice(stripped.byteOffset,stripped.byteOffset+stripped.byteLength);
  const result = preparePlayerModel((await new GLTFLoader().parseAsync(data, '')).scene);
  result.body.material.map = new THREE.DataTexture(new Uint8Array(512*512*4),512,512);
  return result;
}

test('textured GLB fits simulation mounts and shares one atlas across five meshes', async () => {
  const { model, body, wheels } = await loadAsset();
  const sim = new CarSimulation();
  const meshes = [body, ...wheels];
  assert.equal(model.children.length, 5);
  assert.deepEqual(wheels.map(wheel => wheel.name), PLAYER_WHEEL_NAMES);
  assert.equal(new Set(meshes.map(mesh => mesh.material)).size, 1);
  let triangles = 0;
  for (const mesh of meshes) {
    assert.ok(!Array.isArray(mesh.material));
    assert.equal(mesh.material.map.image.width, 512);
    assert.equal(mesh.material.vertexColors, false);
    assert.equal(mesh.material.side, THREE.FrontSide);
    assert.ok(mesh.geometry.attributes.uv);
    assert.ok(mesh.geometry.attributes.normal.array.every(Number.isFinite));
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    assert.deepEqual(mesh.scale.toArray(), [1, 1, 1]);
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
  }
  assert.ok(triangles <= 2500, `Triangle budget: ${triangles}`);
  body.geometry.computeBoundingBox();
  const bounds = body.geometry.boundingBox;
  assert.ok(bounds.min.z >= -2.20 && bounds.max.z <= 2.20);
  assert.ok(bounds.max.y <= .90 && bounds.min.y >= -.48);
  assert.ok(bounds.max.x <= 1.06 && bounds.min.x >= -1.06);
  for (const [i, wheel] of wheels.entries()) {
    assert.ok(Math.abs(wheel.position.x - sim.wheels[i].mount.x) < 1e-5);
    assert.ok(Math.abs(wheel.position.z - sim.wheels[i].mount.z) < 1e-5);
    wheel.geometry.computeBoundingBox();
    const size = wheel.geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y / 2 - .36) < 1e-5);
    assert.ok(Math.abs(size.z / 2 - .36) < 1e-5);
    assert.ok(size.x <= .26);
    assert.ok(wheel.geometry.boundingBox.getCenter(new THREE.Vector3()).length() < 1e-5);
  }
});

test('authored body has local impact geometry and restores exact positions and normals', async () => {
  const { body, wheels } = await loadAsset();
  const geometry = body.geometry;
  const before = geometry.attributes.position.array.slice();
  const normals = geometry.attributes.normal.array.slice();
  const wheelBefore = wheels.map(wheel => wheel.geometry.attributes.position.array.slice());
  const deformation = new CarDeformation(geometry, body.matrixWorld, { preserveHardEdges: true });
  deformation.apply([{ point: { x: .6, y: .1, z: 2.07 }, normal: { x: 0, y: 0, z: -1 },
    impact: { depth: .22, radius: .8 } }]);
  assert.ok(geometry.attributes.position.array.some((value, i) => Math.abs(value - before[i]) > .01));
  assert.ok(geometry.attributes.position.array.every(Number.isFinite));
  for (const [i, wheel] of wheels.entries()) assert.deepEqual(wheel.geometry.attributes.position.array, wheelBefore[i]);
  deformation.restore();
  assert.deepEqual(geometry.attributes.position.array, before);
  assert.deepEqual(geometry.attributes.normal.array, normals);
});

test('reverse lamps track actual motion and reverse drive request; lens anchors survive dents', async () => {
  const { body } = await loadAsset();
  const lights = createPlayerLights(body);
  assert.ok(lights.snapshot().lensVertices.every(count => count > 0));
  for (const [input, expected] of [[{signedSpeed: 5,throttle:-1},false],
    [{signedSpeed:0,throttle:-1},true],[{signedSpeed:-2,throttle:0},true],
    [{signedSpeed:0,throttle:0},false]]) {
    lights.update(input);
    assert.equal(lights.snapshot().reverse,expected);
  }
  const before = lights.glow.geometry.attributes.position.array.slice();
  const deformation = new CarDeformation(body.geometry,body.matrixWorld,{preserveHardEdges:true});
  deformation.apply([{point:{x:.63,y:.075,z:2.10},normal:{x:0,y:0,z:-1},impact:{depth:.2,radius:.8}}]);
  lights.update();
  assert.ok(lights.glow.geometry.attributes.position.array.some((n,i)=>Math.abs(n-before[i])>.01));
  deformation.restore();lights.update();
  assert.deepEqual(lights.glow.geometry.attributes.position.array,before);
});

test('smaller visual tires retain ground contact and fit their arches at full steering/compression',async()=>{
  const {wheels}=await loadAsset();
  const sim=new CarSimulation();
  const car=new THREE.Group();
  const pivot=new THREE.Group();
  for(const localY of [-.68,-.4,-.14]) for(const angle of [-.475,0,.475]) {
    pivot.position.set(-.77,localY,1.15);pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),angle);
    offsetPlayerWheel(pivot,sim.wheels[0],car);
    pivot.updateMatrixWorld(true);
    const p=new THREE.Vector3();
    const positions=wheels[0].geometry.attributes.position;
    for(let i=0;i<positions.count;i++) {
      p.fromBufferAttribute(positions,i).applyMatrix4(pivot.matrixWorld);
      // Every tire vertex that could meet a body side lies inside the cutout
      // (16-sided radius .49 cutout has an inscribed radius > .48).
      if(p.y>-.44 && Math.abs(p.x)>.85) assert.ok(Math.hypot(p.z-1.15,p.y+.54)<.48);
    }
  }
  car.position.y=.9;pivot.position.set(-.77,.45,1.15);
  offsetPlayerWheel(pivot,sim.wheels[0],car);
  assert.ok(Math.abs(pivot.position.y-.36)<1e-6);
});
