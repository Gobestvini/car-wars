import * as THREE from 'three';

const keyOf = (x, y, z) => `${Math.round(x * 10000)}:${Math.round(y * 10000)}:${Math.round(z * 10000)}`;

export class CarDeformation {
  constructor(geometry, geometryToCarMatrix, { maxDisplacement = 0.3, preserveHardEdges = false } = {}) {
    this.geometry = geometry;
    const positions = geometry.getAttribute('position');
    this.originalPositions = positions.array.slice();
    this.positionCount = positions.count;
    this.originalNormals = geometry.getAttribute('normal')?.array.slice() ?? null;
    this.originalTangents = geometry.getAttribute('tangent')?.array.slice() ?? null;
    this.geometryToCar = geometryToCarMatrix.clone();
    this.carToGeometry = geometryToCarMatrix.clone().invert();
    this.baselineCar = new Array(this.positionCount);
    this.uniqueIndices = new Map();
    this.normalGroups = new Map();
    const point = new THREE.Vector3();
    for (let i = 0; i < this.positionCount; i++) {
      point.fromArray(this.originalPositions, i * 3).applyMatrix4(this.geometryToCar);
      this.baselineCar[i] = point.clone();
      const key = keyOf(point.x, point.y, point.z);
      if (!this.uniqueIndices.has(key)) this.uniqueIndices.set(key, []);
      this.uniqueIndices.get(key).push(i);
      const normalKey = preserveHardEdges && this.originalNormals
        ? `${key}:${keyOf(...this.originalNormals.slice(i * 3, i * 3 + 3))}` : key;
      if (!this.normalGroups.has(normalKey)) this.normalGroups.set(normalKey, []);
      this.normalGroups.get(normalKey).push(i);
    }
    this.maxDisplacement = maxDisplacement;
    this.impacts = [];
  }

  apply(events) {
    if (!events.length) return false;
    for (const event of events) {
      if (this.impacts.length < 32 && event.impact?.depth > 0) this.impacts.push(event);
    }
    this.rebuild();
    return true;
  }

  rebuild() {
    const positions = this.geometry.getAttribute('position');
    const displacementByKey = new Map();
    const normal = new THREE.Vector3(), point = new THREE.Vector3(), offset = new THREE.Vector3();
    for (const [key, indices] of this.uniqueIndices) {
      const base = this.baselineCar[indices[0]];
      offset.set(0, 0, 0);
      for (const event of this.impacts) {
        point.set(event.point.x, event.point.y, event.point.z);
        normal.set(event.normal.x, event.normal.y, event.normal.z).normalize();
        const radius = event.impact.radius || 0.72;
        const distanceSquared = base.distanceToSquared(point);
        if (distanceSquared > radius * radius) continue;
        const weight = Math.exp(-4.5 * distanceSquared / (radius * radius));
        offset.addScaledVector(normal, event.impact.depth * weight);
      }
      if (offset.length() > this.maxDisplacement) offset.setLength(this.maxDisplacement);
      displacementByKey.set(key, offset.clone());
    }
    const carPoint = new THREE.Vector3();
    for (let i = 0; i < this.positionCount; i++) {
      const base = this.baselineCar[i], offsetForVertex = displacementByKey.get(keyOf(base.x, base.y, base.z));
      carPoint.copy(base).add(offsetForVertex).applyMatrix4(this.carToGeometry);
      positions.setXYZ(i, carPoint.x, carPoint.y, carPoint.z);
    }
    positions.needsUpdate = true;
    this.geometry.computeVertexNormals();
    const normals = this.geometry.getAttribute('normal');
    const average = new THREE.Vector3();
    for (const indices of this.normalGroups.values()) {
      average.set(0, 0, 0);
      for (const index of indices) average.add(new THREE.Vector3().fromBufferAttribute(normals, index));
      average.normalize();
      for (const index of indices) normals.setXYZ(index, average.x, average.y, average.z);
    }
    normals.needsUpdate = true;
    if (this.geometry.getAttribute('tangent') && this.geometry.getAttribute('uv') && this.geometry.index) this.geometry.computeTangents();
    this.geometry.computeBoundingBox(); this.geometry.computeBoundingSphere();
  }

  restore() {
    this.impacts.length = 0;
    this.geometry.getAttribute('position').array.set(this.originalPositions);
    this.geometry.getAttribute('position').needsUpdate = true;
    if (this.originalNormals && this.geometry.getAttribute('normal')) {
      this.geometry.getAttribute('normal').array.set(this.originalNormals);
      this.geometry.getAttribute('normal').needsUpdate = true;
    }
    if (this.originalTangents && this.geometry.getAttribute('tangent')) {
      this.geometry.getAttribute('tangent').array.set(this.originalTangents);
      this.geometry.getAttribute('tangent').needsUpdate = true;
    }
    this.geometry.computeBoundingBox(); this.geometry.computeBoundingSphere();
  }
}
