import * as THREE from 'three';
import { createStreetPropPlacements } from './street-prop-placement.js';
import { createSurfaceHeightSampler } from './road-surface.js';

/** Eight shared part batches, no textures, lights, colliders or per-frame work. */
export function createCityStreetProps(group, plan, exclusions) {
  const placements = createStreetPropPlacements(plan, exclusions);
  const surface = createSurfaceHeightSampler(plan, 0);
  const metal = new THREE.MeshStandardMaterial({ color: '#364960', roughness: .65, metalness: .25 });
  const lens = new THREE.MeshStandardMaterial({ color: '#fff0cd', roughness: .4, emissive: '#ffe1a1', emissiveIntensity: .12 });
  const green = new THREE.MeshStandardMaterial({ color: '#497c6b', roughness: .8, metalness: .12, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: '#17232b', roughness: 1 });
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
  ];
  const counts = { lamp: placements.filter(p=>p.type==='lamp').length, bin: placements.filter(p=>p.type==='bin').length };
  const matrix = new THREE.Matrix4(), pose = new THREE.Matrix4(), local = new THREE.Matrix4();
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1,1,1);
  const batches = parts.map(([type, part, geometry, material, offset]) => {
    const batch = new THREE.InstancedMesh(geometry, material, counts[type]);
    batch.name = `Street ${type} ${part}`; batch.castShadow = part !== 'lens' && part !== 'opening'; batch.receiveShadow = true;
    local.makeTranslation(...offset);
    placements.filter(p=>p.type===type).forEach((p, index) => {
      position.set(p.x, surface(p.x,p.z), p.z); rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
      pose.compose(position, rotation, scale); matrix.multiplyMatrices(pose, local); batch.setMatrixAt(index,matrix);
    });
    batch.instanceMatrix.needsUpdate = true; batch.computeBoundingSphere(); group.add(batch); return batch;
  });
  return { counts, placements, batches };
}
