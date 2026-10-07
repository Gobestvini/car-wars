import * as THREE from 'three';
import { ART, buildingArt } from './art-direction.js';

// Five mandatory batches + one optional high batch. No new texture or collider.
export function createCityArt(group, entries, seed) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const hip = new THREE.ConeGeometry(.7071, 1, 4);
  hip.rotateY(Math.PI / 4);
  const ridge = box.clone();
  const pos = ridge.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setZ(i, pos.getZ(i) * .12);
  ridge.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .95 });
  const batches = [box, box, hip, box, ridge, box].map((geometry, index) => {
    const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
    mesh.name = ['Building plinths', 'Building cornices', 'Residential roofs', 'Commercial roofs', 'Industrial roofs', 'Roof plant'][index];
    mesh.castShadow = index >= 2; mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  });
  let high = true;
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0,0,0);
  for (const entry of entries) {
    const style = buildingArt(entry, seed); entry.artFamily = style.family; entry.artDistrict = style.district;
    const parts = [];
    const part = (batch, x,y,z,w,h,d,color) => {
      matrix.compose(position.set(x,y,z), rotation, scale.set(w,h,d));
      const partColor = new THREE.Color(color);
      batches[batch].setMatrixAt(entry.index,matrix); batches[batch].setColorAt(entry.index,partColor);
      parts.push({ batch, matrix:matrix.clone(), color:partColor });
    };
    // Slightly inset so decorative trim never appears as a new road obstacle.
    for (const batch of batches) { batch.setMatrixAt(entry.index,zero); batch.setColorAt(entry.index,new THREE.Color(ART.roof)); }
    part(0, entry.x,.36,entry.z,entry.width+.015,.7,entry.depth+.015,ART.roof);
    part(1, entry.x,entry.height-.32,entry.z,entry.width+.015,.28,entry.depth+.015,'#fff6dc');
    const roofHeight = style.family === 0 ? .85 : style.family === 1 ? .2 : .6;
    part(2+style.family,entry.x,entry.height+roofHeight/2,entry.z,entry.width*.98,roofHeight,entry.depth*.98,ART.roof);
    // Roof plant needs a flat bearing surface; pitched roofs keep a clean silhouette.
    if (style.family === 1) part(5,entry.x+entry.width*.18,entry.height+roofHeight+.18,entry.z-entry.depth*.15,entry.width*.22,.36,entry.depth*.3,'#a3b6ce');
    entry.art = {
      parts,
      hide() { for (const p of parts) { batches[p.batch].setMatrixAt(entry.index,zero); batches[p.batch].instanceMatrix.needsUpdate=true; } },
      restore() { for (const p of parts) { batches[p.batch].setMatrixAt(entry.index,p.matrix); batches[p.batch].instanceMatrix.needsUpdate=true; } },
      proxy(parent) {
        for (const p of parts) {
          const mesh = new THREE.Mesh(batches[p.batch].geometry,material.clone());
          mesh.material.color.copy(p.color); mesh.material.transparent=true; mesh.material.depthWrite=false;
          p.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale); mesh.position.sub(parent.position);
          mesh.castShadow=p.batch>=2; mesh.receiveShadow=true; mesh.userData.roofDetail=p.batch===5;
          mesh.visible=p.batch!==5 || high; parent.add(mesh);
        }
      },
    };
  }
  for (const batch of batches) { batch.instanceMatrix.needsUpdate=true; batch.instanceColor.needsUpdate=true; batch.computeBoundingSphere(); }
  return {
    setQuality(quality) {
      const next = quality !== 'low'; if (next===high) return; high=next; batches[5].visible=high;
      for (const entry of entries) if (entry.proxy) {
        for (const child of entry.proxy.children) if (child.userData.roofDetail) child.visible=high;
        entry.proxy.userData.rebuildDepth?.();
      }
    },
  };
}
