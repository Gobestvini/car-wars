import * as THREE from 'three';
import { segmentIntersectsAabb, vehicleSightTargets } from './building-occlusion.js';
import { createTreePlacements } from './tree-placement.js';
import { createSurfaceHeightSampler } from './road-surface.js';

const FOLIAGE = ['#559663', '#68a773', '#4d8b5a'];
const TRUNKS = ['#8f6248', '#a06d4c', '#916a50'];

/** Shared low-poly tree geometry, deterministic colors and two instanced draw batches. */
export function createCityTrees(group, plan, { damageObstacles = [], signals = [] } = {}) {
  const trees = createTreePlacements(plan, { damageObstacles, signals });
  const surfaceHeight = createSurfaceHeightSampler(plan, 0);
  const trunkGeometry = new THREE.CylinderGeometry(0.14, 0.2, 2.15, 5, 1);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 0);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length);
  trunks.name = 'Street tree trunks';
  crowns.name = 'Street tree crowns';
  trunks.castShadow = true;
  crowns.castShadow = true;
  trunks.receiveShadow = true;
  crowns.receiveShadow = true;
  trunks.frustumCulled = false;
  crowns.frustumCulled = false;

  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const originals = [];
  const hiddenUntil = new Float32Array(trees.length);

  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    const ground = surfaceHeight(tree.x, tree.z);
    const colorPick = tree.token % FOLIAGE.length;
    const trunkColorPick = (tree.token >>> 4) % TRUNKS.length;
    const treeHeight = 4.7 + ((tree.token >>> 16) % 1000) / 1000 * 0.9;
    const crownHeight = treeHeight - 0.45;
    const crownWidth = tree.radius;

    position.set(tree.x, ground + 1.075, tree.z);
    scale.set(1, 1, 1);
    matrix.compose(position, rotation, scale);
    trunks.setMatrixAt(i, matrix);
    trunks.setColorAt(i, new THREE.Color(TRUNKS[trunkColorPick]));

    position.set(tree.x, ground + crownHeight, tree.z);
    scale.set(crownWidth, Math.min(1.38, crownWidth * 1.07), crownWidth);
    matrix.compose(position, rotation, scale);
    crowns.setMatrixAt(i, matrix);
    crowns.setColorAt(i, new THREE.Color(FOLIAGE[colorPick]));

    const bounds = { min: { x: tree.x - crownWidth, y: ground + crownHeight - crownWidth,
      z: tree.z - crownWidth }, max: { x: tree.x + crownWidth, y: ground + crownHeight + crownWidth,
      z: tree.z + crownWidth } };
    originals.push({ tree, bounds, trunk: matrix.clone(), canopy: matrix.clone(), visible: true, boundsClear: 0 });
    position.y = ground + 1.075;
    matrix.compose(position, rotation, scale.set(1, 1, 1));
    originals[i].trunk.copy(matrix);
  }

  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();
  group.add(trunks, crowns);

  const updateVisibility = (camera, car, dt, cameraMode = 'follow') => {
    if (trees.length === 0) return;
    const targets = cameraMode === 'follow' && car ? vehicleSightTargets(THREE, camera, car) : null;
    let trunkChanged = false, crownChanged = false;
    for (let i = 0; i < originals.length; i++) {
      const item = originals[i];
      const occluded = targets?.some(target => segmentIntersectsAabb(camera.position, target, item.bounds)) ?? false;
      const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      if (occluded) item.boundsClear = 0;
      else item.boundsClear += elapsed;

      const shouldShow = !occluded && item.boundsClear >= 0.18;
      if (shouldShow === item.visible) continue;
      item.visible = shouldShow;
      matrix.copy(shouldShow ? item.trunk : new THREE.Matrix4().makeScale(0, 0, 0));
      trunks.setMatrixAt(i, matrix);
      matrix.copy(shouldShow ? item.canopy : new THREE.Matrix4().makeScale(0, 0, 0));
      crowns.setMatrixAt(i, matrix);
      trunkChanged = true;
      crownChanged = true;
    }
    if (trunkChanged) trunks.instanceMatrix.needsUpdate = true;
    if (crownChanged) crowns.instanceMatrix.needsUpdate = true;
  };

  return { count: trees.length, placements: trees, trunks, crowns, updateVisibility };
}
