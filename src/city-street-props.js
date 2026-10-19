import * as THREE from 'three';
import { createStreetPropPlacements } from './street-prop-placement.js';
import { createSurfaceHeightSampler } from './road-surface.js';
import { PROP_PHYSICS } from './street-prop-config.js';

/** Hide only the broken slots; fade independent proxies at their original size. */
export function createPropInstanceVisual(parts, source, fadePool) {
  const owner = { id: source.id };
  const original = parts.map(({batch,index}) => {
    const matrix = new THREE.Matrix4(); batch.getMatrixAt(index,matrix);
    return { batch,index,matrix };
  });
  const position = new THREE.Vector3(source.x,source.y+PROP_PHYSICS[source.type].height/2,source.z);
  const rotation = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP,source.yaw);
  const scale = new THREE.Vector3(1,1,1);
  const inverse = new THREE.Matrix4().compose(position,rotation,scale).invert();
  const delta = new THREE.Matrix4(), result = new THREE.Matrix4();
  const write = transform => {
    for (const part of original) {
      result.multiplyMatrices(transform,part.matrix);
      part.batch.setMatrixAt(part.index,result);
      part.batch.instanceMatrix.needsUpdate = true;
      part.batch.boundingSphere = null;
    }
  };
  return {
    sync(body, alpha) {
      write(delta.makeScale(0,0,0));
      position.copy(body.position); rotation.copy(body.quaternion); scale.setScalar(1);
      delta.compose(position,rotation,scale).multiply(inverse);
      fadePool.sync(owner,original,delta,alpha);
    },
    hide() { fadePool.release(owner);write(delta.makeScale(0,0,0)); },
    restore() { fadePool.release(owner);write(delta.identity()); },
  };
}

/** Shared procedural part batches; local origins sit on the sidewalk. */
export function createCityStreetProps(group, plan, exclusions) {
  const placements = createStreetPropPlacements(plan, exclusions);
  const surface = createSurfaceHeightSampler(plan, 0);
  const metal = new THREE.MeshStandardMaterial({ color: '#364960', roughness: .65, metalness: .25 });
  const lens = new THREE.MeshStandardMaterial({ color: '#fff0cd', roughness: .4, emissive: '#ffe1a1', emissiveIntensity: .12 });
  const green = new THREE.MeshStandardMaterial({ color: '#497c6b', roughness: .8, metalness: .12, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: '#17232b', roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: '#bd8b53', roughness: .9 });
  const ring = new THREE.TorusGeometry(.32, .06, 4, 8).rotateX(Math.PI / 2);
  const parts = [
    ['lamp', 'base', new THREE.CylinderGeometry(.18,.23,.18,6), metal, [0,.09,0]],
    ['lamp', 'pole', new THREE.CylinderGeometry(.065,.10,3.5,6), metal, [0,1.93,0]],
    ['lamp', 'arm', new THREE.BoxGeometry(.14,.14,.7), metal, [0,3.65,.35]],
    ['lamp', 'housing', new THREE.BoxGeometry(.42,.24,.5), metal, [0,3.7,.67]],
    ['lamp', 'lens', new THREE.BoxGeometry(.32,.025,.4), lens, [0,3.57,.67]],
    ['bin', 'body', new THREE.CylinderGeometry(.32,.28,.72,8,1,true), green, [0,.36,0]],
    ['bin', 'rim', ring, green, [0,.78,0]],
    ['bin', 'opening', new THREE.CylinderGeometry(.305,.305,.025,8), dark, [0,.64,0]],
    ...[-.22,0,.22].map((z,i) => ['bench', `seat-${i}`, new THREE.BoxGeometry(1.8,.08,.2), wood, [0,.45,z]]),
    ...[.58,.75,.91].map((y,i) => ['bench', `back-${i}`, new THREE.BoxGeometry(1.8,.08,.08), wood, [0,y,-.285]]),
    ...[-.65,.65].flatMap((x,i) => [
      ['bench', `leg-${i}`, new THREE.BoxGeometry(.11,.41,.54), metal, [x,.205,0]],
      ['bench', `upright-${i}`, new THREE.BoxGeometry(.08,.5,.08), metal, [x,.7,-.285]],
    ]),
  ];
  const counts = Object.fromEntries(['lamp','bin','bench'].map(type => [type,placements.filter(p=>p.type===type).length]));
  const matrix = new THREE.Matrix4(), pose = new THREE.Matrix4(), local = new THREE.Matrix4();
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1,1,1);
  const batches = parts.map(([type, part, geometry, material, offset]) => {
    const batch = new THREE.InstancedMesh(geometry, material, counts[type]);
    batch.name = `Street ${type} ${part}`; batch.castShadow = part !== 'lens' && part !== 'opening'; batch.receiveShadow = true;
    batch.userData.propType = type;
    local.makeTranslation(...offset);
    placements.filter(p=>p.type===type).forEach((p, index) => {
      position.set(p.x, surface(p.x,p.z), p.z); rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
      pose.compose(position, rotation, scale); matrix.multiplyMatrices(pose, local); batch.setMatrixAt(index,matrix);
    });
    batch.instanceMatrix.needsUpdate = true; batch.computeBoundingSphere(); group.add(batch); return batch;
  });
  return { counts, placements, batches };
}
