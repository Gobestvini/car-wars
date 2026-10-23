import test from 'node:test';
import assert from 'node:assert/strict';
import { SpikeWorld } from '../tools/multiplayer-spike/world.js';
import { PredictionWorld } from '../src/multiplayer/prediction-world.js';
import { encodeFrame, decodeFrame } from '../src/multiplayer/frame-codec.js';
import { RoomClient } from '../src/multiplayer/room-client.js';

const place = (world, actor, pickup, dx=0, y=.96) => {
  actor.sim.body.position.set(pickup.x+dx,y,pickup.z);
  actor.sim.body.quaternion.setFromEuler(0,0,0);
  actor.sim.body.velocity.setZero();actor.sim.body.angularVelocity.setZero();actor.sim.body.aabbNeedsUpdate=true;
};

test('same-tick pickup race repairs only the stable playerId winner, not join order',()=>{
  for(const ids of [['z','a'],['a','z']]){
    const world=new SpikeWorld({seed:42,npcCount:0});
    try{
      for(const id of ids)world.addPlayer(id);
      const p=world.repairs.placements[0],a=world.players.get('a'),z=world.players.get('z');
      place(world,a,p,-1.5);place(world,z,p,1.5);a.sim.damage=z.sim.damage=.5;
      world.step();
      assert.equal(p.status,'consumed');assert.equal(a.sim.damage,0);assert.equal(z.sim.damage,.5);
      assert.equal(a.repairRevision,1);assert.equal(z.repairRevision,0);assert.equal(world.repairs.repairs,1);
      world.step();assert.equal(z.sim.damage,.5);assert.equal(world.repairs.repairs,1);
    }finally{world.dispose();}
  }
});

test('healthy, disconnected and airborne cars leave the shared pickup available',()=>{
  const world=new SpikeWorld({seed:42,npcCount:0}),actor=world.addPlayer('player');
  try{
    const pickup=world.repairs.placements[0];place(world,actor,pickup);world.step();
    assert.equal(pickup.status,'available');
    actor.sim.damage=.5;world.disconnect(actor.id);world.step();assert.equal(pickup.status,'available');
    actor.connected=true;place(world,actor,pickup,0,4);world.step();assert.equal(pickup.status,'available');
    place(world,actor,pickup);world.step();assert.equal(pickup.status,'consumed');assert.equal(actor.sim.damage,0);
  }finally{world.dispose();}
});

test('repair restores real detached wheels and dents without resetting the car or other players',()=>{
  const world=new SpikeWorld({seed:42,npcCount:0}),actor=world.addPlayer('a'),other=world.addPlayer('b');
  const predicted=new PredictionWorld(world.colliders,actor.id);
  try{
    const pickup=world.repairs.placements[0];place(world,actor,pickup);
    actor.sim.damage=.8;actor.dents=[{point:{x:0,y:0,z:0},normal:{x:0,y:0,z:1},impact:{depth:.1,radius:.5}}];
    actor.sim.syncWheelPositions();
    actor.sim.detachWheelAtImpact({speed:25,point:actor.sim.wheels[0].mount,normal:{x:1,y:0,z:0}});
    const debris=actor.sim.wheels[0].detachedBody;assert.ok(debris);
    actor.sim.body.velocity.set(0,0,3);
    const generation=actor.generation,otherPose=other.sim.body.position.clone(),signature=world.signature;
    const frame=()=>decodeFrame(encodeFrame(world.snapshot()));predicted.restore(frame());
    assert.equal(predicted.actors.get(actor.id).sim.wheels[0].detached,true);
    world.step();predicted.restore(frame());
    assert.equal(actor.sim.damage,0);assert.equal(actor.dents.length,0);assert.equal(actor.generation,generation);
    assert.ok(Math.abs(actor.sim.body.position.z-pickup.z)<.1);
    assert.ok(actor.sim.body.velocity.z>2);assert.equal(other.generation,1);
    assert.ok(other.sim.body.position.distanceTo(otherPose)<.1);assert.equal(world.signature,signature);
    assert.equal(world.world.bodies.includes(debris),false);assert.ok(actor.sim.wheels.every(w=>!w.detached));
    assert.equal(predicted.actors.get(actor.id).sim.wheels[0].detached,false);
    assert.equal(predicted.actors.get(actor.id).sim.damage,0);
    actor.sim.reset();actor.generation++;world.step();assert.equal(pickup.status,'consumed');
    assert.equal(world.gameplaySnapshot().players.find(a=>a.id===actor.id).repairRevision,1);
  }finally{predicted.dispose();world.dispose();}
});

test('room teardown and a new world do not retain consumed pickups',()=>{
  for(let i=0;i<4;i++){
    const world=new SpikeWorld({seed:42,npcCount:0}),actor=world.addPlayer('a');
    const pickup=world.repairs.placements[0];assert.equal(pickup.status,'available');
    place(world,actor,pickup);actor.sim.damage=.5;world.step();assert.equal(pickup.status,'consumed');
    world.dispose();assert.equal(world.world.bodies.length,0);assert.equal(world.players.size,0);
  }
});

test('client ignores stale and malformed shared state and clears it on leave',async()=>{
  const client=new RoomClient({endpoint:'http://localhost:1'});
  const state={revision:3,tick:120,pickups:[{id:0,x:1,z:2,status:'consumed'}],players:[{id:'a',repairRevision:1}]};
  client.acceptGameplay(state);assert.equal(client.gameplay,state);
  for(const bad of [{...state,revision:2},{...state,revision:4,pickups:[{id:0,x:NaN,z:2,status:'available'}]},
    {...state,revision:4,players:[{id:'a',repairRevision:-1}]},{...state,revision:4,pickups:[state.pickups[0],state.pickups[0]]}]){
    client.acceptGameplay(bad);assert.equal(client.gameplay,state);
  }
  await client.leave();assert.equal(client.gameplay,null);
});
