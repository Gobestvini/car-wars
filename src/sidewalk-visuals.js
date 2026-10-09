import {
  createRoadFacingSidewalkEdges, createRoadSurfacePositions, createRoundedSidewalkEdges,
  createSidewalkCapPositions, createSidewalkWallPositions, ROAD_SURFACE_HEIGHTS,
} from './road-surface.js';

function roundedPositions(corners, bottom, top, capWidth = 0, part = 'all') {
  const positions = [];
  for (const corner of corners) {
    const { x, z, sx, sz, radius, arc } = corner;
    for (let i = 0; i < arc.length - 1; i++) {
      const a = arc[i], b = arc[i + 1];
      const pushTri = (p, q, r) => positions.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
      const center = { x, y: top, z };
      const p = { ...a, y: top }, q = { ...b, y: top };
      const aBottom = { ...a, y: bottom }, bBottom = { ...b, y: bottom };
      if (part === 'all' || part === 'top') {
        if (sx * sz > 0) pushTri(center, q, p); else pushTri(center, p, q);
      }
      if (part === 'all' || part === 'walls') {
        pushTri(aBottom, bBottom, { ...b, y: top });
        pushTri(aBottom, { ...b, y: top }, { ...a, y: top });
      }
      if ((part === 'all' || part === 'cap') && capWidth > 0) {
        const ai = { x: x + (a.x - x) * (1 - capWidth / radius), y: top + 0.001,
          z: z + (a.z - z) * (1 - capWidth / radius) };
        const bi = { x: x + (b.x - x) * (1 - capWidth / radius), y: top + 0.001,
          z: z + (b.z - z) * (1 - capWidth / radius) };
        if (sx * sz > 0) { pushTri(p, bi, q); pushTri(p, ai, bi); }
        else { pushTri(p, q, bi); pushTri(p, bi, ai); }
      }
    }
  }
  return new Float32Array(positions);
}

function cutoutPositions(THREE, corners) {
  const positions = [];
  for (const { arc, point } of corners) {
    const shape = new THREE.Shape();
    shape.moveTo(point.x, point.z);
    for (const vertex of arc) shape.lineTo(vertex.x, vertex.z);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    // ShapeGeometry's XY plane is mapped onto the city's XZ plane.
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const localX = p.getX(i), localZ = p.getY(i);
      p.setXYZ(i, localX, 0.005, localZ);
    }
    const index = geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i + 1), b = index.getX(i + 2);
      index.setX(i + 1, b); index.setX(i + 2, a);
    }
    geometry.computeVertexNormals();
    const shapeIndex = geometry.index, attribute = geometry.attributes.position;
    for (let i = 0; i < shapeIndex.count; i++) {
      const point = shapeIndex.getX(i);
      positions.push(attribute.getX(point), attribute.getY(point), attribute.getZ(point));
    }
    geometry.dispose();
  }
  return new Float32Array(positions);
}

/** Create batched slab and curb meshes for the non-overlapping sidewalk tile set. */
export function createSidewalkVisuals(THREE, layout, roadRects, sidewalkMaterial, curbMaterial, asphaltColor = '#30343a') {
  const rectangles = Array.isArray(layout) ? layout : layout.rectangles;
  const corners = Array.isArray(layout) ? [] : layout.corners;
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

  if (corners.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(roundedPositions(corners,
      ROAD_SURFACE_HEIGHTS.sidewalkVisual, ROAD_SURFACE_HEIGHTS.sidewalkVisual, 0, 'top'), 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, sidewalkMaterial);
    mesh.name = 'Rounded sidewalk corners'; mesh.receiveShadow = true; group.add(mesh);
    const patchGeometry = new THREE.BufferGeometry();
    patchGeometry.setAttribute('position', new THREE.BufferAttribute(cutoutPositions(THREE, corners), 3));
    patchGeometry.computeVertexNormals();
    const patchMaterial = new THREE.MeshStandardMaterial({ color: asphaltColor, roughness: 0.96 });
    const asphalt = new THREE.Mesh(patchGeometry, patchMaterial);
    asphalt.name = 'Rounded sidewalk asphalt'; asphalt.receiveShadow = true; group.add(asphalt);
  }

  const edges = createRoundedSidewalkEdges(rectangles, corners);
  const wallGeometry = new THREE.BufferGeometry();
  const straightWalls = createSidewalkWallPositions(edges);
  const curvedWalls = roundedPositions(corners, ROAD_SURFACE_HEIGHTS.sidewalkBottom,
    ROAD_SURFACE_HEIGHTS.sidewalkVisual, 0, 'walls');
  wallGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...straightWalls, ...curvedWalls]), 3));
  wallGeometry.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeometry,
    new THREE.MeshStandardMaterial({ color: sidewalkMaterial.color, roughness: 1, side: THREE.DoubleSide }));
  walls.name = 'Sidewalk faces';
  walls.receiveShadow = true;
  group.add(walls);

  const roadEdges = createRoadFacingSidewalkEdges(edges, roadRects);
  if (roadEdges.length) {
    const capGeometry = new THREE.BufferGeometry();
    const straightCaps = createSidewalkCapPositions(roadEdges);
    const curvedCaps = roundedPositions(corners, ROAD_SURFACE_HEIGHTS.sidewalkVisual,
      ROAD_SURFACE_HEIGHTS.sidewalkVisual, ROAD_SURFACE_HEIGHTS.sidewalkCapWidth, 'cap');
    capGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...straightCaps, ...curvedCaps]), 3));
    capGeometry.computeVertexNormals();
    const caps = new THREE.Mesh(capGeometry, curbMaterial);
    caps.name = 'Curb top edges';
    caps.receiveShadow = true;
    group.add(caps);
  }
  return group.children;
}
