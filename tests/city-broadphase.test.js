import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cannon-es';
import { CityBroadphase } from '../src/city-broadphase.js';
import { CarSimulation, STEP } from '../src/vehicle.js';

const replaceBroadphase = (world, Broadphase) => {
  world.removeEventListener('addBody', world.broadphase._addBodyHandler);
  world.removeEventListener('removeBody', world.broadphase._removeBodyHandler);
  world.broadphase = new Broadphase(world);
};

test('indexed queries match Cannon for boxes, convex supports, planes and moving bodies on all axes', () => {
  const sim = new CarSimulation();
  for (let i = 0; i < 80; i++) sim.addStaticBox({ x: (i % 10 - 5) * 8, y: .1, z: (Math.floor(i / 10) - 4) * 8,
    halfX: i % 3 === 0 ? 10 : 2, halfY: .1, halfZ: 2, yaw: i * .1, wheelSupport: true });
  // A large finite body must use the same safe path as the infinite ground plane.
  sim.addStaticBox({ x: 0, y: -5, z: 0, halfX: 500, halfY: .1, halfZ: 500, wheelSupport: true });
  sim.addStaticConvex({ x: 3, y: 0, z: 3, wheelSupport: true,
    vertices: [[-1, 0, -1], [1, 0, -1], [0, 0, 1], [-1, .3, -1], [1, .3, -1], [0, .3, 1]],
    faces: [[0, 1, 2], [5, 4, 3], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]] });
  const reference = new C.SAPBroadphase(sim.world);
  const indexedBroadphase = sim.world.broadphase;
  const from = new C.Vec3(), to = new C.Vec3();
  for (const axis of [0, 1, 2]) {
    sim.world.broadphase.axisIndex = reference.axisIndex = axis;
    sim.world.broadphase.dirty = reference.dirty = true;
    for (let i = 0; i < 180; i++) {
      const x = (i * 17 % 95) - 47, z = (i * 31 % 85) - 42;
      const aabb = new C.AABB({ lowerBound: new C.Vec3(x, -.2, z), upperBound: new C.Vec3(x + 3, 4, z + 3) });
      assert.deepEqual(sim.world.broadphase.aabbQuery(sim.world, aabb), reference.aabbQuery(sim.world, aabb));
      from.set(x, 3, z); to.set(x + .6, -6, z + .4);
      const indexed = new C.RaycastResult(), native = new C.RaycastResult();
      sim.world.broadphase.raycastClosest(sim.world,from, to, { collisionFilterMask: 1, skipBackfaces: true }, indexed);
      assert.equal(sim.world.broadphase.queryMask,-1);
      sim.world.broadphase = reference;
      sim.world.raycastClosest(from, to, { collisionFilterMask: 1, skipBackfaces: true }, native);
      sim.world.broadphase = indexedBroadphase;
      assert.equal(indexed.hasHit, native.hasHit);
      assert.equal(indexed.body, native.body);
      assert.ok(indexed.hitPointWorld.distanceTo(native.hitPointWorld) < 1e-10);
      assert.ok(indexed.hitNormalWorld.distanceTo(native.hitNormalWorld) < 1e-10);
    }
  }
});

test('masked ray failures restore general query/contact masks',()=>{
  const sim=new CarSimulation(),broadphase=sim.world.broadphase;
  const original=sim.world.raycastClosest;
  sim.world.raycastClosest=()=>{throw Error('fixture');};
  assert.throws(()=>broadphase.raycastClosest(sim.world,new C.Vec3(),new C.Vec3(0,-2,0),{collisionFilterMask:1,collisionFilterGroup:2},new C.RaycastResult()),/fixture/);
  assert.equal(broadphase.queryMask,-1);assert.equal(broadphase.queryGroup,-1);
  sim.world.raycastClosest=original;
  const result=broadphase.aabbQuery(sim.world,new C.AABB({lowerBound:new C.Vec3(-3,-3,-3),upperBound:new C.Vec3(3,3,3)}));
  assert.ok(result.includes(sim.body));
});

test('pair generation includes every eligible AABB overlap and preserves SAP pair order', () => {
  const world = new C.World(); world.broadphase = new CityBroadphase(world);
  for (let i = 0; i < 100; i++) {
    const body = new C.Body({ mass: i % 7 ? 0 : 1 });
    body.addShape(new C.Box(new C.Vec3(1 + i % 5, 1, 1 + i % 3)));
    body.position.set(i * 19 % 31, 0, i * 13 % 29);
    if (i % 14 === 0) body.sleep();
    world.addBody(body);
  }
  for (const indexed of [false,true]) for (const axis of [0, 1, 2]) {
    const broadphase = world.broadphase;
    broadphase.indexedPairs=indexed;
    broadphase.axisIndex = axis; broadphase.dirty = true;
    const first = [], second = []; broadphase.collisionPairs(world, first, second);
    const expected = [];
    for (let i = 0; i < broadphase.axisList.length; i++) for (let j = i + 1; j < broadphase.axisList.length; j++) {
      const a = broadphase.axisList[i], b = broadphase.axisList[j];
      if (broadphase.needBroadphaseCollision(a, b) && a.aabb.overlaps(b.aabb)) expected.push([a.id, b.id]);
    }
    assert.deepEqual(first.map((body, i) => [body.id, second[i].id]), expected);
  }
});

test('static grid updates on removal, replacement, transform invalidation and wide queries', () => {
  const sim = new CarSimulation(), query = new C.AABB({ lowerBound: new C.Vec3(-2, 0, -2), upperBound: new C.Vec3(2, 3, 2) });
  const add = x => sim.addStaticBox({ x, y: 1, z: 0, halfX: 1, halfY: 1, halfZ: 1, wheelSupport: true });
  const first = add(0);
  assert.ok(sim.world.broadphase.aabbQuery(sim.world, query).includes(first));
  sim.removeStaticBox(first);
  const next = add(100);
  assert.ok(!sim.world.broadphase.aabbQuery(sim.world, query).includes(first));
  next.position.x = 0; next.aabbNeedsUpdate = true; sim.world.broadphase.dirty = true;
  assert.ok(sim.world.broadphase.aabbQuery(sim.world, query).includes(next));
  const wide = new C.AABB({ lowerBound: new C.Vec3(-1000, -1000, -1000), upperBound: new C.Vec3(1000, 1000, 1000) });
  assert.equal(sim.world.broadphase.aabbQuery(sim.world, wide).length, sim.world.bodies.length);
  sim.removeStaticBox(next); sim.world.broadphase.aabbQuery(sim.world, query);
  assert.equal(sim.world.broadphase.staticBounds.has(next), false);
});

test('city broadphase retains chassis, suspension and curb motion of the original solver', () => {
  const indexed = new CarSimulation(), native = new CarSimulation();
  replaceBroadphase(native.world, C.SAPBroadphase);
  for (const sim of [indexed, native]) {
    sim.addStaticBox({ x: 0, y: .075, z: 9, halfX: 4, halfY: .075, halfZ: 4, wheelSupport: true });
    sim.addStaticBox({ x: -3, y: 1, z: 20, halfX: 1, halfY: 1, halfZ: 10 });
  }
  for (let tick = 0; tick < 1200; tick++) {
    const input = { throttle: tick < 700 ? .3 : 0, brake: tick > 900 ? 1 : 0,
      steer: tick > 350 && tick < 550 ? -.2 : 0 };
    indexed.step(input, STEP); native.step(input, STEP);
    assert.ok(indexed.body.position.distanceTo(native.body.position) < 1e-7, `position at tick ${tick}`);
    assert.ok(indexed.body.velocity.distanceTo(native.body.velocity) < 1e-7, `velocity at tick ${tick}`);
  }
});
