import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StreetPropFadePool } from '../src/street-prop-fade.js';
import { createPropInstanceVisual } from '../src/city-street-props.js';
import { propOpacity } from '../src/street-prop-config.js';

function fixture() {
  const parent=new THREE.Group(),pool=new StreetPropFadePool(parent);
  const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:'#adc8ef'});
  const batch=new THREE.InstancedMesh(geometry,material,30);parent.add(batch);
  for(let i=0;i<30;i++){batch.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i*3,.575,0));batch.setColorAt(i,new THREE.Color(i%2?'#337733':'#ffffff'));}
  const visual=i=>createPropInstanceVisual([{batch,index:i}],{type:'bin',x:i*3,y:.155,z:0,yaw:0},pool);
  const body=i=>({position:new THREE.Vector3(i*3,.575,0),quaternion:new THREE.Quaternion()});
  return {parent,pool,batch,geometry,material,visual,body};
}
test('one broken instance fades at full scale without changing its neighbour or shared material',()=>{
  const f=fixture(),v=f.visual(0),neighbour=new THREE.Matrix4();f.batch.getMatrixAt(1,neighbour);
  try{
    v.sync(f.body(0),propOpacity(0));
    const record=[...f.pool.active.values()][0],mesh=record.meshes[0];
    assert.equal(mesh.material.opacity,.45);assert.equal(mesh.material.transparent,true);assert.equal(mesh.material.depthWrite,false);
    assert.equal(f.material.opacity,1);assert.equal(f.material.transparent,false);assert.equal(mesh.geometry,f.geometry);
    assert.equal(mesh.matrix.determinant(),1);const pose=mesh.matrix.clone();
    v.sync(f.body(0),propOpacity(.5));assert.ok(mesh.material.opacity<.45);assert.deepEqual(mesh.matrix,pose);
    const actual=new THREE.Matrix4();f.batch.getMatrixAt(1,actual);assert.deepEqual(actual,neighbour);
    f.batch.getMatrixAt(0,actual);assert.equal(actual.determinant(),0);
    v.restore();assert.equal(f.pool.stats().active,0);f.batch.getMatrixAt(0,actual);assert.deepEqual(actual,pose);
    const next=f.visual(1);next.sync(f.body(1),.3);
    assert.equal(f.pool.stats().created,1,'compatible ghosts reuse storage');
    assert.equal(record.meshes[0].material.color.getHex(),f.material.color.clone().multiply(new THREE.Color('#337733')).getHex());
    next.hide();assert.equal(f.pool.stats().idle,1);
  }finally{f.pool.dispose();f.geometry.dispose();f.material.dispose();}
});
test('ghost proxies and idle storage remain bounded; disposal never destroys shared geometry',()=>{
  const f=fixture();let geometryDisposals=0;f.geometry.addEventListener('dispose',()=>geometryDisposals++);
  const visuals=Array.from({length:30},(_,i)=>f.visual(i));
  for(let cycle=0;cycle<4;cycle++){
    visuals.forEach((v,i)=>v.sync(f.body(i),.45));assert.equal(f.pool.stats().active,24);
    visuals.forEach(v=>v.hide());assert.equal(f.pool.stats().active,0);assert.ok(f.pool.stats().idle<=24);
  }
  assert.ok(f.pool.stats().created<=24);f.pool.dispose();f.pool.dispose();
  assert.equal(f.pool.stats().active,0);assert.equal(f.pool.stats().idle,0);assert.equal(geometryDisposals,0);
  assert.equal(f.parent.children.length,1);f.geometry.dispose();f.material.dispose();
});
