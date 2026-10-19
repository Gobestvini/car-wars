import * as THREE from 'three';
import { PROP_DEBRIS_LIMIT } from './street-prop-config.js';

// Intact objects stay instanced. Only the bounded, brief ghosts own independent
// transparent materials; all geometry and textures remain shared with the city.
export class StreetPropFadePool {
  constructor(parent, capacity = PROP_DEBRIS_LIMIT) {
    this.parent = parent; this.capacity = capacity;
    this.active = new Map(); this.idle = []; this.created = 0; this.destroyed = 0;
    this.color = new THREE.Color(); this.disposed = false;
  }
  key(parts) {
    return parts.map(p => `${p.batch.geometry.uuid}:${[].concat(p.batch.material).map(m=>m.uuid).join(',')}`).join('|');
  }
  acquire(owner, parts) {
    if (this.disposed) throw Error('Street prop fade pool disposed');
    if (this.active.has(owner)) return this.active.get(owner);
    if (this.active.size >= this.capacity) this.release(this.active.keys().next().value);
    const key = this.key(parts), index = this.idle.findIndex(r=>r.key===key);
    let record = index < 0 ? null : this.idle.splice(index,1)[0];
    if (!record) {
      const group = new THREE.Group(); group.name = 'Street prop ghost';
      const meshes = parts.map(({batch})=>{
        const materials = [].concat(batch.material).map(material=>{
          const clone=material.clone();clone.transparent=true;clone.depthWrite=false;return clone;
        });
        const mesh = new THREE.Mesh(batch.geometry,Array.isArray(batch.material)?materials:materials[0]);
        mesh.matrixAutoUpdate=false;mesh.castShadow=false;mesh.receiveShadow=batch.receiveShadow;group.add(mesh);return mesh;
      });
      record={key,group,meshes};this.parent.add(group);this.created++;
    }
    record.group.visible=true;record.group.userData.propId=owner.id;this.active.set(owner,record);return record;
  }
  sync(owner, parts, transform, alpha) {
    const record=this.acquire(owner,parts);
    record.meshes.forEach((mesh,i)=>{
      const part=parts[i];mesh.matrix.multiplyMatrices(transform,part.matrix);mesh.matrixWorldNeedsUpdate=true;
      mesh.visible=part.batch.visible;
      this.color.set(0xffffff);if(part.batch.instanceColor)part.batch.getColorAt(part.index,this.color);
      [].concat(mesh.material).forEach((material,j)=>{
        const source=[].concat(part.batch.material)[j];
        if(material.color)material.color.copy(source.color).multiply(this.color);
        material.opacity=Math.max(0,Math.min(1,alpha))*source.opacity;
      });
    });
  }
  release(owner) {
    const record=this.active.get(owner);if(!record)return;
    this.active.delete(owner);record.group.visible=false;this.idle.push(record);
    while(this.idle.length>this.capacity)this.destroy(this.idle.shift());
  }
  destroy(record) {
    this.parent.remove(record.group);
    for(const mesh of record.meshes)for(const material of [].concat(mesh.material))material.dispose();
    this.destroyed++;
  }
  stats() { return {active:this.active.size,idle:this.idle.length,created:this.created,destroyed:this.destroyed}; }
  dispose() {
    if(this.disposed)return;
    for(const record of [...this.active.values(),...this.idle])this.destroy(record);
    this.active.clear();this.idle.length=0;this.disposed=true;
  }
}
