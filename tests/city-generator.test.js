import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlan, CITY_BOUNDS, ROAD_WIDTH, ROAD_CENTRES, BUILDING_SETBACK, CITY_CONFIG } from '../src/city-generator.js';
import { createRoadSurfaceRectangles } from '../src/road-surface.js';

test('city plans are deterministic for a seed and vary with seed/road width', () => {
  assert.deepEqual(createCityPlan(123), createCityPlan(123));
  assert.notDeepEqual(createCityPlan(123).buildings, createCityPlan(124).buildings);
  assert.notDeepEqual(createCityPlan(123, { roadWidth: 12 }).buildings, createCityPlan(123, { roadWidth: 30 }).buildings);
});

test('default district retains scale but uses a non-square connected street layout', () => {
  const plan = createCityPlan();
  assert.equal(CITY_BOUNDS, 210);
  assert.equal(plan.bounds * 2, 420);
  assert.equal(ROAD_WIDTH, 15);
  assert.deepEqual(ROAD_CENTRES, [-175, -125, -75, -25, 25, 75, 125, 175]);
  assert.ok(plan.buildings.length>0&&plan.buildings.length<=(plan.activeCells.length-1)*4,'no dense cell grids');
  assert.equal(plan.landmarks.length, 3);
  assert.ok(plan.roadNetwork.intersections.length>20);
  assert.ok(plan.roadNetwork.edges.length>=plan.roadNetwork.intersections.length);
  assert.ok(plan.roadNetwork.edges.every(edge => edge.length === 50));
  assert.equal(plan.roadSegments.length,plan.roadNetwork.edges.length);
  assert.ok(plan.buildings.every(building => Math.hypot(building.x, building.z) > 20));
});

test('buildings fit their blocks, stay inside walls, and clear streets at all supported widths', () => {
  for (const roadWidth of [12, 15, 20, 30]) {
    const plan = createCityPlan(20261005, { roadWidth });
    assert.equal(plan.roadWidth, roadWidth);
    const streets=createRoadSurfaceRectangles(plan,plan.bounds,roadWidth+2*(plan.sidewalkWidth+BUILDING_SETBACK),
      {centerX:0,centerZ:0,width:50,depth:50});
    for (const building of plan.buildings) {
      assert.ok(Number.isFinite(building.x + building.z + building.height));
      assert.ok(Math.abs(building.x) + building.width / 2 < plan.bounds - 5);
      assert.ok(Math.abs(building.z) + building.depth / 2 < plan.bounds - 5);
      assert.ok(Math.hypot(building.width, building.depth) > 0);
      for (const road of streets) {
        assert.ok(building.x+building.width/2<=road.minX+1e-7||building.x-building.width/2>=road.maxX-1e-7
          ||building.z+building.depth/2<=road.minZ+1e-7||building.z-building.depth/2>=road.maxZ-1e-7,
          `building ${building.id} enters an actual ${roadWidth}m street/setback`);
      }
    }
  }
});

test('merged district seams are built up instead of reserving fictitious grid streets', () => {
  for(const seed of [1,2,3,42])for(const roadWidth of [12,15,30]) {
    const plan=createCityPlan(seed,{roadWidth});
    const streets=createRoadSurfaceRectangles(plan,plan.bounds,roadWidth,{centerX:0,centerZ:0,width:50,depth:50});
    const keys=new Set(plan.roadNetwork.edges.map(e=>[e.from,e.to].sort().join('|')));
    let seams=0,filled=0;
    for(const district of plan.housingParcels.filter(d=>plan.districts[d.district].type!=='plaza'))for(const [x,z]of district.cells)
      for(const [dx,dz]of [[1,0],[0,1]]) {
        if(!district.cells.some(([a,b])=>a===x+dx&&b===z+dz))continue;
        const px=(x+(dx?1:.5))*50-175,pz=(z+(dz?1:.5))*50-175;
        seams++;
        // Normal distance to the seam, with a house near its middle. These
        // spaces previously inherited a full road-width reservation.
        if(plan.buildings.some(b=>Math.abs(b.x-px)-b.width/2<(dx?2:14)
          &&Math.abs(b.z-pz)-b.depth/2<(dz?2:14)))filled++;
      }
    assert.ok(seams>0);assert.ok(filled/seams>.85,`${seed}/${roadWidth}: ${filled}/${seams} seams`);
    for(const [i,b]of plan.buildings.entries()) {
      for(const other of plan.buildings.slice(i+1))assert.ok(Math.abs(b.x-other.x)>=(b.width+other.width)/2-1e-7
        ||Math.abs(b.z-other.z)>=(b.depth+other.depth)/2-1e-7,'foundations cannot overlap');
    }
    assert.ok(streets.length>0&&keys.size>0);
  }
});

test('internal streets divide long housing rows into at most four homes on either axis',()=>{
  for(let seed=0;seed<30;seed++)for(const roadWidth of [12,15,30]) {
    const plan=createCityPlan(seed,{roadWidth});
    for(const parcel of plan.housingParcels) {
      const houses=plan.buildings.filter(b=>b.parcelId===parcel.id);
      for(const axis of ['x','z']) {
        const other=axis==='x'?'z':'x',size=other==='x'?'width':'depth';
        for(const h of houses) {
          const line=h[other];
          assert.ok(houses.filter(b=>line>b[other]-b[size]/2&&line<b[other]+b[size]/2).length<=4,
            `seed=${seed} width=${roadWidth} parcel=${parcel.id} row=${axis}`);
        }
      }
    }
    assert.ok(plan.housingParcels.length>plan.districts.length,'large shapes have real internal streets');
  }
});

test('invalid width options fail before a city plan can be used', () => {
  for (const roadWidth of [NaN, 11, 31, Infinity]) {
    assert.throws(() => createCityPlan(1, { roadWidth }), RangeError);
  }
  assert.throws(() => createCityPlan(Number.NaN), TypeError);
});

test('city dimensions are configurable and wider footprints keep seeded heights stable', () => {
  const base = createCityPlan(20261005);
  const wider = createCityPlan(20261005, { config: { ...CITY_CONFIG, buildingFootprint: { min: 10, max: 12 } } });
  assert.equal(wider.sidewalkWidth, 2);
  assert.ok(wider.buildings.every(building => building.width >= 10 && building.width <= 12));
  assert.deepEqual(wider.buildings.map(building => building.height), base.buildings.map(building => building.height));
  assert.ok(base.buildings.every(b=>b.height>0 && Number.isFinite(b.height)));
  assert.equal(new Set(base.landmarks).size,3);
  assert.throws(() => createCityPlan(1, { config: { ...CITY_CONFIG, sidewalkWidth: -1 } }), RangeError);
  assert.throws(() => createCityPlan(1, { config: { ...CITY_CONFIG, buildingFootprint: { min: 12, max: 10 } } }), RangeError);
});
