import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cannon-es';
import * as THREE from 'three';
import { createRoundedSidewalkLayout, containsRoundedSidewalk, createSidewalkSupportBoxes,
  createSidewalkSupportPrisms, createRoadSurfaceRectangles, createSurfaceHeightSampler,
  ROAD_SURFACE_HEIGHTS, sidewalkCornerPolygons } from '../src/road-surface.js';
import { createCityPlan } from '../src/city-generator.js';
import { CarSimulation, STEP } from '../src/vehicle.js';
import { TireTracks } from '../src/tire-tracks.js';
import { createSidewalkVisuals } from '../src/sidewalk-visuals.js';

function fixture(directions, width, walk = 2, transform = p => p, length = 50) {
  const from = transform({ x: 0, z: 0 });
  const roadSegments = directions.map(([x,z]) => ({ from, to: transform({ x: x * length, z: z * length }) }));
  return { roadSegments, roadWidth: width, sidewalkWidth: walk, bounds: 210, roads: [-25,25], blockPitch: 50 };
}
function layout(plan, plaza = null) {
  return createRoundedSidewalkLayout(plan, plan.bounds, plan.roadWidth, plan.sidewalkWidth, plaza);
}

test('L inner/outer and T/X roadside corners follow geometry under rotations and reflections', () => {
  for (const width of [12,15,30]) for (const walk of [.3,2,4])
    for (const reflect of [-1,1]) for (let turn = 0; turn < 4; turn++) {
      const transform = ({x,z}) => {
        x *= reflect;
        for (let i=0;i<turn;i++) [x,z]=[-z,x];
        return {x,z};
      };
      const half=width/2,r=Math.min(2,walk);
      const l=layout(fixture([[1,0],[0,1]],width,walk,transform));
      const expected = [[half,half,'convex'],[-half,-half,'concave']];
      for (const [x,z,type] of expected) {
        const p=transform({x,z});
        assert.ok(l.corners.some(c=>c.type===type&&Math.hypot(c.point.x-p.x,c.point.z-p.z)<1e-7),`${type} L corner`);
      }
      // Independent samples: cut the inner acute point; the reverse outer
      // fillet retains the near notch but leaves its circular centre as road.
      for (const [x,z,expected] of [[half+.1*r,half+.1*r,false],
        [half+.9*r,half+.9*r,true],[-half+.1*r,-half+.1*r,true],[-half+.9*r,-half+.9*r,false]]) {
        const p=transform({x,z});assert.equal(containsRoundedSidewalk(l,p.x,p.z),expected);
      }
      const t=layout(fixture([[1,0],[-1,0],[0,1]],width,walk,transform));
      const center=transform({x:0,z:0});
      const local=t.corners.filter(c=>Math.hypot(c.point.x-center.x,c.point.z-center.z)<width);
      assert.equal(local.filter(c=>c.roadFacing).length,2,'T has two roadside fillets, not four');
      assert.ok(local.filter(c=>c.roadFacing).every(c=>c.type==='convex'));
      const x=layout(fixture([[1,0],[-1,0],[0,1],[0,-1]],width,walk,transform));
      const central=x.corners.filter(c=>Math.hypot(c.point.x-center.x,c.point.z-center.z)<width&&c.roadFacing);
      assert.equal(central.length,4);assert.ok(central.every(c=>c.type==='convex'));
    }
});

test('straight continuations have no phantom bends; terminals close, short segments clamp radius, zero width is empty', () => {
  for (const width of [12,15,30]) {
    const straight=layout(fixture([[-1,0],[1,0]],width));
    assert.equal(straight.corners.filter(c=>Math.hypot(c.point.x,c.point.z)<width).length,0);
    assert.equal(straight.joins.filter(j=>j.type==='terminal').length,2);
    const end=layout(fixture([[1,0]],width));
    assert.equal(end.joins.filter(j=>j.type==='terminal').length,2);
    assert.equal(end.corners.filter(c=>c.roadFacing&&c.type==='concave').length,4);
    assert.equal(end.corners.filter(c=>!c.roadFacing&&c.type==='convex').length,4);
    const short=layout(fixture([[1,0]],width,.3,p=>p,.5));
    assert.ok(short.corners.every(c=>c.radius<=.3&&c.radius>0));
    const empty=layout(fixture([[1,0]],width,0));
    assert.deepEqual(empty.corners,[]);assert.deepEqual(empty.rectangles,[]);
  }
});

test('convex decompositions, rendered surface and sampler agree at both sides of each fillet', () => {
  for (const width of [12,15,30]) {
    const plan=fixture([[1,0],[0,1]],width,2,p=>({x:p.x+100,z:p.z+100}));
    const walks=layout(plan),sim=new CarSimulation({damage:false});
    for(const box of createSidewalkSupportBoxes(walks.rectangles))sim.addStaticBox(box);
    const shapes=createSidewalkSupportPrisms(walks.corners);
    for(const shape of shapes)sim.addStaticConvex(shape);
    const sample=createSurfaceHeightSampler(plan);
    for(const corner of walks.corners) {
      for(const fraction of [.1,.9]) {
        const x=corner.point.x+corner.sx*corner.radius*fraction;
        const z=corner.point.z+corner.sz*corner.radius*fraction;
        const expected=corner.type==='concave'?fraction===.1:fraction===.9;
        const result=new C.RaycastResult();
        sim.world.raycastClosest(new C.Vec3(x,1,z),new C.Vec3(x,-1,z),{collisionFilterMask:1},result);
        assert.equal(result.body?.wheelSupport===true,expected,`ray ${corner.type}`);
        const y=expected?ROAD_SURFACE_HEIGHTS.sidewalkVisual+.004:corner.roadFacing?ROAD_SURFACE_HEIGHTS.road+.004:-.015+.004;
        assert.ok(Math.abs(sample(x,z)-y)<1e-7,`sampler ${corner.type}`);
      }
      for(const polygon of sidewalkCornerPolygons(corner)) {
        const x=polygon.reduce((s,p)=>s+p.x,0)/polygon.length,z=polygon.reduce((s,p)=>s+p.z,0)/polygon.length;
        assert.ok(containsRoundedSidewalk(walks,x,z));
      }
    }
    const material=new THREE.MeshStandardMaterial(),curb=new THREE.MeshStandardMaterial();
    const meshes=createSidewalkVisuals(THREE,walks,createRoadSurfaceRectangles(plan,210,width),material,curb);
    assert.ok(meshes.length<=5);
    for(const mesh of meshes) {
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
      if(['Rounded sidewalk corners','Rounded sidewalk asphalt','Curb top edges'].includes(mesh.name))
        assert.ok([...mesh.geometry.attributes.normal.array].filter((_,i)=>i%3===1).every(y=>y>.99),mesh.name);
      if(mesh.name==='Curb top edges') {
        const p=mesh.geometry.attributes.position;
        for(let i=0;i<p.count;i++)assert.ok(containsRoundedSidewalk(walks,p.getX(i),p.getZ(i)),`trim (${p.getX(i)},${p.getZ(i)})`);
      }
    }
    for(const mesh of meshes)mesh.geometry.dispose();
    for(const m of new Set(meshes.map(m=>m.material)))m.dispose();
    for(const body of [...sim.staticBodies])sim.removeStaticBox(body);
    assert.equal(sim.world.bodies.length,2);
  }
});

test('real irregular maps expose both types and leave the spawn plaza clear', () => {
  for (const seed of [1,2,3,42]) for(const width of [12,15,30]) {
    const plan=createCityPlan(seed,{roadWidth:width}),plaza={centerX:0,centerZ:0,width:50,depth:50};
    const walks=layout(plan,plaza);
    assert.ok(walks.corners.some(c=>c.type==='convex'&&c.roadFacing));
    assert.ok(walks.corners.some(c=>c.type==='concave'&&c.roadFacing));
    for(let x=-24;x<=24;x+=3)for(let z=-24;z<=24;z+=3)assert.equal(containsRoundedSidewalk(walks,x,z),false);
    assert.deepEqual(walks,layout(plan,plaza));
  }
});

test('slow wheels cross both fillets and skid strips conform to their visible heights', () => {
  const plan=fixture([[1,0],[0,1]],15,2,p=>({x:p.x+100,z:p.z+100}));
  const walks=layout(plan),sample=createSurfaceHeightSampler(plan);
  for(const type of ['convex','concave']) {
    const corner=walks.corners.find(c=>c.type===type&&c.roadFacing);
    const direction=type==='convex'?1:-1;
    const nx=corner.sx*direction/Math.SQRT2,nz=corner.sz*direction/Math.SQRT2;
    const sim=new CarSimulation({damage:false,spawn:{x:corner.point.x-nx*3,z:corner.point.z-nz*3,y:.96,yaw:Math.atan2(nx,nz)}});
    for(const box of createSidewalkSupportBoxes(walks.rectangles))sim.addStaticBox(box);
    for(const prism of createSidewalkSupportPrisms(walks.corners))sim.addStaticConvex(prism);
    let raised=false,road=false,maxRise=0;
    for(let i=0;i<480;i++) {
      sim.body.velocity.x=nx*2;sim.body.velocity.z=nz*2;
      sim.step({},STEP);
      maxRise=Math.max(maxRise,sim.body.position.y);
      for(const wheel of sim.wheels)if(wheel.grounded) {
        raised ||= Math.abs(wheel.result.hitPointWorld.y-.15)<1e-5;
        road ||= Math.abs(wheel.result.hitPointWorld.y)<1e-5;
      }
    }
    assert.ok(raised&&road,`wheel crosses road and ${type} slab`);
    assert.ok(maxRise<1.3,'curb does not launch a slowly crossing vehicle');
    const tracks=new TireTracks(new THREE.Scene(),512,{surfaceHeight:sample});
    for(let i=0;i<35;i++) {
      const fraction=-.5+i*.06;
      const position={x:corner.point.x+corner.sx*corner.radius*fraction,z:corner.point.z+corner.sz*corner.radius*fraction};
      const wheel={position,grounded:true,slip:.3,lateral:3.2,longitudinal:8};
      for(let substep=0;substep<4;substep++)tracks.update([wheel],true,STEP);
    }
    tracks.prepareRender();assert.ok(tracks.count>0);
    const positions=tracks.mesh.geometry.attributes.position;
    let hasRoad=false,hasWalk=false;
    for(let i=0;i<tracks.mesh.geometry.drawRange.count;i++) {
      const y=positions.getY(i),x=positions.getX(i),z=positions.getZ(i);
      // Transition triangles may share a boundary vertex on the lower side;
      // neither surface can be bridged by a triangle at an intermediate height.
      assert.ok(Math.abs(y-.009)<1e-5||Math.abs(y-.159)<1e-5||Math.abs(y+.011)<1e-5);
      // The bounded boundary search and float32 upload can put a boundary
      // vertex a fraction of a millimetre on the other side of the curb.
      const nearbyHeight=Math.max(...[-.001,0,.001].flatMap(dx=>[-.001,0,.001].map(dz=>sample(x+dx,z+dz))));
      assert.ok(y<=nearbyHeight+1e-4,`strip floats at ${x},${z}: ${y} vs ${sample(x,z)}`);
      hasRoad ||= Math.abs(y-.009)<1e-5;hasWalk ||= Math.abs(y-.159)<1e-5;
    }
    assert.ok(hasRoad&&hasWalk);tracks.dispose();
    for(const body of [...sim.staticBodies])sim.removeStaticBox(body);
  }
});
