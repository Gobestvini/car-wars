import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createRoadFacingSidewalkEdges, createRoadSurfaceRectangles, createRectangleUnionEdges,
  createSidewalkCapPositions, createSidewalkRectangles, createSidewalkSupportBoxes,
  createSidewalkWallPositions, createSurfaceHeightSampler, ROAD_SURFACE_HEIGHTS,
} from '../src/road-surface.js';
import { createSidewalkVisuals } from '../src/sidewalk-visuals.js';
import { createRoundedSidewalkLayout } from '../src/road-surface.js';
import { CITY_CONFIG, createCityPlan } from '../src/city-generator.js';
import { createCityScene } from '../src/city-scene.js';
import { CarSimulation, STEP } from '../src/vehicle.js';

const plazaFor = roads => {
  const middle = Math.floor(roads.length / 2);
  const span = Math.abs(roads[middle] - roads[middle - 1]);
  return { centerX: 0, centerZ: 0, width: span, depth: span };
};

test('sidewalk supports match the elevated footprint across road widths without reaching the road or plaza', () => {
  for (const width of [12, 15, 20, 30]) {
    const plan = createCityPlan(undefined, { roadWidth: width });
    const plaza = plazaFor(plan.roads);
    const walks = createSidewalkRectangles(plan.roads, plan.bounds, width, plan.sidewalkWidth, plaza);
    const roads = createRoadSurfaceRectangles(plan.roads, plan.bounds, width, plaza);
    const boxes = createSidewalkSupportBoxes(walks);
    assert.equal(boxes.length, walks.length);
    for (const [index, box] of boxes.entries()) {
      assert.equal(box.y + box.halfY, ROAD_SURFACE_HEIGHTS.sidewalk);
      assert.equal(box.bottom, undefined);
      const rect = walks[index];
      const x = (rect.minX + rect.maxX) / 2, z = (rect.minZ + rect.maxZ) / 2;
      assert.ok(walks.every(other => other === rect || x <= other.minX || x >= other.maxX || z <= other.minZ || z >= other.maxZ));
      assert.ok(roads.every(road => x <= road.minX || x >= road.maxX || z <= road.minZ || z >= road.maxZ));
      assert.ok(!(Math.abs(x - plaza.centerX) < plaza.width / 2 && Math.abs(z - plaza.centerZ) < plaza.depth / 2));
    }
    assert.ok(boxes.every(box => box.wheelSupport && box.y - box.halfY < 0));
  }
});

test('union walls remove internal seams, road-facing caps stay on top, and zero-width sidewalks are empty', () => {
  const plan = createCityPlan();
  const plaza = plazaFor(plan.roads);
  const walks = createSidewalkRectangles(plan.roads, plan.bounds, plan.roadWidth, plan.sidewalkWidth, plaza);
  const roadRects = createRoadSurfaceRectangles(plan.roads, plan.bounds, plan.roadWidth, plaza);
  const edges = createRectangleUnionEdges(walks);
  const roadEdges = createRoadFacingSidewalkEdges(edges, roadRects);
  assert.ok(edges.length > 0 && roadEdges.length > 0);
  const byOrientation = new Map();
  for (const edge of edges) {
    const key = `${edge.axis}:${edge.value}:${edge.side}`;
    const intervals = byOrientation.get(key) || [];
    intervals.push([edge.min, edge.max]); byOrientation.set(key, intervals);
  }
  for (const intervals of byOrientation.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < intervals.length; index++) assert.ok(intervals[index - 1][1] < intervals[index][0]);
  }
  const wallPositions = createSidewalkWallPositions(edges);
  const capPositions = createSidewalkCapPositions(roadEdges);
  assert.equal(wallPositions.length, edges.length * 18);
  assert.equal(capPositions.length, roadEdges.length * 18);
  assert.ok(wallPositions.every(Number.isFinite) && capPositions.every(Number.isFinite));
  assert.ok([...capPositions].filter((_, index) => index % 3 === 1)
    .every(y => Math.abs(y - ROAD_SURFACE_HEIGHTS.sidewalkVisual) < 1e-7));
  assert.deepEqual(createSidewalkSupportBoxes([]), []);
  assert.deepEqual(createSidewalkRectangles(plan.roads, plan.bounds, plan.roadWidth, 0, plaza), []);
  const emptyPlan = createCityPlan(undefined, { config: { ...CITY_CONFIG, sidewalkWidth: 0 } });
  assert.equal(createSurfaceHeightSampler(emptyPlan)(0, 80), ROAD_SURFACE_HEIGHTS.road + 0.004);
});

test('sidewalk tops, union faces, and road-facing caps are rendered in at most three batches', () => {
  const sidewalk = new THREE.MeshStandardMaterial({ color: '#e7e0cf' });
  const curb = new THREE.MeshStandardMaterial({ color: '#fff2d8' });
  const meshes = createSidewalkVisuals(THREE,
    [{ minX: 0, maxX: 2, minZ: 0, maxZ: 10 }],
    [{ minX: -5, maxX: 0, minZ: 0, maxZ: 10 }], sidewalk, curb);
  assert.equal(meshes.length, 3);
  assert.deepEqual(meshes.map(mesh => mesh.name), ['Sidewalk surface', 'Sidewalk faces', 'Curb top edges']);
  assert.ok(meshes.every(mesh => mesh.geometry.attributes.position.array.every(Number.isFinite)));
  assert.equal(meshes[0].geometry.attributes.position.count, 6);
  assert.equal(meshes[1].geometry.attributes.position.count, 24);
  assert.equal(meshes[2].geometry.attributes.position.count, 6);
  for (const mesh of meshes) mesh.geometry.dispose();
  meshes[1].material.dispose(); sidewalk.dispose(); curb.dispose();
});

test('surface sampler follows the raised slab while road and ground levels remain unchanged', () => {
  const height = createSurfaceHeightSampler(createCityPlan());
  assert.ok(Math.abs(height(0, 83.5) - (ROAD_SURFACE_HEIGHTS.sidewalkVisual + 0.004)) < 1e-9);
  assert.ok(Math.abs(height(0, 80) - (ROAD_SURFACE_HEIGHTS.road + 0.004)) < 1e-9);
  assert.ok(Math.abs(height(0, 207) - (-0.015 + 0.004)) < 1e-9);
  assert.equal(ROAD_SURFACE_HEIGHTS.sidewalk - ROAD_SURFACE_HEIGHTS.ground, 0.15);
});

test('the live city scene adds raycastable raised slabs and removes every support collider on dispose', () => {
  const scene = new THREE.Scene();
  const simulation = new CarSimulation({ spawn: { x: 0, y: 0.96, z: 83.5, yaw: Math.PI / 2 } });
  const plan = createCityPlan();
  const rounded = createRoundedSidewalkLayout(plan.roads, plan.bounds, plan.roadWidth, plan.sidewalkWidth, plazaFor(plan.roads));
  const city = createCityScene(scene, simulation, plan);
  const supports = city.staticBodies.filter(body => body.wheelSupport);
  assert.equal(supports.length, rounded.rectangles.length + rounded.corners.length);
  assert.ok(city.group.getObjectByName('Sidewalk surface'));
  assert.ok(city.group.getObjectByName('Sidewalk faces'));
  assert.ok(city.group.getObjectByName('Curb top edges'));
  assert.ok(supports.every(body => simulation.world.bodies.includes(body) && body.collisionFilterGroup === 1));
  for (let i = 0; i < 360; i++) simulation.step({ brake: 0.32 }, STEP);
  assert.equal(simulation.telemetry().grounded, 4);
  assert.ok(Math.abs(simulation.body.position.y - 1.018) < 0.025);
  city.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(simulation.world.bodies.length, 2);
});

test('detached wheels use the raised support group and physically land on a sidewalk slab', () => {
  const simulation = new CarSimulation();
  const support = simulation.addStaticBox({ x: 0, y: 0.0675, z: 0, halfX: 5, halfY: 0.0825, halfZ: 5, wheelSupport: true });
  for (let i = 0; i < 360; i++) simulation.step({ brake: 0.32 }, STEP);
  const wheel = simulation.wheels[0];
  simulation.detachWheelAtImpact({ speed: 20, point: wheel.position, normal: { x: 0, y: 1, z: 0 } });
  const detachedBody = wheel.detachedBody;
  assert.ok(detachedBody);
  for (let i = 0; i < 120; i++) simulation.step({}, STEP);
  assert.equal(detachedBody.collisionFilterGroup, 8);
  assert.equal(detachedBody.collisionFilterMask, 1);
  assert.ok(simulation.world.contacts.some(contact =>
    ((contact.bi === detachedBody && contact.bj === support) || (contact.bj === detachedBody && contact.bi === support))));
  assert.ok(detachedBody.position.y > 0.5);
  simulation.removeStaticBox(support);
});

test('ten city rebuilds across supported road widths release every sidewalk support body', () => {
  const scene = new THREE.Scene();
  const simulation = new CarSimulation();
  const widths = [12, 15, 20, 30, 15, 12, 20, 30, 15, 15];
  let referenceAtFifteen = null;
  for (const roadWidth of widths) {
    const city = createCityScene(scene, simulation, createCityPlan(undefined, { roadWidth }));
    const state = {
      bodies: city.staticBodies.length,
      supports: city.staticBodies.filter(body => body.wheelSupport).length,
      visuals: city.group.children.filter(child => child.name.startsWith('Sidewalk') || child.name === 'Curb top edges').length,
    };
    if (roadWidth === 15) {
      if (referenceAtFifteen === null) referenceAtFifteen = state;
      else assert.deepEqual(state, referenceAtFifteen);
    }
    city.dispose();
    assert.equal(scene.children.length, 0);
    assert.equal(simulation.world.bodies.length, 2);
  }
});

test('a vehicle settles at the same suspension height above road and sidewalk tops', () => {
  const run = simulation => { for (let i = 0; i < 360; i++) simulation.step({ brake: 0.32 }, STEP); };
  const road = new CarSimulation({ spawn: { x: 0, y: 0.96, z: 0, yaw: 0 } });
  const sidewalk = new CarSimulation({ spawn: { x: 0, y: 0.96, z: 0, yaw: 0 } });
  sidewalk.addStaticBox({ x: 0, y: 0.0675, z: 0, halfX: 5, halfY: 0.0825, halfZ: 5, wheelSupport: true });
  run(road); run(sidewalk);
  assert.equal(road.telemetry().grounded, 4);
  assert.equal(sidewalk.telemetry().grounded, 4);
  assert.ok(Math.abs((sidewalk.telemetry().position.y - road.telemetry().position.y) - 0.15) < 0.02);
  assert.ok(sidewalk.wheels.every(wheel => Math.abs(wheel.result.hitPointWorld.y - 0.15) < 1e-6));
  const curb = sidewalk.staticBodies.at(-1);
  assert.equal(curb.collisionFilterGroup, 1);
  assert.equal(curb.wheelSupport, true);
  assert.equal(sidewalk.removeStaticBox(curb), true);
  assert.equal(sidewalk.world.bodies.includes(curb), false);
  assert.equal(sidewalk.removeStaticBox(curb), false);
});

test('a 14.4 km/h approach and retreat cross a 15 cm curb without launching or losing wheel contact', () => {
  const simulation = new CarSimulation({ spawn: { x: -4, y: 0.96, z: 0, yaw: Math.PI / 2 } });
  simulation.addStaticBox({ x: 5, y: 0.0675, z: 0, halfX: 5, halfY: 0.0825, halfZ: 5, wheelSupport: true });
  simulation.body.velocity.x = 4;
  let peakY = -Infinity;
  for (let i = 0; i < 360; i++) {
    simulation.step({}, STEP);
    peakY = Math.max(peakY, simulation.body.position.y);
  }
  assert.ok(simulation.body.position.x > 5);
  assert.ok(Math.abs(simulation.body.position.y - 1.018) < 0.025);
  assert.equal(simulation.telemetry().grounded, 4);
  assert.ok(peakY < 1.1);

  simulation.body.velocity.x = -4;
  for (let i = 0; i < 360; i++) simulation.step({}, STEP);
  assert.ok(simulation.body.position.x < 0);
  assert.ok(Math.abs(simulation.body.position.y - 0.868) < 0.03);
  assert.equal(simulation.telemetry().grounded, 4);
  assert.ok(Number.isFinite(simulation.body.position.y));
});
