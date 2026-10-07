import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const BUILDING_FADE = Object.freeze({ minimum: .22 });

export function smoothBuildingOpacity(current, target, dt) {
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / (target < current ? .18 : .3)));
}

export function segmentIntersectsAabb(start, end, bounds) {
  let minimum = 0;
  let maximum = 1;
  for (const axis of ['x', 'y', 'z']) {
    const origin = start[axis];
    const delta = end[axis] - origin;
    if (Math.abs(delta) < 1e-9) {
      if (origin < bounds.min[axis] || origin > bounds.max[axis]) return false;
      continue;
    }
    let near = (bounds.min[axis] - origin) / delta;
    let far = (bounds.max[axis] - origin) / delta;
    if (near > far) [near, far] = [far, near];
    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);
    if (minimum > maximum) return false;
  }
  return maximum > 1e-4 && minimum < 1 - 1e-4;
}

export function occludedBuildingIds(buildings, camera, targets) {
  const result = new Set();
  for (const building of buildings) {
    if (targets.some(target => segmentIntersectsAabb(camera, target, building.bounds))) result.add(building.id);
  }
  return result;
}

/** Keep the opaque instances as one draw call; spawn a transparent proxy only while fading. */
export class BuildingOcclusion {
  constructor(THREE, scene, instanced, geometry, entries) {
    this.THREE = THREE;
    this.scene = scene;
    this.instanced = instanced;
    this.geometry = geometry;
    this.entries = entries;
    this.matrix = new THREE.Matrix4();
    this.position = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.right = new THREE.Vector3();
    this.forward = new THREE.Vector3();
  }

  setInstanceVisible(entry, visible) {
    this.position.set(entry.x, entry.height / 2, entry.z);
    this.scale.set(entry.width, entry.height, entry.depth);
    if (!visible) this.scale.setScalar(0);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.instanced.setMatrixAt(entry.index, this.matrix);
    this.instanced.instanceMatrix.needsUpdate = true;
  }

  startProxy(entry, caps) {
    const group = new this.THREE.Group();
    group.position.set(entry.x, 0, entry.z);
    const material = new this.THREE.MeshStandardMaterial({ color: entry.color, roughness: 0.88, transparent: true, opacity: 1, depthWrite: false });
    const mesh = new this.THREE.Mesh(this.geometry, material);
    mesh.scale.set(entry.width, entry.height, entry.depth);
    mesh.position.y = entry.height / 2;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    for (const cap of caps) {
      const proxyCap = cap.clone();
      proxyCap.material = cap.material.clone();
      proxyCap.position.sub(group.position);
      proxyCap.material.transparent = true; proxyCap.material.depthWrite = false;
      group.add(proxyCap);
    }
    entry.art?.hide();
    entry.art?.proxy(group);
    // Resolve the whole building's outer surface before alpha blending any part.
    // Identical opacity alone compounds at overlapping plinths/cornices/roofs.
    const surfaces = group.children.slice();
    // Bake once so the color and depth passes use exactly the same Float32 vertices.
    // Separate GPU scale transforms can otherwise disagree at roof/trim edges.
    for (const surface of surfaces) {
      surface.updateMatrix();
      surface.geometry = surface.geometry.clone().applyMatrix4(surface.matrix);
      surface.position.set(0, 0, 0); surface.quaternion.identity(); surface.scale.setScalar(1);
      surface.userData.buildingSurface = true;
    }
    const depthMaterial = new this.THREE.MeshDepthMaterial({ colorWrite: false, depthWrite: true, transparent: true });
    const depthMesh = new this.THREE.Mesh(new this.THREE.BufferGeometry(), depthMaterial);
    depthMesh.name = 'Whole building depth'; depthMesh.renderOrder = 1;
    depthMesh.userData.buildingDepth = true;
    group.userData.rebuildDepth = () => {
      const parts = surfaces.filter(mesh => mesh.visible).map(mesh => {
        mesh.updateMatrix();
        return mesh.geometry.clone().applyMatrix4(mesh.matrix);
      });
      const combined = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      depthMesh.geometry.dispose(); depthMesh.geometry = combined;
    };
    group.userData.rebuildDepth();
    for (const surface of surfaces) {
      surface.renderOrder = 2;
      surface.material.depthFunc = this.THREE.EqualDepth;
    }
    group.add(depthMesh);
    this.scene.add(group);
    entry.proxy = group;
    entry.proxyMaterial = material;
    for (const cap of caps) cap.visible = false;
    this.setInstanceVisible(entry, false);
  }

  finishProxy(entry, caps) {
    this.scene.remove(entry.proxy);
    const materials = new Set();
    entry.proxy.traverse(node => {
      if (!node.isMesh) return;
      materials.add(node.material);
      if (node.userData.buildingDepth || node.userData.buildingSurface) node.geometry.dispose();
    });
    for (const material of materials) material.dispose();
    entry.proxy = null; entry.proxyMaterial = null;
    for (const cap of caps) cap.visible = true;
    entry.art?.restore();
    this.setInstanceVisible(entry, true);
    entry.opacity = 1;
  }

  update(camera, car, dt) {
    const right = this.right.set(1, 0, 0).applyQuaternion(car.quaternion);
    const forward = this.forward.set(0, 0, 1).applyQuaternion(car.quaternion);
    const center = { x: car.position.x, y: car.position.y + .48, z: car.position.z };
    const targets = [center];
    for (const [side, nose] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      targets.push({ x: center.x + right.x * side * .64 + forward.x * nose * 1.65,
        y: center.y, z: center.z + right.z * side * .64 + forward.z * nose * 1.65 });
    }
    // Include the footprint corners so partial occlusion of the 4.45m body counts too.
    for (const side of [-1, 1]) for (const nose of [-1, 1]) {
      targets.push({ x: center.x + right.x * side * .9 + forward.x * nose * 2.225,
        y: center.y, z: center.z + right.z * side * .9 + forward.z * nose * 2.225 });
    }
    const cameraPoint = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const blocked = occludedBuildingIds(this.entries, cameraPoint, targets);
    for (const entry of this.entries) {
      const hit = blocked.has(entry.id);
      if (hit) { entry.clearTime = 0; entry.wasOccluded = true; }
      else if (entry.wasOccluded) {
        entry.clearTime += Math.max(0, dt);
        if (entry.clearTime >= .12) entry.wasOccluded = false;
      }
      const target = hit || entry.wasOccluded ? BUILDING_FADE.minimum : 1;
      const hidden = target < 1;
      if (hidden && !entry.proxy) this.startProxy(entry, entry.caps);
      if (!entry.proxy && !hidden) continue;
      entry.opacity = smoothBuildingOpacity(entry.opacity, target, dt);
      if (entry.proxyMaterial) {
        entry.proxyMaterial.opacity = entry.opacity;
        entry.proxy.children.slice(1).forEach(child => { child.material.opacity = entry.opacity; });
      }
      if (!hidden && entry.opacity > .995) this.finishProxy(entry, entry.caps);
    }
  }

  dispose() {
    for (const entry of this.entries) {
      if (!entry.proxy) continue;
      this.scene.remove(entry.proxy);
      const materials = new Set();
      entry.proxy.traverse(node => {
        if (!node.isMesh) return;
        if (node.userData.buildingDepth || node.userData.buildingSurface) node.geometry.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
      });
      for (const material of materials) material.dispose();
      entry.proxy = null;
      entry.proxyMaterial = null;
    }
  }
}
