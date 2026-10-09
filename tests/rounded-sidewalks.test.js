import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cannon-es';
import * as THREE from 'three';
import { CITY_CONFIG, createCityPlan } from '../src/city-generator.js';
import { CarSimulation } from '../src/vehicle.js';
import { createRoadSurfaceRectangles, createRoundedSidewalkLayout, createSidewalkSupportPrisms, createSurfaceHeightSampler,
  containsRoundedSidewalk, createRoundedSidewalkEdges, ROAD_SURFACE_HEIGHTS } from '../src/road-surface.js';
import { createSidewalkVisuals } from '../src/sidewalk-visuals.js';
import { getSignalPosition } from '../src/signal-layout.js';

const plaza = plan => ({ centerX: 0, centerZ: 0, width: plan.blockPitch, depth: plan.blockPitch });

test('rounded sidewalk cuts the acute intersection point and preserves the block-facing corner in all quadrants', () => {
  const layout = createRoundedSidewalkLayout([0], 30, 15, 4);
  assert.equal(layout.corners.length, 4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const corner = layout.corners.find(item => item.sx === sx && item.sz === sz);
    const point = { x: sx * 7.5, z: sz * 7.5 };
    const center = { x: sx * 9.5, z: sz * 9.5 };
    assert.deepEqual(corner.point, point);
    assert.deepEqual({ x: corner.x, z: corner.z }, center);
    assert.equal(containsRoundedSidewalk(layout, point.x + sx * 0.1, point.z + sz * 0.1), false);
    assert.equal(containsRoundedSidewalk(layout, center.x - sx * 0.1, center.z - sz * 0.1), true);
    assert.deepEqual(corner.arc[0], { x: point.x, z: center.z });
    assert.deepEqual(corner.arc.at(-1), { x: center.x, z: point.z });
  }
});

test('every real road-grid corner is rounded consistently for supported widths and zero width is unchanged', () => {
  for (const roadWidth of [12, 15, 30]) {
    const plan = createCityPlan(undefined, { roadWidth });
    const layout = createRoundedSidewalkLayout(plan.roads, plan.bounds, roadWidth, plan.sidewalkWidth, plaza(plan));
    assert.equal(layout.corners.length, 252); // 256 outer corners minus four plaza notches.
    assert.equal(createSidewalkSupportPrisms(layout.corners).length, layout.corners.length);
    for (const corner of layout.corners) {
      assert.equal(corner.radius, 2);
      assert.equal(corner.arc.length, 9);
      assert.ok(layout.rectangles.every(rect => rect.maxX <= corner.bounds.minX + 1e-7
        || rect.minX >= corner.bounds.maxX - 1e-7 || rect.maxZ <= corner.bounds.minZ + 1e-7
        || rect.minZ >= corner.bounds.maxZ - 1e-7));
      const sampler = createSurfaceHeightSampler(plan);
      assert.equal(containsRoundedSidewalk(layout, corner.x - corner.sx * 1, corner.z - corner.sz * 1), true);
      assert.ok(Math.abs(sampler(corner.x - corner.sx * 1, corner.z - corner.sz * 1)
        - ROAD_SURFACE_HEIGHTS.sidewalkVisual - 0.004) < 1e-7);
      assert.ok(Math.abs(sampler(corner.x - corner.sx * 1.8, corner.z - corner.sz * 1.8)
        - ROAD_SURFACE_HEIGHTS.road - 0.004) < 1e-7);
    }
    const sampler = createSurfaceHeightSampler(plan);
    for (const center of plan.roads.slice(1, -1)) for (const other of plan.roads.slice(1, -1)) {
      for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const position = getSignalPosition({ x: center, z: other }, { forwardX: fx, forwardZ: fz,
          rightX: -fz, rightZ: fx }, roadWidth, plan.sidewalkWidth);
        assert.ok(sampler(position.x, position.z) > ROAD_SURFACE_HEIGHTS.road);
      }
    }
  }
  const empty = createCityPlan(undefined, { config: { ...CITY_CONFIG, sidewalkWidth: 0 } });
  assert.equal(createRoundedSidewalkLayout(empty.roads, empty.bounds, empty.roadWidth, 0, plaza(empty)).corners.length, 0);
});

test('rounded top, asphalt patch, curved wall and curb are batched and have upward top normals', () => {
  const plan = createCityPlan(), layout = createRoundedSidewalkLayout(plan.roads, plan.bounds,
    plan.roadWidth, plan.sidewalkWidth, plaza(plan));
  const roads = createRoadSurfaceRectangles(plan.roads, plan.bounds, plan.roadWidth, plaza(plan));
  const sidewalk = new THREE.MeshStandardMaterial(), curb = new THREE.MeshStandardMaterial();
  const meshes = createSidewalkVisuals(THREE, layout, roads, sidewalk, curb);
  assert.deepEqual(meshes.map(mesh => mesh.name), ['Sidewalk surface', 'Rounded sidewalk corners',
    'Rounded sidewalk asphalt', 'Sidewalk faces', 'Curb top edges']);
  for (const mesh of meshes) assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
  for (const mesh of [meshes[1], meshes[2]]) {
    const normals = mesh.geometry.attributes.normal;
    assert.ok(normals && Array.from({ length: normals.count }, (_, i) => normals.getY(i)).every(y => y > 0.99));
  }
  const roundedTopY = meshes[1].geometry.attributes.position.array.filter((_, i) => i % 3 === 1);
  assert.ok(roundedTopY.every(y => Math.abs(y - ROAD_SURFACE_HEIGHTS.sidewalkVisual) < 1e-6));
  const capY = meshes[4].geometry.attributes.position.array.filter((_, i) => i % 3 === 1);
  assert.ok(capY.every(y => Math.abs(y - ROAD_SURFACE_HEIGHTS.sidewalkVisual) < 1e-6));
  assert.equal(meshes[4].material.polygonOffset, true);
  const capNormals = meshes[4].geometry.attributes.normal;
  assert.ok(Array.from({ length: capNormals.count }, (_, i) => capNormals.getY(i)).every(y => y > 0.99));
  const edges = createRoundedSidewalkEdges(layout.rectangles, layout.corners);
  for (const corner of layout.corners) {
    const outerX = corner.x - corner.sx * corner.radius, outerZ = corner.z - corner.sz * corner.radius;
    assert.ok(edges.every(edge => !(edge.axis === 'z' && Math.abs(edge.value - corner.x) < 1e-7
      && edge.min < Math.max(corner.z, outerZ) && edge.max > Math.min(corner.z, outerZ))));
    assert.ok(edges.every(edge => !(edge.axis === 'x' && Math.abs(edge.value - corner.z) < 1e-7
      && edge.min < Math.max(corner.x, outerX) && edge.max > Math.min(corner.x, outerX))));
  }
  const geometries = new Set(meshes.map(mesh => mesh.geometry));
  for (const geometry of geometries) geometry.dispose();
  sidewalk.dispose(); curb.dispose();
});

test('rounded convex support ends at its arc and leaves the cut corner clear for a raycast', () => {
  const simulation = new CarSimulation();
  const fixtures = [-1, 1].flatMap((sx, column) => [-1, 1].map((sz, row) => {
    const x = column * 10, z = row * 10;
    const arc = Array.from({ length: 9 }, (_, i) => ({ x: x - sx * 2 * Math.cos(i * Math.PI / 16),
      z: z - sz * 2 * Math.sin(i * Math.PI / 16) }));
    return { x, z, sx, sz, radius: 2, arc };
  }));
  const bodies = createSidewalkSupportPrisms(fixtures).map(shape => simulation.addStaticConvex(shape));
  const ray = (x, z) => {
    const result = new C.RaycastResult();
    simulation.world.raycastClosest(new C.Vec3(x, 1, z), new C.Vec3(x, -1, z), { collisionFilterMask: 1 }, result);
    return result;
  };
  for (const [i, corner] of fixtures.entries()) {
    assert.equal(ray(corner.x - corner.sx, corner.z - corner.sz).body, bodies[i]);
    assert.ok(Math.abs(ray(corner.x - corner.sx, corner.z - corner.sz).hitPointWorld.y - ROAD_SURFACE_HEIGHTS.sidewalk) < 1e-6);
    assert.notEqual(ray(corner.x - corner.sx * 1.8, corner.z - corner.sz * 1.8).body, bodies[i]);
    assert.equal(simulation.removeStaticBox(bodies[i]), true);
  }
  assert.equal(simulation.world.bodies.length, 2);
});
