import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan } from '../src/city-generator.js';
import { CITY_SHAPES, cityLayoutSignature, containsCityPoint, createCityLayout, nextRoundPlan } from '../src/city-layout.js';
import { createRoadSurfaceRectangles, createRoundedSidewalkLayout } from '../src/road-surface.js';
import { createRoadMarkings } from '../src/road-markings.js';
import { validateSpawnGeometry } from '../src/vehicle-spawn.js';

test('100 seeds at all widths give deterministic connected cyclic cities and diverse topology', () => {
  const signatures=new Set();
  assert.ok(Object.keys(CITY_SHAPES).length>=6);
  for(let seed=0;seed<100;seed++) for(const roadWidth of [12,15,30]) {
    const plan=createCityPlan(seed,{roadWidth});
    assert.deepEqual(plan,createCityPlan(seed,{roadWidth}));
    signatures.add(plan.signature);
    assert.ok(new Set(plan.districts.map(d=>d.type)).size>=3);
    assert.ok(plan.activeCells.length<49 && plan.activeCells.length>=25);
    const adjacency=new Map(plan.roadNetwork.intersections.map(n=>[n.id,[]]));
    for(const e of plan.roadNetwork.edges) {adjacency.get(e.from).push(e.to);adjacency.get(e.to).push(e.from);}
    const visited=new Set(),pending=[plan.roadNetwork.intersections[0].id];
    while(pending.length) {const id=pending.pop();if(visited.has(id))continue;visited.add(id);pending.push(...adjacency.get(id));}
    assert.equal(visited.size,adjacency.size);
    assert.ok([...adjacency.values()].every(neighbors=>neighbors.length>=2));
    // An orthogonal simple outer contour has degree two at every vertex.
    const ends=new Map();
    for(const e of plan.contour) for(const along of [e.min,e.max]) {
      const point=e.axis==='x'?`${along}:${e.value}`:`${e.value}:${along}`;
      ends.set(point,(ends.get(point)||0)+1);
    }
    assert.ok([...ends.values()].every(count=>count===2));
    const roadRects=createRoadSurfaceRectangles(plan,plan.bounds,roadWidth,{centerX:0,centerZ:0,width:50,depth:50});
    for(const r of roadRects) for(const x of [r.minX,r.maxX]) for(const z of [r.minZ,r.maxZ]) assert.ok(containsCityPoint(plan,x,z));
    for(const mark of createRoadMarkings(plan,plan.bounds,roadWidth)) {
      assert.ok(roadRects.some(r=>mark.x>=r.minX&&mark.x<=r.maxX&&mark.z>=r.minZ&&mark.z<=r.maxZ));
    }
    for(const b of plan.buildings) {
      assert.ok(containsCityPoint(plan,b.x,b.z));
      assert.ok(!roadRects.some(r=>b.x+b.width/2>r.minX&&b.x-b.width/2<r.maxX&&b.z+b.depth/2>r.minZ&&b.z-b.depth/2<r.maxZ));
    }
  }
  assert.ok(signatures.size>=20,`${signatures.size} signatures`);
});
test('20 next rounds differ while width rebuild preserves seed and topology', () => {
  let plan=createCityPlan(5);
  for(let round=0;round<20;round++) {
    const next=nextRoundPlan(createCityPlan,plan,round,{roadWidth:15});
    assert.notEqual(next.signature,plan.signature);
    const rebuilt=createCityPlan(next.seed,{roadWidth:30});
    assert.equal(rebuilt.seed,next.seed); assert.equal(rebuilt.signature,next.signature);
    plan=next;
  }
  const fallback=createCityLayout(0,15,2,{fallback:true});
  assert.equal(cityLayoutSignature(fallback),cityLayoutSignature(createCityLayout(999,15,2,{fallback:true})));
});
test('coordinate spawn rejects the cut-out corners even inside the enclosing bounds', () => {
  const plan=createCityPlan(5),bounds={minX:-210,maxX:210,minZ:-210,maxZ:210,contains:(x,z)=>containsCityPoint(plan,x,z)};
  assert.equal(validateSpawnGeometry({position:{x:-180,y:0,z:-180},bounds}).ok,false);
  assert.equal(validateSpawnGeometry({position:{x:0,y:0,z:0},bounds}).ok,true);
  const sidewalk=createRoundedSidewalkLayout(plan,210,15,2,{centerX:0,centerZ:0,width:50,depth:50});
  assert.ok(sidewalk.rectangles.length>0);
});
