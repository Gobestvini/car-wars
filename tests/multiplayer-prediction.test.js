import test from 'node:test';
import assert from 'node:assert/strict';
import { SpikeWorld, STEP } from '../tools/multiplayer-spike/world.js';
import { captureCar, restoreCar, PredictionWorld } from '../src/multiplayer/prediction-world.js';
import { ClientPrediction } from '../src/multiplayer/prediction.js';
import { encodeFrame, decodeFrame } from '../src/multiplayer/frame-codec.js';
import { validateCommands } from '../tools/multiplayer-spike/protocol.js';
import { ArrayCollisionMatrix } from 'cannon-es';

const MS=STEP*1000;
const control={steer:0,throttle:1,brake:0,handbrake:false};
function frame(world,now){const f=decodeFrame(encodeFrame(world.snapshot()));f.receivedAt=now;return f;}
function fixture(world){
  const players=[...world.players.values()];
  players.forEach((a,i)=>{a.sim.body.position.set(i===2?8:0,1,i===0?-12:i===1?12:0);
    a.sim.body.quaternion.setFromEuler(0,i===1?Math.PI:0,0);a.sim.body.velocity.set(0,0,i===0?9:i===1?-9:0);});
}

test('sparse contact cache preserves dense Cannon collision motion and damage',()=>{
  const sparse=new SpikeWorld({npcCount:0,playerCount:3}),dense=new SpikeWorld({npcCount:0,playerCount:3});
  dense.world.collisionMatrix=new ArrayCollisionMatrix();dense.world.collisionMatrixPrevious=new ArrayCollisionMatrix();
  dense.world.collisionMatrix.setNumObjects(dense.world.bodies.length);dense.world.collisionMatrixPrevious.setNumObjects(dense.world.bodies.length);
  fixture(sparse);fixture(dense);
  try{
    for(let tick=0;tick<240;tick++){
      for(const w of [sparse,dense]){for(const id of w.players.keys())w.input(id,{seq:tick,...control});w.step();}
      const a=[...sparse.players.values()],b=[...dense.players.values()];
      a.forEach((actor,i)=>{
        assert.ok(actor.sim.body.position.distanceTo(b[i].sim.body.position)<1e-9);
        assert.equal(actor.sim.damage,b[i].sim.damage);
      });
    }
  }finally{sparse.dispose();dense.dispose();}
});

test('car restore/replay preserves suspension force inputs and motion, including contact-cache rewind',()=>{
  const server=new SpikeWorld({npcCount:0,playerCount:3});fixture(server);
  const predicted=new PredictionWorld(server.colliders);
  try{
    const source=frame(server,0);predicted.restore(source);
    const local=[...server.players.keys()][0];
    const first=predicted.actors.get(local).sim;
    for(let i=0;i<90;i++)predicted.step(local,{...control,steer:.3});
    const expected=captureCar(first);predicted.restore(source);
    for(let i=0;i<90;i++)predicted.step(local,{...control,steer:.3});
    const actual=captureCar(first);
    assert.ok(Math.hypot(...expected.p.map((v,i)=>v-actual.p[i]))<1e-7);
    assert.ok(Math.hypot(...expected.v.map((v,i)=>v-actual.v[i]))<1e-7);
    const state=captureCar(first);first.throttle=-1;restoreCar(first,state);assert.equal(first.throttle,state.throttle);
  }finally{predicted.dispose();server.dispose();}
});

for(const rtt of [0,50,100,150])test(`three predicted players at simulated RTT ${rtt}ms steer immediately and share physical impacts`,()=>{
  const server=new SpikeWorld({npcCount:0,playerCount:3});fixture(server);
  const ids=[...server.players.keys()],clients=[],pending=[];let now=0,late=0,total=0,playerContacts=0,maxQueue=0;
  const initial=frame(server,0),corrections=[];
  const enqueue=(delay,fn)=>pending.push({at:now+delay,fn});
  try{
    for(const id of ids){
      const client=new ClientPrediction({colliders:server.colliders,localId:id,send:packet=>{
        const count=total++;enqueue(rtt/2+(count%3)*5,()=>{
          late+=packet.commands.filter(c=>c[0]<=server.tick).length;
          server.timedInput(id,packet);maxQueue=Math.max(maxQueue,server.players.get(id).commands.size);
        });
      }});
      client.rtt=rtt;client.receive(initial,0);clients.push(client);
    }
    let response=null,changedAt=null;
    for(let step=1;step<=1200;step++){
      now=step*MS;
      for(let i=pending.length-1;i>=0;i--)if(pending[i].at<=now){pending[i].fn();pending.splice(i,1);}
      server.step();
      if(server.world.contacts.some(c=>ids.some(id=>server.players.get(id).sim.body===c.bi)&&ids.some(id=>server.players.get(id).sim.body===c.bj)))playerContacts++;
      if(step%6===0){const snapshot=frame(server,now);enqueue(rtt/2+(step%4)*5,()=>{
        const f={...snapshot,receivedAt:now};for(const c of clients)c.receive(f,now);
      });}
      if(step%2===0){
        clients.forEach((client,i)=>{
          const steering=step>=480&&step<600?.7:step>=600&&step<720?-.7:0;
          if(i===0&&step===480)changedAt=now;
          client.advance(now,{...control,steer:i===2?steering:step>=480?steering:0,throttle:step<400?1:0,brake:step<400?0:.3});
          if(i===0&&changedAt!==null&&response===null&&client.world.actors.get(ids[0]).sim.steering>0)response=now-changedAt;
          const displayed=client.sample(now);
          assert.equal(displayed.filter(a=>a.role==='player').length,3);
          assert.ok(displayed.every(a=>a.pose.every(Number.isFinite)));
        });
      }
    }
    assert.ok(playerContacts>0,'head-on cars must collide on the authoritative server');
    assert.ok(response!==null&&response<=MS*2,`input waited ${response}ms`);
    assert.ok(maxQueue<=120);assert.ok(late<10,`${late} late physics commands`);
    for(const client of clients){
      corrections.push({...client.metrics});assert.ok(client.metrics.maxReplay<=50);
      assert.ok(client.metrics.maxCorrection<2,`large correction ${client.metrics.maxCorrection}`);
      assert.ok(client.metrics.steps>1100);
    }
    console.log(JSON.stringify({rtt,inputToSimulationMs:response,playerContacts,late,total,maxQueue,corrections}));
  }finally{clients.forEach(c=>c.dispose());server.dispose();}
});

test('prediction commands cannot choose dt, poses, invalid generations, unbounded queues or old respawn state',()=>{
  const valid={generation:1,commands:[[2,0,1,0,0]]};assert.ok(validateCommands(valid));
  for(const bad of [{...valid,dt:1},{...valid,position:[0,0,0]},{...valid,commands:[[2,NaN,1,0,0]]},
    {...valid,commands:[[2,0,1,0,0],[1,0,1,0,0]]},{...valid,commands:Array.from({length:25},(_,i)=>[i,0,1,0,0])}])assert.equal(validateCommands(bad),null);
  const server=new SpikeWorld({npcCount:0,playerCount:1}),id=[...server.players.keys()][0],actor=server.players.get(id);
  try{
    server.timedInput(id,{generation:1,commands:[[99999,0,1,0,0],[1,0,1,0,0]]});assert.equal(actor.commands.size,1);
    server.halt(id);assert.equal(actor.commands.size,0);
    actor.generation++;assert.equal(server.timedInput(id,valid),false);assert.equal(actor.commands.size,0);
  }finally{server.dispose();}
});
