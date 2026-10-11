import * as THREE from 'three';

export class RepairPickupVisuals {
  constructor(scene, pickups, surfaceHeight) {
    this.scene = scene; this.pickups = pickups; this.surfaceHeight = surfaceHeight; this.time = 0;
    this.group = new THREE.Group(); this.group.name = 'Repair pickups'; scene.add(this.group);
    this.materials = [new THREE.MeshStandardMaterial({ color: '#20d8a0', roughness: 0.46, metalness: 0.12 }),
      new THREE.MeshStandardMaterial({ color: '#effff8', roughness: 0.38, emissive: '#62e9bd', emissiveIntensity: 0.35 })];
    this.meshes = [
      new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.56, 0.78), this.materials[0], pickups.length),
      new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.035, 0.42), this.materials[1], pickups.length),
      new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.035, 0.16), this.materials[1], pickups.length),
    ];
    this.meshes.forEach(mesh => { mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh); });
    this.update(0);
  }
  update(dt) {
    this.time += Math.max(0, dt);
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < this.pickups.length; i++) {
      const pickup = this.pickups[i], available = pickup.status === 'available';
      position.set(pickup.x, this.surfaceHeight(pickup.x, pickup.z) + 0.62 + Math.sin(this.time * 2.2 + pickup.id) * 0.07, pickup.z);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.time * 0.28 + pickup.id * 0.17);
      scale.setScalar(available ? 1 : 0);
      for (let j = 0; j < this.meshes.length; j++) {
        const offset = j === 0 ? 0 : 0.31;
        matrix.compose(position.clone().add(new THREE.Vector3(0, offset, 0)), quaternion, scale);
        this.meshes[j].setMatrixAt(i, matrix);
      }
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.scene.remove(this.group);
    for (const mesh of this.meshes) { mesh.dispose(); mesh.geometry.dispose(); }
    for (const material of this.materials) material.dispose();
  }
}
