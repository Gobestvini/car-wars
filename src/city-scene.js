import * as THREE from 'three';
import { BuildingOcclusion } from './building-occlusion.js';
import { createRoadMarkings } from './road-markings.js';
import { createRoadSurfacePositions, createRoadSurfaceRectangles, createSidewalkRectangles } from './road-surface.js';
import { getSignalPosition, getStopLineLayout } from './signal-layout.js';
import { createSignalBeam } from './signal-glow.js';

export function createCityScene(scene, simulation, plan, damageObstacles = []) {
  const group = new THREE.Group();
  group.name = 'Procedural City';
  scene.add(group);
  const staticBodies = [];
  // The city-wide base plane sits beneath asphalt/sidewalk overlays. A small depth bias
  // preserves that intentional layer order with the free camera's long far plane.
  const pavementMaterial = new THREE.MeshStandardMaterial({ color: '#bdb9aa', roughness: 1,
    polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: 2 });
  const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: '#aaa99f', roughness: 1 });
  const roadMaterial = new THREE.MeshStandardMaterial({ color: '#353a3c', roughness: 0.96 });
  const plane = (width, depth, material, x = 0, z = 0, y = 0.015) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  plane(plan.bounds * 2, plan.bounds * 2, pavementMaterial, 0, 0, -0.015);
  const centreIndex = Math.floor(plan.roads.length / 2);
  const plazaSpan = Math.abs(plan.roads[centreIndex] - plan.roads[centreIndex - 1]);
  const roadRects = createRoadSurfaceRectangles(plan.roads, plan.bounds, plan.roadWidth,
    { centerX: 0, centerZ: 0, width: plazaSpan, depth: plazaSpan });
  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute('position', new THREE.BufferAttribute(createRoadSurfacePositions(roadRects), 3));
  roadGeometry.computeVertexNormals();
  const roadSurface = new THREE.Mesh(roadGeometry, roadMaterial);
  roadSurface.name = 'Road surface';
  roadSurface.receiveShadow = true;
  group.add(roadSurface);
  const sidewalkRects = createSidewalkRectangles(plan.roads, plan.bounds, plan.roadWidth, plan.sidewalkWidth,
    { centerX: 0, centerZ: 0, width: plazaSpan, depth: plazaSpan });
  const sidewalkGeometry = new THREE.BufferGeometry();
  sidewalkGeometry.setAttribute('position', new THREE.BufferAttribute(createRoadSurfacePositions(sidewalkRects, 0.055), 3));
  sidewalkGeometry.computeVertexNormals();
  const sidewalk = new THREE.Mesh(sidewalkGeometry, sidewalkMaterial);
  sidewalk.name = 'Sidewalk surface'; sidewalk.receiveShadow = true; group.add(sidewalk);
  const marks = createRoadMarkings(plan.roads, plan.bounds, plan.roadWidth);
  const dashGeometry = new THREE.BoxGeometry(0.16, 0.025, 2.2);
  const dashMaterial = new THREE.MeshStandardMaterial({ color: '#d6cdb4', roughness: 1 });
  const dashes = new THREE.InstancedMesh(dashGeometry, dashMaterial, marks.length);
  dashes.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const unitScale = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    position.set(mark.x, 0.025, mark.z);
    rotation.setFromAxisAngle(up, mark.yaw);
    matrix.compose(position, rotation, unitScale);
    dashes.setMatrixAt(i, matrix);
  }
  dashes.instanceMatrix.needsUpdate = true;
  group.add(dashes);

  const approaches = [];
  for (const edge of plan.roadNetwork.edges) for (const [fromId, nodeId] of [[edge.from, edge.to], [edge.to, edge.from]]) {
    const node = plan.roadNetwork.intersections.find(item => item.id === nodeId);
    const from = plan.roadNetwork.intersections.find(item => item.id === fromId);
    const degree = plan.roadNetwork.edges.reduce((count, item) => count + Number(item.from === nodeId || item.to === nodeId), 0);
    if (!node || !from || degree < 4) continue;
    const dx = node.x - from.x, dz = node.z - from.z, length = Math.hypot(dx, dz);
    const forwardX = dx / length, forwardZ = dz / length, rightX = -forwardZ, rightZ = forwardX;
    const stopLine = getStopLineLayout(node, { forwardX, forwardZ, rightX, rightZ }, plan.roadWidth);
    const signalPosition = getSignalPosition(node, { forwardX, forwardZ, rightX, rightZ }, plan.roadWidth, plan.sidewalkWidth);
    approaches.push({ nodeId, fromId, forwardX, forwardZ, rightX, rightZ, stopX: stopLine.x, stopZ: stopLine.z,
      stopDistance: stopLine.distanceFromNode, stopLineLength: stopLine.length, stopLineThickness: stopLine.thickness,
      signalX: signalPosition.x, signalZ: signalPosition.z, signalVisible: true,
      yaw: Math.atan2(forwardX, forwardZ), signalYaw: Math.atan2(-forwardX, -forwardZ) });
  }
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 3, 6),
    new THREE.MeshStandardMaterial({ color: '#555b5c', roughness: 0.75 }), approaches.length);
  const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.58, 1.5, 0.38),
    new THREE.MeshStandardMaterial({ color: '#282c2d', roughness: 0.7 }), approaches.length);
  const bulbGeometry = new THREE.SphereGeometry(0.17, 8, 6);
  const bulbs = new THREE.InstancedMesh(bulbGeometry, new THREE.MeshBasicMaterial({ color: '#ffffff' }), approaches.length * 3);
  const stopLines = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.035, 1),
    new THREE.MeshStandardMaterial({ color: '#e9e4d1', roughness: 1 }), approaches.length);
  stopLines.receiveShadow = true;
  const visualMatrix = new THREE.Matrix4(), visualPosition = new THREE.Vector3(), visualRotation = new THREE.Quaternion();
  const visualScale = new THREE.Vector3(1, 1, 1);
  const lightColors = { red: new THREE.Color('#f34f45'), yellow: new THREE.Color('#ffc34a'), green: new THREE.Color('#51d28b'), off: new THREE.Color('#393737') };
  approaches.forEach((approach, index) => {
    visualPosition.set(approach.signalX, 1.5, approach.signalZ);
    visualMatrix.compose(visualPosition, visualRotation.setFromAxisAngle(up, approach.signalYaw), visualScale);
    poles.setMatrixAt(index, visualMatrix);
    visualPosition.y = 3.05;
    visualMatrix.compose(visualPosition, visualRotation, visualScale);
    housings.setMatrixAt(index, visualMatrix);
    for (let lamp = 0; lamp < 3; lamp++) {
      visualPosition.y = 3.5 - lamp * 0.45;
      visualPosition.x = approach.signalX - approach.forwardX * 0.22;
      visualPosition.z = approach.signalZ - approach.forwardZ * 0.22;
      visualMatrix.compose(visualPosition, visualRotation, visualScale);
      bulbs.setMatrixAt(index * 3 + lamp, visualMatrix);
      bulbs.setColorAt(index * 3 + lamp, lightColors.off);
    }
    visualPosition.set(approach.stopX, 0.0275, approach.stopZ);
    visualMatrix.compose(visualPosition, visualRotation.setFromAxisAngle(up, approach.yaw),
      visualScale.set(approach.stopLineLength, 1, approach.stopLineThickness));
    stopLines.setMatrixAt(index, visualMatrix);
    visualScale.set(1, 1, 1);
  });
  const signalBeam = createSignalBeam(approaches);
  group.add(poles, housings, bulbs, stopLines, signalBeam);

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
  const buildings = new THREE.InstancedMesh(boxGeometry, buildingMaterial, plan.buildings.length);
  const entries = [];
  const buildMatrix = new THREE.Matrix4();
  for (let i = 0; i < plan.buildings.length; i++) {
    const building = plan.buildings[i];
    buildMatrix.compose(new THREE.Vector3(building.x, building.height / 2, building.z), new THREE.Quaternion(),
      new THREE.Vector3(building.width, building.height, building.depth));
    buildings.setMatrixAt(i, buildMatrix);
    buildings.setColorAt(i, new THREE.Color(building.color));
    const entry = { ...building, index: i, opacity: 1, proxy: null, proxyMaterial: null,
      bounds: { min: { x: building.x - building.width / 2, y: 0, z: building.z - building.depth / 2 },
        max: { x: building.x + building.width / 2, y: building.height, z: building.z + building.depth / 2 } }, caps: [] };
    entries.push(entry);
    if (building.landmark) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(building.width * 0.55, building.kind === 'tower' ? 5 : 2.5, building.kind === 'clock' ? 4 : 8),
        new THREE.MeshStandardMaterial({ color: '#675e53', roughness: 0.9 }));
      cap.position.set(building.x, building.height + (building.kind === 'tower' ? 2.5 : 1.25), building.z);
      cap.castShadow = true;
      group.add(cap);
      entry.caps.push(cap);
    }
    staticBodies.push(simulation.addStaticBox({ x: building.x, y: building.height / 2, z: building.z,
      halfX: building.width / 2, halfY: building.height / 2, halfZ: building.depth / 2 }));
  }
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  group.add(buildings);
  const occlusion = new BuildingOcclusion(THREE, group, buildings, boxGeometry, entries);

  const walls = [
    [0, -plan.bounds, plan.bounds * 2 + plan.roadWidth, 3],
    [0, plan.bounds, plan.bounds * 2 + plan.roadWidth, 3],
    [-plan.bounds, 0, 3, plan.bounds * 2 + plan.roadWidth],
    [plan.bounds, 0, 3, plan.bounds * 2 + plan.roadWidth],
  ];
  for (const [x, z, width, depth] of walls) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, 3.2, depth), new THREE.MeshStandardMaterial({ color: '#8a8980', roughness: 1 }));
    wall.position.set(x, 1.6, z);
    wall.castShadow = true;
    group.add(wall);
    staticBodies.push(simulation.addStaticBox({ x, y: 1.6, z, halfX: width / 2, halfY: 1.6, halfZ: depth / 2 }));
  }

  for (const [x, z, width, depth, height = 1.4, yaw = 0] of damageObstacles) {
    const obstacle = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({ color: '#c4a45f', roughness: 0.95 }));
    obstacle.position.set(x, height / 2, z);
    obstacle.rotation.y = yaw;
    obstacle.castShadow = true;
    obstacle.receiveShadow = true;
    group.add(obstacle);
    staticBodies.push(simulation.addStaticBox({ x, y: height / 2, z, halfX: width / 2, halfY: height / 2, halfZ: depth / 2, yaw }));
  }

  return {
    group, entries, buildings, marks, dashes, stopLines, signalBeam, occlusion, staticBodies, signalApproaches: approaches,
    updateSignals(controller, time) {
      let changed = false;
      for (let i = 0; i < approaches.length; i++) {
        const approach = approaches[i];
        const { color } = controller.phase(approach.nodeId, approach.fromId, time);
        if (approach.color === color) continue;
        approach.color = color;
        changed = true;
        signalBeam.userData.updateBeam(i, approach, color);
        const active = color === 'green' ? 2 : color === 'yellow' ? 1 : color === 'red' ? 0 : -1;
        for (let lamp = 0; lamp < 3; lamp++) bulbs.setColorAt(i * 3 + lamp,
          lightColors[lamp === active ? ['red', 'yellow', 'green'][lamp] : 'off']);
      }
      if (!changed) return;
      bulbs.instanceColor.needsUpdate = true;
      signalBeam.instanceColor.needsUpdate = true;
      signalBeam.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      occlusion.dispose();
      for (const body of staticBodies) simulation.removeStaticBox(body);
      scene.remove(group);
      const geometries = new Set(), materials = new Set();
      group.traverse(object => {
        if (!object.isMesh) return;
        if (object.isInstancedMesh) object.dispose();
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
    roadMarkings() {
      const transform = new THREE.Matrix4();
      return marks.map((mark, index) => {
        dashes.getMatrixAt(index, transform);
        const elements = transform.elements;
        return { axis: mark.axis, x: elements[12], z: elements[14], longAxisX: elements[8], longAxisZ: elements[10] };
      });
    },
  };
}
