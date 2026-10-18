import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpikeWorld, STEP } from '../tools/multiplayer-spike/world.js';
import { PredictionWorld } from '../src/multiplayer/prediction-world.js';
import { encodeFrame, decodeFrame } from '../src/multiplayer/frame-codec.js';
import { createCityScene } from '../src/city-scene.js';
import { StreetVisuals } from '../src/multiplayer/street-visuals.js';
import { captureStreet } from '../src/multiplayer/street-world.js';
import { CarDeformation } from '../src/car-deformation.js';

const frame=w=>decodeFrame(encodeFrame(w.snapshot()));
const idle={steer:0,throttle:0,brake:0};

test('signed server manifest matches every rendered destructible instance, including tree crowns and signals',()=>{
  const world=new SpikeWorld({seed:42,npcCount:0}),registry=new StreetVisuals();
  const scene=createCityScene(new THREE.Scene(),{addStaticBox:()=>{},addStaticConvex:()=>{},removeStaticBox:()=>{}},world.plan,[],{propRegistry:registry,destructibleTrees:true});
  try{
    assert.equal(registry.entries.size,world.colliders.props.length);
    for(const p of world.colliders.props){const v=registry.entries.get(p.id);assert.ok(v,p.id);for(const k of ['type','x','y','z','yaw'])assert.equal(v[k],p[k],`${p.id}:${k}`);}
    const tree=world.props.entries.find(e=>e.type==='tree');
    world.props.detach(tree,{body:{position:{y:1}}},{x:0,z:1},60);registry.sync(world.props);
    assert.equal(registry.entries.get(tree.id).state,'detached');
    world.props.remove(tree);registry.sync(world.props);assert.equal(registry.entries.get(tree.id).state,'removed');
    const signal=world.props.entries.find(e=>e.type==='signal');world.props.remove(signal);registry.sync(world.props);
    const approach=scene.signalApproaches.find(a=>`signal:${a.nodeId}:${a.fromId}`===signal.id);assert.equal(approach.destroyed,true);
  }finally{scene.dispose();world.dispose();}
});

for(const type of ['bin','bench','lamp','signal','tree'])test(`${type}: server impact, local prediction, rewind and late-join removal agree`,()=>{
  const server=new SpikeWorld({seed:42,npcCount:0,playerCount:3}),p=[...server.players.values()][0];
  const prop=server.props.entries.find(e=>e.type===type),predicted=new PredictionWorld(server.colliders,p.id);
  // An operator-only fixture: no public protocol accepts these transforms.
  const fx=Math.sin(prop.yaw),fz=Math.cos(prop.yaw);
  p.sim.body.position.set(prop.x-fx*2.5,prop.y+.65,prop.z-fz*2.5);p.sim.body.quaternion.setFromEuler(0,prop.yaw,0);p.sim.body.velocity.set(fx*20,0,fz*20);
  for(const other of [...server.players.values()].slice(1))other.sim.body.position.set(30+server.players.size*20,1,Number(other.id.at(-1))*20);
  const initial=frame(server);predicted.restore(initial);
  try{
    for(let t=0;t<12;t++){
      server.input(p.id,{seq:t,...idle});server.step();predicted.step(p.id,idle);
    }
    const index=server.props.entries.indexOf(prop),local=predicted.props.entries[index];
    assert.equal(prop.state,'detached');assert.equal(local.state,'detached');
    const first=captureStreet(predicted.props);predicted.restore(initial);
    for(let t=0;t<12;t++)predicted.step(p.id,idle);
    const repeated=captureStreet(predicted.props);
    assert.equal(repeated.length,first.length);
    for(let i=0;i<first.length;i++)first[i].forEach((n,j)=>assert.ok(Math.abs(n-repeated[i][j])<(j<2?1e-7:j<9?.025:.2), `index ${i}:${j} ${n} != ${repeated[i][j]}`));
    const late=new PredictionWorld(server.colliders,p.id);late.restore(frame(server));
    assert.equal(late.props.entries[index].state,'detached');late.dispose();
    for(let t=0;t<610;t++){server.input(p.id,{seq:12+t,...idle});server.step();}
    assert.equal(prop.state,'removed');
    predicted.restore(frame(server));assert.equal(predicted.props.entries[index].state,'removed');
    assert.equal(predicted.world.bodies.includes(predicted.props.entries[index].body),false);
    assert.ok(encodeFrame(server.snapshot()).length*20<250*1024);
  }finally{predicted.dispose();server.dispose();}
});

test('real player collision retains bounded dents for three clients and late join; each body has independent geometry',()=>{
  const server=new SpikeWorld({npcCount:0,playerCount:3}),players=[...server.players.values()];
  players.forEach((p,i)=>{p.sim.body.position.set(i===2?20:0,1,i===1?5:-5);p.sim.body.quaternion.setFromEuler(0,i===1?Math.PI:0,0);p.sim.body.velocity.set(0,0,i===0?15:i===1?-15:0);});
  try{
    for(let t=0;t<100;t++){for(const p of players)server.input(p.id,{seq:t,...idle});server.step();}
    const state=frame(server),hit=state.actors.get(players[0].id);
    assert.ok(hit.dents.length>0);assert.ok(hit.dents.length<=32);assert.equal(players[0].sim.impactEvents.length,0);
    const template=new THREE.BoxGeometry(2,1,4.4,12,6,24),baseline=template.attributes.position.array.slice(),bodies=[];
    for(let client=0;client<3;client++){
      const dents=frame(server).actors.get(players[0].id).dents,geometry=template.clone(),deform=new CarDeformation(geometry,new THREE.Matrix4());
      deform.apply(dents);assert.notDeepEqual(geometry.attributes.position.array,baseline);bodies.push({geometry,deform});
    }
    assert.deepEqual(bodies[0].geometry.attributes.position.array,bodies[1].geometry.attributes.position.array);
    bodies[0].deform.restore();assert.deepEqual(bodies[0].geometry.attributes.position.array,baseline);
    assert.notDeepEqual(bodies[1].geometry.attributes.position.array,baseline);assert.deepEqual(template.attributes.position.array,baseline);
    players[0].sim.reset();players[0].generation++;
    assert.equal(frame(server).actors.get(players[0].id).dents.length,0);
    server.step();assert.equal(players[0].dents.length,0);assert.ok(players[1].dents.length>0);
    for(const b of bodies)b.geometry.dispose();template.dispose();
  }finally{server.dispose();}
});
