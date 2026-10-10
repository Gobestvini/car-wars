import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCityPlan } from '../src/city-generator.js';
import { createSurfaceHeightSampler } from '../src/road-surface.js';
import { conformTrackSegment } from '../src/track-surface.js';
import { TireTracks, createTrackSection, buildSectionSegment } from '../src/tire-tracks.js';

const surface = createSurfaceHeightSampler(createCityPlan());
function segment(a, b) {
  const normal = { x: -(b.z-a.z), z: b.x-a.x };
  return buildSectionSegment(createTrackSection(a, normal), createTrackSection(b, normal), 2, 3, .4, 1);
}
function meshFor(parts) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(parts.flatMap(p=>p.positions), 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
}
function assertOnSurface(mesh, x, z) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0,-1,0));
  const hit = ray.intersectObject(mesh)[0];
  assert.ok(hit, `missing decal at ${x},${z}`);
  assert.ok(Math.abs(hit.point.y-surface(x,z))<1e-5, `decal clips or floats at ${x},${z}: ${hit.point.y}`);
}

test('curb subdivision covers both flat surfaces without bridging, in either direction and obliquely',()=>{
  for(const [a,b] of [
    [{x:0,z:82.4},{x:0,z:82.7}], [{x:0,z:82.7},{x:0,z:82.4}],
    [{x:-.2,z:82.3},{x:.2,z:82.7}],
    [{x:82.98,z:82.98},{x:83.2,z:83.2}],
  ]) {
    const parts=conformTrackSegment(segment(a,b),surface), mesh=meshFor(parts);
    assert.ok(parts.length>1 && parts.length<=5);
    for(const t of [.1,.3,.6,.8,.95]) assertOnSurface(mesh,a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t);
    assert.ok(parts.flatMap(p=>p.uvs).every(v=>v>=0 && v<=1));
    assert.ok(parts.flatMap(p=>p.births).every(v=>v>=2 && v<=3));
    assert.ok(parts.flatMap(p=>p.fades).every(v=>v>=.4 && v<=1));
    mesh.geometry.dispose(); mesh.material.dispose();
  }
});

test('surface-aware terminal caps cross the curb, and clipping cannot overwrite a live ring slot',()=>{
  const tracks=new TireTracks(new THREE.Scene(),32,{surfaceHeight:surface});
  const section=createTrackSection({x:0,z:82.4},{x:1,z:0},.29,surface(0,82.4));
  const strip={head:0,headPoint:{center:{x:0,z:82.4},section},headBirth:3,
    headNormal:{x:1,z:0},headDirection:{x:0,z:1},length:1};
  tracks.endStrip(strip);
  const mesh=meshFor([{positions:[...tracks.positions.slice(0,tracks.count*18)]}]);
  assertOnSurface(mesh,0,82.55); assertOnSurface(mesh,0,82.75);
  tracks.count=tracks.capacity-2; tracks.cursor=30; tracks.time=10; tracks.births.fill(2);
  const before=[...tracks.positions];
  const crossing={headPoint:{center:{x:0,y:surface(0,82.4),z:82.4},section},headBirth:3,length:1};
  assert.equal(tracks.appendSegment(crossing,{x:0,z:82.7}),false);
  assert.deepEqual([...tracks.positions],before);
  assert.equal(tracks.count,30); assert.equal(tracks.cursor,30);
  tracks.time=48;
  assert.equal(tracks.canWriteSegments(5),true);
  mesh.geometry.dispose();mesh.material.dispose();tracks.dispose();
});
