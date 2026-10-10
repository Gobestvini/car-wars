import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TRAFFIC_MODEL_URLS = Object.freeze({
  grey: 'models/grey-sedan.glb', green: 'models/green-sedan.glb', police: 'models/police-sedan.glb',
});

function surfaceMaterial(material) {
  material.roughness = .82;
  material.metalness = 0;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      #ifdef USE_MAP
        float tile = floor(vMapUv.x*4.0) + 4.0*(3.0-floor(vMapUv.y*4.0));
        float head = 1.0-step(0.5,abs(tile-8.0));
        float tail = 1.0-step(0.5,abs(tile-10.0));
        totalEmissiveRadiance += diffuseColor.rgb*head*1.8
          + vec3(1.0,0.002,0.001)*diffuseColor.r*tail*.45;
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', `
      #include <tonemapping_fragment>
      #ifdef USE_MAP
        gl_FragColor.rgb *= mix(vec3(1.0),vec3(1.0,.025,.025),tail);
      #endif
    `);
  };
  material.customProgramCacheKey = () => 'car-stars-traffic-atlas-v1';
  material.needsUpdate = true;
  return material;
}

// Traffic groups use road-height coordinates; the source uses chassis COM.
function baked(node) {
  if (!node?.isMesh) throw new Error('Incomplete concept traffic sedan');
  const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
  geometry.translate(0,.96,0);
  // glTF may include tangents in some parts; the shared lit atlas needs these three only.
  for (const name of Object.keys(geometry.attributes)) {
    if (!['position','normal','uv'].includes(name)) geometry.deleteAttribute(name);
  }
  return geometry;
}

export function createConceptTrafficAssets(scenes) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const retain = geometry => { geometries.add(geometry); return geometry; };
  const merged = nodes => {
    const parts = nodes.map(baked);
    const result = mergeGeometries(parts,false);
    parts.forEach(part => part.dispose());
    if (!result) throw new Error('Cannot merge concept sedan geometry');
    return retain(result);
  };
  const variants = {};
  for (const name of Object.keys(TRAFFIC_MODEL_URLS)) {
    const source = scenes[name];
    source.updateMatrixWorld(true);
    const body = source.getObjectByName('body');
    const wheels = ['wheel-front-left','wheel-front-right','wheel-rear-left','wheel-rear-right']
      .map(key => source.getObjectByName(key));
    const material = surfaceMaterial(body.material);
    materials.add(material);
    textures.add(material.map);
    variants[name] = { material };
    if (name !== 'police') Object.assign(variants[name], { full: merged([body,...wheels]),
      lod: retain(baked(source.getObjectByName('lod'))) });
    if (name === 'police') {
      variants[name].body = retain(baked(body));
      const fixedNodes = [...wheels,source.getObjectByName('lightbar-base'),source.getObjectByName('lightbar-center')];
      // Keep the white centre/base separate from the textured wheels, but merge
      // them into one primitive with atlas samples matching their surface roles.
      for (const [key,tile] of [['lightbar-base',7],['lightbar-center',6]]) {
        const node=source.getObjectByName(key);
        const uv=node.geometry.attributes.uv;
        for (let i=0;i<uv.count;i++) uv.setXY(i,(tile%4+.5)/4,(3-Math.floor(tile/4)+.5)/4);
      }
      variants[name].fixed = merged(fixedNodes);
      variants[name].beacons = ['beacon-red','beacon-blue'].map(key => {
        const node=source.getObjectByName(key), lampMaterial=node.material;
        lampMaterial.emissive.copy(lampMaterial.color);
        lampMaterial.emissiveIntensity=.8;
        lampMaterial.roughness=.65;
        lampMaterial.onBeforeCompile = shader => {
          shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>', `
            #include <tonemapping_fragment>
            gl_FragColor.rgb *= vec3(${key==='beacon-red'?'1.0,0.06,0.06':'0.06,0.24,1.0'});
          `);
        };
        lampMaterial.customProgramCacheKey=()=>key;
        materials.add(lampMaterial);
        return { geometry:retain(baked(node)), material:lampMaterial };
      });
    }
  }
  // Civilian UVs/topology are identical, so keep one geometry pair for both paints.
  for (const key of ['full','lod']) {
    geometries.delete(variants.green[key]); variants.green[key].dispose();
    variants.green[key]=variants.grey[key];
  }
  // Loaded source geometries are no longer used; atlas/material ownership transfers here.
  for (const source of Object.values(scenes)) source.traverse(node => {
    if (node.isMesh) {
      node.geometry.dispose();
      if (!materials.has(node.material)) node.material.dispose();
    }
  });
  return { concept:true, variants,
    animate(time) { variants.police.beacons.forEach(({material},i) => {
      material.emissiveIntensity=.25+1.55*(.5+.5*Math.sin(time*8+i*Math.PI));
    }); },
    dispose() { geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t?.dispose()); },
  };
}

export function makeConceptTrafficCar(assets, index, role) {
  const name=role==='police'?'police':index%2?'green':'grey';
  const variant=assets.variants[name];
  const group=new THREE.Group();
  group.name=`Concept ${name} sedan`;
  group.userData.conceptVariant=name;
  const mesh = (geometry,material,label) => {
    const node=new THREE.Mesh(geometry,material);
    node.name=label;node.castShadow=true;node.receiveShadow=true;
    return node;
  };
  if(role==='police') {
    const body=mesh(variant.body.clone(),variant.material,'Police damageable body');
    group.add(body,mesh(variant.fixed,variant.material,'Police fixed wheels and lightbar'));
    group.userData.damageableBody=body;
    variant.beacons.forEach(({geometry,material},i)=>group.add(mesh(geometry,material,i?'Blue right beacon':'Red left beacon')));
  } else {
    const lod=new THREE.LOD();
    lod.addLevel(mesh(variant.full,variant.material,'Concept sedan near'),0);
    lod.addLevel(mesh(variant.lod,variant.material,'Concept sedan distant'),28,.12);
    group.add(lod);
  }
  return group;
}
