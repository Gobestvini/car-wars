import * as THREE from 'three';
import { ART } from '../src/art-direction.js';
import { createRoundedSidewalkLayout, createRoundedSidewalkEdges, createRoadSurfaceRectangles,
  containsRoundedSidewalk, createRoadFacingSidewalkEdges, createSidewalkCapPositions,
  ROAD_SURFACE_HEIGHTS } from '../src/road-surface.js';
import { createSidewalkVisuals } from '../src/sidewalk-visuals.js';

// Four static close-ups expose both join lines of every rounded corner.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(ART.asphalt);
scene.add(new THREE.HemisphereLight(0xd8efff, 0xc6b18b, 1.8));
const sun = new THREE.DirectionalLight(0xffefd5, 2.4);
sun.position.set(-25, 45, 20); scene.add(sun);
const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: ART.asphalt, roughness: 0.96 }));
asphalt.rotation.x = -Math.PI / 2;
asphalt.position.y = ROAD_SURFACE_HEIGHTS.road;
scene.add(asphalt);
const layout = createRoundedSidewalkLayout([0], 20, 12, 4);
const roads = createRoadSurfaceRectangles([0], 20, 12);
const topMaterial = new THREE.MeshStandardMaterial({ color: ART.sidewalk, roughness: 1 });
const curbMaterial = new THREE.MeshStandardMaterial({ color: '#ead6ad', roughness: 1 });
const meshes = [...createSidewalkVisuals(THREE, layout, roads, topMaterial, curbMaterial, ART.asphalt)];
scene.add(...meshes);
const edges = createRoundedSidewalkEdges(layout.rectangles, layout.corners);
const joins = layout.corners.flatMap(corner => edges.filter(edge => {
  const along = edge.axis === 'x' ? corner.x : corner.z;
  const sign = edge.axis === 'x' ? corner.sx : corner.sz;
  const fixed = edge.axis === 'x' ? corner.z : corner.x;
  return Math.abs(edge.value - fixed) < 1e-6
    && Math.min(edge.max, Math.max(along, along - sign * corner.radius))
      > Math.max(edge.min, Math.min(along, along - sign * corner.radius)) + 1e-6;
}));
const straight = createSidewalkCapPositions(createRoadFacingSidewalkEdges(edges, roads));
const curved = meshes.find(mesh => mesh.name === 'Curb top edges').geometry.attributes.position.array.slice(straight.length);
let protrudingStraightVertices = 0, tangentMismatches = 0;
for (let i = 0; i < straight.length; i += 3) {
  if (!containsRoundedSidewalk(layout, straight[i], straight[i + 2])) protrudingStraightVertices++;
}
const hasPoint = (positions, x, z) => {
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i] - x) < 1e-6 && Math.abs(positions[i + 2] - z) < 1e-6) return true;
  }
  return false;
};
for (const { x, z, sx, sz, radius } of layout.corners) {
  const width = ROAD_SURFACE_HEIGHTS.sidewalkCapWidth;
  for (const [tx, tz] of [[x - sx * radius, z], [x - sx * (radius - width), z],
    [x, z - sz * radius], [x, z - sz * (radius - width)]]) {
    if (!hasPoint(straight, tx, tz) || !hasPoint(curved, tx, tz)) tangentMismatches++;
  }
}
const report = { interiorJoinWalls: joins.length, cornerCount: layout.corners.length,
  protrudingStraightVertices, tangentMismatches, topColors: [] };
renderer.setScissorTest(true);
layout.corners.forEach((corner, index) => {
  const w = innerWidth / 2, h = innerHeight / 2;
  const x = index % 2 * w, y = Math.floor(index / 2) * h;
  const camera = new THREE.OrthographicCamera(-4 * w / h, 4 * w / h, 4, -4, 0.1, 80);
  camera.position.set(corner.x - corner.sx * 10, 11, corner.z - corner.sz * 10);
  camera.lookAt(corner.x, 0, corner.z);
  renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
  renderer.render(scene, camera);
  const sample = (px, pz) => {
    const point = new THREE.Vector3(px, 0.155, pz).project(camera);
    const pixel = new Uint8Array(4), gl = renderer.getContext();
    gl.readPixels(Math.floor(x + (point.x + 1) * w / 2),
      Math.floor(y + (point.y + 1) * h / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel.slice(0, 3)];
  };
  const rounded = sample(corner.x - corner.sx * 0.8, corner.z - corner.sz * 0.8);
  const straight = sample(corner.x + corner.sx * 0.8, corner.z - corner.sz * 0.8);
  report.topColors.push({ sx: corner.sx, sz: corner.sz, rounded, straight,
    maxDelta: Math.max(...rounded.map((value, i) => Math.abs(value - straight[i]))) });
});
report.pass = joins.length === 0 && protrudingStraightVertices === 0 && tangentMismatches === 0
  && report.topColors.every(row => row.maxDelta === 0);
document.querySelector('#results').textContent = JSON.stringify(report, null, 2);
