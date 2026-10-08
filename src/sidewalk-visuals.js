import {
  createRoadFacingSidewalkEdges, createRoadSurfacePositions, createRectangleUnionEdges,
  createSidewalkCapPositions, createSidewalkWallPositions, ROAD_SURFACE_HEIGHTS,
} from './road-surface.js';

/** Create batched slab and curb meshes for the non-overlapping sidewalk tile set. */
export function createSidewalkVisuals(THREE, rectangles, roadRects, sidewalkMaterial, curbMaterial) {
  if (!rectangles.length) return [];
  const group = new THREE.Group();
  const surfaceGeometry = new THREE.BufferGeometry();
  surfaceGeometry.setAttribute('position', new THREE.BufferAttribute(
    createRoadSurfacePositions(rectangles, ROAD_SURFACE_HEIGHTS.sidewalkVisual), 3));
  surfaceGeometry.computeVertexNormals();
  const surface = new THREE.Mesh(surfaceGeometry, sidewalkMaterial);
  surface.name = 'Sidewalk surface';
  surface.receiveShadow = true;
  group.add(surface);

  const edges = createRectangleUnionEdges(rectangles);
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute('position', new THREE.BufferAttribute(
    createSidewalkWallPositions(edges), 3));
  wallGeometry.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeometry,
    new THREE.MeshStandardMaterial({ color: sidewalkMaterial.color, roughness: 1, side: THREE.DoubleSide }));
  walls.name = 'Sidewalk faces';
  walls.receiveShadow = true;
  group.add(walls);

  const roadEdges = createRoadFacingSidewalkEdges(edges, roadRects);
  if (roadEdges.length) {
    const capGeometry = new THREE.BufferGeometry();
    capGeometry.setAttribute('position', new THREE.BufferAttribute(createSidewalkCapPositions(roadEdges), 3));
    capGeometry.computeVertexNormals();
    const caps = new THREE.Mesh(capGeometry, curbMaterial);
    caps.name = 'Curb top edges';
    caps.receiveShadow = true;
    group.add(caps);
  }
  return group.children;
}
