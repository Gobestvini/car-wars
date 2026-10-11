import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ART } from './art-direction.js';
import { makeConceptTrafficCar } from './traffic-models.js';

function vehicleGeometry(color, estate, police) {
  const parts = [];
  let policeBody = null;
  const add = (geometry, color, x,y,z) => {
    geometry.translate(x,y,z);
    const count = geometry.attributes.position.count, c = new THREE.Color(color);
    const values = new Float32Array(count*3);
    for (let i=0;i<count;i++) c.toArray(values,i*3);
    geometry.setAttribute('color',new THREE.BufferAttribute(values,3)); parts.push(geometry);
  };
  // Chamfer the cabin profile while retaining the original traffic footprint.
  const cabin = new THREE.BoxGeometry(1.46,.61,estate ? 2.15 : 1.75);
  const pos = cabin.attributes.position;
  for (let i=0;i<pos.count;i++) if (pos.getY(i)>0) {
    pos.setX(i,pos.getX(i)*.84); pos.setZ(i,pos.getZ(i)*.8);
  }
  cabin.computeVertexNormals();
  const lowerBody = new THREE.BoxGeometry(1.8,.58,3.8,5,2,10);
  add(lowerBody,color,0,.68,0);
  if (police) policeBody = parts.at(-1);
  add(cabin,ART.ink,0,1.2,estate ? -.28 : -.12);
  add(new THREE.BoxGeometry(1.2,.025,estate ? 1.5 : 1.13),color,0,1.52,estate ? -.28 : -.12);
  for (const x of [-.89,.89]) for (const z of [-1.18,1.18]) {
    const wheel = new THREE.CylinderGeometry(.36,.36,.2,10); wheel.rotateZ(Math.PI/2);
    add(wheel,ART.ink,x,.38,z);
  }
  // Broad paired lights also communicate heading when viewed in grayscale.
  for (const x of [-.57,.57]) {
    add(new THREE.BoxGeometry(.43,.13,.04),'#f2e4bb',x,.8,1.915);
    add(new THREE.BoxGeometry(.43,.12,.04),'#9e4348',x,.8,-1.915);
  }
  if (police) {
    add(new THREE.BoxGeometry(1.815,.24,2.3),ART.ink,0,.69,-.12);
    add(new THREE.BoxGeometry(.92,.12,.28),ART.ink,0,1.61,-.08);
  }
  if (police) {
    const staticParts = parts.filter(part => part !== policeBody);
    const staticGeometry = mergeGeometries(staticParts,false);
    for (const p of staticParts) p.dispose();
    return { body: policeBody, static: staticGeometry };
  }
  const merged = mergeGeometries(parts,false);
  for (const p of parts) p.dispose();
  return merged;
}

export function createTrafficAssets() {
  const material = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.78, metalness:.02 });
  const civilian = ART.traffic.map(color => [vehicleGeometry(color,false,false),vehicleGeometry(color,true,false)]);
  const police = vehicleGeometry('#e6e9e6',false,true);
  const lightGeometry = new THREE.BoxGeometry(.38,.13,.3);
  const lights = ['#ef344a','#438eff'].map(color=>new THREE.MeshStandardMaterial({ color,emissive:color,emissiveIntensity:.65,roughness:.5 }));
  return { civilian,police,material,lightGeometry,lights,
    dispose() { civilian.flat().forEach(g=>g.dispose()); police.body.dispose(); police.static.dispose();lightGeometry.dispose();material.dispose();lights.forEach(m=>m.dispose()); },
    animate(time) { lights.forEach((m,i)=>{m.emissiveIntensity=.35+.55*(.5+.5*Math.sin(time*6+i*Math.PI));}); },
  };
}

export function makeTrafficCar(THREE, assets, index, role='civilian') {
  if (assets.concept) return makeConceptTrafficCar(assets,index,role);
  const group = new THREE.Group();
  if (role === 'police') {
    const body = new THREE.Mesh(assets.police.body.clone(), assets.material);
    body.castShadow = true; body.receiveShadow = true; body.name = 'Police damageable body';
    const fixed = new THREE.Mesh(assets.police.static, assets.material);
    fixed.castShadow = true; fixed.receiveShadow = true; fixed.name = 'Police fixed parts';
    group.add(body, fixed);
    group.userData.damageableBody = body;
  } else {
    const geometry = assets.civilian[index % assets.civilian.length][index % 2];
    const mesh = new THREE.Mesh(geometry,assets.material); mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  if (role==='police') {
    const lamps = new THREE.Group(); lamps.name = 'Police roof lights';
    for (let i=0;i<2;i++) {
      const lamp = new THREE.Mesh(assets.lightGeometry,assets.lights[i]);lamp.position.set(i ? .24 : -.24,1.68,-.08);lamps.add(lamp);
    }
    group.add(lamps);
  }
  return group;
}

export function stylePlayerBody(body) {
  // Replace only the warm paint samples of the existing atlas; preserve glass, lights and UVs.
  body.material = body.material.clone();
  body.material.roughness=.72;body.material.metalness=.02;
  body.material.onBeforeCompile = shader => {
    shader.uniforms.playerPaint={value:new THREE.Color(ART.player)};
    shader.fragmentShader = 'uniform vec3 playerPaint;\n'+shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      if (diffuseColor.r > diffuseColor.g * 1.25 && diffuseColor.g > diffuseColor.b * 1.4 && diffuseColor.g > .08) {
        diffuseColor.rgb = playerPaint;
      }`);
  };
  body.material.customProgramCacheKey=()=> 'carwars-player-paint-v1';
}
