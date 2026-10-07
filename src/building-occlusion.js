const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const BUILDING_FADE = Object.freeze({ minimum: .22, close: 2, enter: 6, exit: 8 });

export function distanceToBuildingXZ(point, bounds) {
  const dx = point.x - clamp(point.x, bounds.min.x, bounds.max.x);
  const dz = point.z - clamp(point.z, bounds.min.z, bounds.max.z);
  return Math.hypot(dx, dz);
}

export function proximityVisibility(gap, wasNear = false) {
  const near = gap < (wasNear ? BUILDING_FADE.exit : BUILDING_FADE.enter);
  const t = clamp((gap - BUILDING_FADE.close) / (BUILDING_FADE.enter - BUILDING_FADE.close), 0, 1);
  return { near, opacity: near ? BUILDING_FADE.minimum + (1 - BUILDING_FADE.minimum) * t * t * (3 - 2 * t) : 1 };
}

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
    group.traverse(node => { if (node.isMesh) node.renderOrder = 2; });
    this.scene.add(group);
    entry.proxy = group;
    entry.proxyMaterial = material;
    for (const cap of caps) cap.visible = false;
    this.setInstanceVisible(entry, false);
  }

  finishProxy(entry, caps) {
    this.scene.remove(entry.proxy);
    const materials = new Set();
    entry.proxy.traverse(node => { if (node.isMesh) materials.add(node.material); });
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
    // Sample the four footprint corners too: fade before the 4.45m body reaches a wall.
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
      entry.carGap = Math.min(...targets.map(target => distanceToBuildingXZ(target, entry.bounds)));
      const proximity = proximityVisibility(entry.carGap, entry.nearCar);
      entry.nearCar = proximity.near;
      const occlusionTarget = hit || entry.wasOccluded ? BUILDING_FADE.minimum : 1;
      const target = Math.min(occlusionTarget, proximity.opacity);
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
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
      });
      for (const material of materials) material.dispose();
      entry.proxy = null;
      entry.proxyMaterial = null;
    }
  }
}
