import * as THREE from 'three';
import { segmentIntersectsAabb, vehicleSightTargets } from './building-occlusion.js';
import { createTreePlacements } from './tree-placement.js';
import { createSurfaceHeightSampler } from './road-surface.js';

const FOLIAGE = ['#559663', '#68a773', '#4d8b5a'];
const TRUNKS = ['#8f6248', '#a06d4c', '#916a50'];

/** Three canopy silhouettes and one trunk batch; no mesh, material or collider per tree. */
export function createCityTrees(group, plan, { damageObstacles = [], signals = [] } = {}) {
  const trees = createTreePlacements(plan, { damageObstacles, signals });
  const surfaceHeight = createSurfaceHeightSampler(plan, 0);
  const trunkGeometry = new THREE.CylinderGeometry(0.14, 0.2, 1, 5, 1);
  const crownGeometries = [new THREE.IcosahedronGeometry(1, 0),
    new THREE.DodecahedronGeometry(1, 0), new THREE.ConeGeometry(1, 2, 6, 1)];
  for (const geometry of crownGeometries) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    geometry.scale(1, 2 / (box.max.y - box.min.y), 1);
    geometry.computeBoundingBox();
  }
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
  const crownBatches = crownGeometries.map((geometry, type) => {
    const batch = new THREE.InstancedMesh(geometry, crownMaterial, trees.filter(tree => tree.crownType === type).length);
    batch.name = `Street tree crowns ${['rounded', 'oval', 'pointed'][type]}`;
    batch.castShadow = true;
    batch.receiveShadow = true;
    return batch;
  });
  trunks.name = 'Street tree trunks';
  trunks.castShadow = true;
  trunks.receiveShadow = true;

  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const originals = [];
  const crownIndices = [0, 0, 0];

  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    const ground = surfaceHeight(tree.x, tree.z);
    const colorPick = tree.token % FOLIAGE.length;
    const trunkColorPick = (tree.token >>> 4) % TRUNKS.length;
    const variation = (tree.token >>> 16) / 65535;
    const halfHeight = tree.radius * [1.05, 1.65, 1.9][tree.crownType] * (0.85 + variation * 0.3);
    const crownBottom = ground + 1.25 + ((tree.token >>> 8) & 255) / 255 * 0.65;
    const crownCenter = crownBottom + halfHeight;
    // Extend inside the canopy at its central cross-section, rather than stopping below it.
    const trunkHeight = crownCenter - ground + halfHeight * 0.08;
    const trunkWidth = 0.75 + (tree.token & 255) / 255 * 0.25;
    const batch = crownBatches[tree.crownType];
    tree.crownIndex = crownIndices[tree.crownType]++;

    position.set(tree.x, ground + trunkHeight / 2, tree.z);
    rotation.identity();
    scale.set(trunkWidth, trunkHeight, trunkWidth);
    matrix.compose(position, rotation, scale);
    trunks.setMatrixAt(i, matrix);
    trunks.setColorAt(i, new THREE.Color(TRUNKS[trunkColorPick]));
    const trunk = matrix.clone();

    position.set(tree.x, crownCenter, tree.z);
    rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, variation * Math.PI * 2);
    scale.set(tree.radius, halfHeight, tree.radius * (0.76 + variation * 0.24));
    matrix.compose(position, rotation, scale);
    batch.setMatrixAt(tree.crownIndex, matrix);
    batch.setColorAt(tree.crownIndex, new THREE.Color(FOLIAGE[colorPick]).multiplyScalar(0.92 + variation * 0.16));

    const bounds = { min: { x: tree.x - tree.radius, y: crownBottom, z: tree.z - tree.radius },
      max: { x: tree.x + tree.radius, y: crownBottom + halfHeight * 2, z: tree.z + tree.radius } };
    originals.push({ tree, bounds, trunk, canopy: matrix.clone(), batch, visible: true, boundsClear: 0 });
  }

  trunks.instanceMatrix.needsUpdate = true;
  trunks.computeBoundingSphere();
  for (const batch of crownBatches) {
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingSphere();
  }
  group.add(trunks, ...crownBatches);

  const updateVisibility = (camera, car, dt, cameraMode = 'follow') => {
    if (trees.length === 0) return;
    const targets = cameraMode === 'follow' && car ? vehicleSightTargets(THREE, camera, car) : null;
    let trunkChanged = false;
    const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    // Reject trees outside the entire sight-ray corridor before testing individual rays.
    let minX = camera.position.x, maxX = minX, minZ = camera.position.z, maxZ = minZ;
    for (const target of targets || []) {
      minX = Math.min(minX, target.x); maxX = Math.max(maxX, target.x);
      minZ = Math.min(minZ, target.z); maxZ = Math.max(maxZ, target.z);
    }
    for (let i = 0; i < originals.length; i++) {
      const item = originals[i];
      const inCorridor = item.bounds.min.x <= maxX && item.bounds.max.x >= minX
        && item.bounds.min.z <= maxZ && item.bounds.max.z >= minZ;
      const occluded = inCorridor && (targets?.some(target => segmentIntersectsAabb(camera.position, target, item.bounds)) ?? false);
      if (occluded) item.boundsClear = 0;
      else item.boundsClear += elapsed;

      const shouldShow = !targets || (!occluded && (item.visible || item.boundsClear >= 0.18));
      if (shouldShow === item.visible) continue;
      item.visible = shouldShow;
      matrix.copy(shouldShow ? item.trunk : hiddenMatrix);
      trunks.setMatrixAt(i, matrix);
      matrix.copy(shouldShow ? item.canopy : hiddenMatrix);
      item.batch.setMatrixAt(item.tree.crownIndex, matrix);
      item.batch.instanceMatrix.needsUpdate = true;
      trunkChanged = true;
    }
    if (trunkChanged) trunks.instanceMatrix.needsUpdate = true;
  };

  return { count: trees.length, placements: trees, trunks, crownBatches, updateVisibility };
}
