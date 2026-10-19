import test from 'node:test';
import assert from 'node:assert/strict';
import { FollowCamera, followCameraPose } from '../src/camera-follow.js';

const near = (a,b) => assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('shared follow composition preserves the offline ground aim and viewport boundaries', () => {
  for (const [width,height,factor] of [[1440,900,1],[699,900,1.05],[700,500,1],[700,499,.82],[390,844,1.05],[844,390,.82]]) {
    const position={},target={};
    followCameraPose({x:10,y:5,z:-20},1,width,height,position,target);
    assert.deepEqual(target,{x:10,y:.5,z:-20});
    near(position.x,10+16.8*factor);near(position.y,.5+28*factor);near(position.z,-20-23.8*factor);
    followCameraPose({x:10,y:-5,z:-20},1.7,width,height,position,target);
    near(position.x-target.x,16.8*factor*1.7);near(position.y-target.y,28*factor*1.7);
  }
});
test('camera follows displayed motion immediately while only speed zoom is smoothed', () => {
  const camera=new FollowCamera();
  camera.update({x:0,z:0},0,1/60,1440,900,'p:1');
  const before={...camera.position};
  camera.update({x:8,z:-4},0,1/60,1440,900,'p:1');
  near(camera.position.x-before.x,8);near(camera.position.z-before.z,-4);
  const runs=[30,60,120].map(hz=>{
    const c=new FollowCamera();c.update({x:0,z:0},0,0,1440,900,'p:1');
    for(let i=0;i<hz;i++)c.update({x:0,z:0},110,1/hz,1440,900,'p:1');
    assert.ok(c.scale>1&&c.scale<1.7);return c.scale;
  });near(Math.max(...runs),Math.min(...runs));
});
test('new generation, player and room reset zoom without inheriting the old focus', () => {
  const camera=new FollowCamera();
  camera.update({x:0,z:0},0,0,1440,900,'p:1');camera.update({x:0,z:0},110,3,1440,900,'p:1');
  assert.ok(camera.scale>1.6);
  camera.update({x:100,z:200},110,1/60,390,844,'p:2');assert.equal(camera.scale,1);
  assert.deepEqual(camera.target,{x:100,y:.5,z:200});
  camera.update({x:-30,z:10},0,1/60,844,390,'friend:1');assert.equal(camera.scale,1);
  camera.reset();camera.update({x:0,z:0},0,1/60,1440,900,'p:1');assert.equal(camera.scale,1);
  const position={},target={};followCameraPose({x:NaN,z:Infinity},NaN,1440,900,position,target);
  assert.ok(Object.values(position).every(Number.isFinite));
});
