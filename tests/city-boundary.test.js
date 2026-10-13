import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCityPlan } from '../src/city-generator.js';
import { createCityBoundary, BOUNDARY_HOUSE_GAP } from '../src/city-boundary.js';
import { containsCityPoint } from '../src/city-layout.js';
import { createRoadSurfaceRectangles } from '../src/road-surface.js';
import { createRectangleUnionEdges } from '../src/road-surface.js';
import { CITY_SHAPES } from '../src/city-layout.js';
import { createCityScene } from '../src/city-scene.js';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { validateSpawnGeometry } from '../src/vehicle-spawn.js';
const overlaps=(a,b)=>a.minX<b.maxX-1e-7&&a.maxX>b.minX+1e-7&&a.minZ<b.maxZ-1e-7&&a.maxZ>b.minZ+1e-7;
const rect=b=>({minX:b.x-b.width/2,maxX:b.x+b.width/2,minZ:b.z-b.depth/2,maxZ:b.z+b.depth/2});

test('L/T/U/plus contours have exterior houses, including an ordinary house on an isolated short edge',()=>{
  for(const type of ['L','T','U','+']) {
    const territory=CITY_SHAPES[type].map(([x,z])=>({minX:x*50,maxX:(x+1)*50,minZ:z*50,maxZ:(z+1)*50}));
    const contour=createRectangleUnionEdges(territory),boundary=createCityBoundary({seed:1,contour});
    for(const [segment]of contour.entries()) assert.ok(boundary.some(b=>b.segment===segment || b.segments?.includes(segment)));
    assert.ok(boundary.every(b=>!territory.some(r=>overlaps(rect(b),r))));
  }
  const buildings=createCityBoundary({seed:2,contour:[{axis:'x',value:0,min:0,max:.5,side:'north'}]});
  assert.equal(buildings.length,1);assert.equal(buildings[0].width,10);
});

test('100 seeds at every width have separated low houses, car-tight contour coverage and safe streets/spawn',()=>{
  for(let seed=0;seed<100;seed++)for(const roadWidth of [12,15,30]) {
    const plan=createCityPlan(seed,{roadWidth}),boundary=plan.boundaryBuildings;
    assert.deepEqual(boundary,createCityBoundary(plan));assert.ok(boundary.length>50);
    const roads=createRoadSurfaceRectangles(plan,plan.bounds,roadWidth,{centerX:0,centerZ:0,width:50,depth:50});
    for(const b of boundary) {
      assert.ok(b.height>=5.4&&b.height<=11.44);
      assert.ok(b.width >= 10 && b.width <= 12.31 && b.depth >= 10 && b.depth <= 12.31);
      assert.equal(b.crownHeight,undefined);
      assert.ok(!roads.some(r=>overlaps(rect(b),r)),'house must not enter asphalt');
      assert.ok(!plan.territory.some(r=>overlaps(rect(b),r)),'house must be on exterior side');
      assert.equal(validateSpawnGeometry({position:{x:b.x,y:0,z:b.z},
        obstacles:boundary.map(b=>({x:b.x,z:b.z,halfX:b.width/2,halfZ:b.depth/2}))}).ok,false);
    }
    for(const [i,a]of boundary.entries()) for(const b of boundary.slice(i+1)) {
      const dx=Math.max(0,Math.abs(a.x-b.x)-(a.width+b.width)/2);
      const dz=Math.max(0,Math.abs(a.z-b.z)-(a.depth+b.depth)/2);
      assert.ok(Math.hypot(dx,dz)>=BOUNDARY_HOUSE_GAP/Math.SQRT2-1e-7,'no touching foundations, even at joins');
    }
    // A disk of radius .87 is contained in the chassis at every yaw. Its
    // expanded obstacles close the whole contour, while visible houses do not.
    for(const e of plan.contour) for(let along=e.min;along<=e.max;along+=.2) {
      const x=e.axis==='x'?along:e.value,z=e.axis==='x'?e.value:along;
      assert.ok(boundary.some(b=>{
        const dx=Math.max(0,Math.abs(x-b.x)-b.width/2),dz=Math.max(0,Math.abs(z-b.z)-b.depth/2);
        return Math.hypot(dx,dz)<.87;
      }),'all contour points blocked for the smallest chassis projection');
    }
  }
});
test('real house collision prevents straight, seam and corner exits without coordinate clamp',()=>{
  for(const seed of [1,2,3]) {
    const plan=createCityPlan(seed),sim=new CarSimulation(),city=createCityScene(new THREE.Scene(),sim,plan);
    city.propPhysics?.dispose(); // Isolate perimeter collisions from breakable street furniture.
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

test('diagonal convex/concave vertex attacks and gap attempts contact houses in forward and reverse',()=>{
  for(const seed of [1,2,3]) for(const roadWidth of [12,15,30]) {
    const plan=createCityPlan(seed,{roadWidth}), sim=new CarSimulation({damage:false});
    // Isolate the perimeter: a tree or ordinary inner building cannot mask a hole.
    const bodies=new Set(plan.boundaryBuildings.map(b=>sim.addStaticBox({x:b.x,y:b.height/2,z:b.z,
      halfX:b.width/2,halfY:b.height/2,halfZ:b.depth/2})));
    const vertices=new Map();
    for(const e of plan.contour) for(const a of [e.min,e.max]) {
      const x=e.axis==='x'?a:e.value,z=e.axis==='x'?e.value:a,key=`${x}:${z}`;
      if(!vertices.has(key))vertices.set(key,{x,z,nx:0,nz:0});
      const v=vertices.get(key),sign=e.side==='north'||e.side==='west'?1:-1;
      if(e.axis==='x')v.nz=sign;else v.nx=sign;
    }
    const targets=[...vertices.values()].flatMap(v=>[.5,1,2].map(r=>({...v,nx:v.nx*r})));
    for(const [segment,e]of plan.contour.entries()) {
      const row=plan.boundaryBuildings.filter(b=>b.segment===segment&&b.slot>=0).sort((a,b)=>e.axis==='x'?a.x-b.x:a.z-b.z);
      for(let i=1;i<row.length;i++) {
        const a=row[i-1],b=row[i],along=e.axis==='x'?(a.x+a.width/2+b.x-b.width/2)/2:(a.z+a.depth/2+b.z-b.depth/2)/2;
        const sign=e.side==='north'||e.side==='west'?1:-1;
        targets.push({x:e.axis==='x'?along:e.value,z:e.axis==='x'?e.value:along,nx:e.axis==='z'?sign:0,nz:e.axis==='x'?sign:0});
      }
    }
    for(const t of targets) for(const reverse of [false,true]) for(const speed of [2,18]) {
      const length=Math.hypot(t.nx,t.nz),nx=t.nx/length,nz=t.nz/length;
      sim.spawn={x:t.x-nx*7,z:t.z-nz*7,y:.96,yaw:Math.atan2(nx,nz)+(reverse?Math.PI:0)};sim.reset();
      assert.ok(containsCityPoint(plan,sim.body.position.x,sim.body.position.z));
      sim.body.velocity.set(nx*speed,0,nz*speed);
      let contacted=false;
      for(let step=0;step<600;step++) {
        sim.step({throttle:reverse?-.4:.4},STEP);
        contacted ||= sim.world.contacts.some(c=>(c.bi===sim.body&&bodies.has(c.bj))||(c.bj===sim.body&&bodies.has(c.bi)));
        assert.ok(containsCityPoint(plan,sim.body.position.x,sim.body.position.z),`exit seed=${seed} width=${roadWidth} target=${JSON.stringify(t)}`);
      }
      assert.ok(contacted,`no house contact seed=${seed} target=${JSON.stringify(t)}`);
    }
    for(const body of bodies)sim.removeStaticBox(body);
    assert.equal(sim.world.bodies.length,2);
  }
});
