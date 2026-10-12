import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCityPlan } from '../src/city-generator.js';
import { createCityBoundary } from '../src/city-boundary.js';
import { containsCityPoint } from '../src/city-layout.js';
import { createRoadSurfaceRectangles } from '../src/road-surface.js';
import { createRectangleUnionEdges } from '../src/road-surface.js';
import { CITY_SHAPES } from '../src/city-layout.js';
import { createCityScene } from '../src/city-scene.js';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { validateSpawnGeometry } from '../src/vehicle-spawn.js';
const overlaps=(a,b)=>a.minX<b.maxX-1e-7&&a.maxX>b.minX+1e-7&&a.minZ<b.maxZ-1e-7&&a.maxZ>b.minZ+1e-7;
const rect=b=>({minX:b.x-b.width/2,maxX:b.x+b.width/2,minZ:b.z-b.depth/2,maxZ:b.z+b.depth/2});

test('L/T/U/plus contours and very short edges are covered without gaps',()=>{
  for(const type of ['L','T','U','+']) {
    const territory=CITY_SHAPES[type].map(([x,z])=>({minX:x*50,maxX:(x+1)*50,minZ:z*50,maxZ:(z+1)*50}));
    const contour=createRectangleUnionEdges(territory),boundary=createCityBoundary({seed:1,contour});
    for(const [segment,e]of contour.entries()) assert.ok(boundary.some(b=>b.segment===segment));
    assert.ok(boundary.every(b=>!territory.some(r=>overlaps(rect(b),r))));
  }
  const buildings=createCityBoundary({seed:2,contour:[{axis:'x',value:0,min:0,max:.5,side:'north'}]});
  assert.equal(buildings.length,1);assert.equal(buildings[0].width,.5);
});

test('100 seeds at every width have complete contour coverage, exterior footprints and safe streets/spawn',()=>{
  for(let seed=0;seed<100;seed++)for(const roadWidth of [12,15,30]) {
    const plan=createCityPlan(seed,{roadWidth}),boundary=plan.boundaryBuildings;
    assert.deepEqual(boundary,createCityBoundary(plan));assert.ok(boundary.length>50);
    const roads=createRoadSurfaceRectangles(plan,plan.bounds,roadWidth,{centerX:0,centerZ:0,width:50,depth:50});
    for(const b of boundary) {
      assert.ok(b.height>=24&&b.height<=45);
      assert.ok(!roads.some(r=>overlaps(rect(b),r)),'tower must not enter asphalt');
      assert.ok(!plan.territory.some(r=>overlaps(rect(b),r)),'tower must be on exterior side');
      assert.equal(validateSpawnGeometry({position:{x:b.x,y:0,z:b.z},
        obstacles:boundary.map(b=>({x:b.x,z:b.z,halfX:b.width/2,halfZ:b.depth/2}))}).ok,false);
    }
    for(const [segment,e]of plan.contour.entries()) {
      const tiles=boundary.filter(b=>b.segment===segment).map(b=>e.axis==='x'?[b.x-b.width/2,b.x+b.width/2]:[b.z-b.depth/2,b.z+b.depth/2]).sort((a,b)=>a[0]-b[0]);
      assert.ok(Math.abs(tiles[0][0]-e.min)<1e-7);assert.ok(Math.abs(tiles.at(-1)[1]-e.max)<1e-7);
      for(let i=1;i<tiles.length;i++)assert.ok(tiles[i][0]<=tiles[i-1][1]+1e-7);
    }
  }
});
test('real tower collision prevents straight, seam and corner exits without coordinate clamp',()=>{
  for(const seed of [1,2,3]) {
    const plan=createCityPlan(seed),sim=new CarSimulation(),city=createCityScene(new THREE.Scene(),sim,plan);
    const towerBodies=new Set(city.staticBodies.slice(plan.buildings.length,plan.buildings.length+plan.boundaryBuildings.length));
    // Test every straight section and both ends: convex/concave contour joins.
    for(const edge of plan.contour) for(const t of [.15,.5,.85]) {
      const sign=edge.side==='north'||edge.side==='west'?1:-1,along=edge.min+(edge.max-edge.min)*t;
      const x=edge.axis==='x'?along:edge.value-sign*9,z=edge.axis==='x'?edge.value-sign*9:along;
      sim.spawn={x,y:.96,z,yaw:edge.axis==='x'?(sign>0?0:Math.PI):(sign>0?Math.PI/2:-Math.PI/2)};sim.reset();
      sim.body.velocity.set(edge.axis==='z'?sign*18:0,0,edge.axis==='x'?sign*18:0);
      let contacted=false;
      for(let i=0;i<240;i++){sim.step({throttle:.4},STEP);contacted ||= sim.world.contacts.some(c=>(c.bi===sim.body&&towerBodies.has(c.bj))||(c.bj===sim.body&&towerBodies.has(c.bi)));
        assert.ok(containsCityPoint(plan,sim.body.position.x,sim.body.position.z));}
      assert.ok(contacted);
    }
    const tower=city.entries.find(e=>e.boundary);
    assert.ok(tower);const before=sim.world.bodies.length;
    city.occlusion.startProxy(tower,tower.caps);city.occlusion.finishProxy(tower,tower.caps);
    assert.equal(sim.world.bodies.length,before);
    assert.equal(city.staticBodies.filter(b=>!b.wheelSupport).length,plan.buildings.length+plan.boundaryBuildings.length);
    city.dispose();assert.equal(sim.world.bodies.length,2);
  }
});
