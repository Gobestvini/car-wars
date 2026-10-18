import { STEP } from '../vehicle.js';
import { PredictionWorld, idleControl } from './prediction-world.js';
import { quaternionSlerp } from './snapshot-buffer.js';
import { streetMatches } from './street-world.js';

const MS=STEP*1000;
const multiplyQ=(a,b)=>[
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
  a[3]*b[1]+a[1]*b[3]+a[2]*b[0]-a[0]*b[2],
  a[3]*b[2]+a[2]*b[3]+a[0]*b[1]-a[1]*b[0],
  a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
export class ClientPrediction {
  constructor({colliders,localId,send=()=>{}}) {
    this.world=new PredictionWorld(colliders,localId);this.localId=localId;this.send=send;
    this.commands=new Map();this.errors=new Map();this.rendered=new Map();this.history=new Map();this.latest=null;
    this.rtt=80;this.clock=null;this.lastNow=null;this.accumulator=0;this.lastSent=0;
    this.metrics={steps:0,replaySteps:0,corrections:0,maxCorrection:0,maxReplay:0,lateFrames:0,replayMs:0};
  }
  observeClock(tick,now,rtt=this.rtt) {
    this.rtt=Math.max(0,Math.min(300,rtt));
    const offset=now-tick*MS-this.rtt/2;
    // The minimum-delay clock avoids speeding/slowing traffic with arrival jitter.
    this.clock=this.clock===null?offset:Math.min(this.clock+.1,offset);
  }
  receive(frame,now) {
    if(this.latest && frame.tick<=this.latest.tick)return;
    if(!frame.actors.has(this.localId))return;
    this.observeClock(frame.tick,now);
    const generation=frame.actors.get(this.localId).generation;
    const changed=this.latest?.actors.get(this.localId)?.generation!==generation;
    const past=this.history.get(frame.tick),selected=this.world.selected(frame);
    const matches=!changed&&past&&streetMatches(past.props,frame.props)&&past.size===selected.size&&[...selected].every(([id,a])=>{
      const recorded=past.get(id);if(!recorded||recorded.generation!==a.generation)return false;
      const local=id===this.localId,p=recorded.pose;
      const position=Math.hypot(...a.pose.slice(0,3).map((v,i)=>v-p[i]));
      if(local)this.metrics.confirmedPositionError=position;
      return position<(local ? .015 : .06)&&
        Math.hypot(...a.pose.slice(7,10).map((v,i)=>v-p[7+i]))<(local ? .06 : .2)&&
        Math.abs(a.pose.slice(3,7).reduce((sum,v,i)=>sum+v*p[i+3],0))>.99998&&
        Math.hypot(...a.pose.slice(10,13).map((v,i)=>v-p[10+i]))<.06&&
        Math.abs(a.steering-recorded.steering)<.025&&Math.abs(a.throttle-recorded.throttle)<.02&&
        Math.abs(a.damage-recorded.damage)<.0001&&recorded.detached.every((v,i)=>v===Boolean(a.wheels[i*7+6])&&(!v||
          (Math.hypot(...recorded.wheelBodies[i].p.map((x,j)=>x-a.wheels[i*7+j]))<.1&&
           Math.hypot(...recorded.wheelBodies[i].v.map((x,j)=>x-a.detached[i].v[j]))<.2)));
    });
    if(matches){
      this.latest=frame;this.metrics.skippedReconciliations=(this.metrics.skippedReconciliations??0)+1;
      for(const [id,a]of selected){const entry=this.world.actors.get(id);entry.source=a;entry.control=a.control;}
      for(const tick of this.commands.keys())if(tick<=frame.tick)this.commands.delete(tick);
      for(const tick of this.history.keys())if(tick<frame.tick)this.history.delete(tick);
      return;
    }
    const previous=this.world.sample(),target=changed?frame.tick:this.world.tick;
    if(changed){this.commands.clear();this.history.clear();this.errors.clear();this.rendered.clear();this.lastSent=frame.tick;this.lastNow=now;}
    this.latest=frame;
    const begin=performance.now();this.world.restore(frame);
    this.history.set(frame.tick,this.world.checkpoint());
    for(const id of this.errors.keys())if(!this.world.actors.has(id)){this.errors.delete(id);this.rendered.delete(id);}
    const end=Math.min(target,frame.tick+60);
    for(let tick=frame.tick+1;tick<=end;tick++)this.step(this.commands.get(tick) ?? idleControl());
    const replay=Math.max(0,end-frame.tick);this.metrics.replaySteps+=replay;
    this.metrics.maxReplay=Math.max(this.metrics.maxReplay,replay);this.metrics.replayMs+=performance.now()-begin;
    for(const tick of this.commands.keys())if(tick<=frame.tick)this.commands.delete(tick);
    if(!changed){
      const before=new Map(previous.map(a=>[a.id,a]));
      for(const a of this.world.sample()){
        const old=before.get(a.id);
        if(!old || old.generation!==a.generation){this.errors.delete(a.id);this.rendered.delete(a.id);continue;}
        const error=old.pose.slice(0,3).map((v,i)=>v-a.pose[i]);
        const distance=Math.hypot(...error);
        if(a.id===this.localId && distance>.02){this.metrics.corrections++;this.metrics.lastCorrection=distance;this.metrics.maxCorrection=Math.max(this.metrics.maxCorrection,distance);}
        const existing=this.errors.get(a.id);
        const q=a.pose.slice(3,7),delta=multiplyQ(old.pose.slice(3,7),[-q[0],-q[1],-q[2],q[3]]);
        this.errors.set(a.id,{p:error.map((v,i)=>v+(existing?.p[i]??0)),q:multiplyQ(existing?.q??[0,0,0,1],delta)});
      }
    }
  }
  step(input) {
    this.world.step(this.localId,input);this.history.set(this.world.tick,this.world.checkpoint());
    for(const tick of this.history.keys())if(tick<this.world.tick-180)this.history.delete(tick);
  }
  advance(now,input) {
    // TCP can deliver a burst after retransmission. Reconcile once from its
    // newest complete state rather than replaying every obsolete packet.
    if(this.pendingFrame){const frame=this.pendingFrame;this.pendingFrame=null;this.receive(frame,frame.receivedAt);}
    if(!this.latest)return;
    const elapsed=this.lastNow===null?0:Math.max(0,now-this.lastNow);this.lastNow=now;
    if(now-this.latest.receivedAt>500){this.accumulator=0;return;}
    const serverNow=(now-this.clock)/MS;
    // Predict far enough ahead to cover uplink + batching + scheduler jitter.
    const target=Math.min(this.latest.tick+60,Math.floor(serverNow+this.rtt/(2*MS)+10));
    const drift=target-this.world.tick;
    if(drift>60 || drift< -60){this.commands.clear();this.world.restore(this.latest);this.lastSent=this.latest.tick;this.errors.clear();}
    const rate=drift>4?1.06:drift< -4?.94:1;
    this.accumulator+=Math.min(elapsed,100)*rate;
    // Only initial/recovery warmup jumps to the predicted timeline; ordinary play
    // stays on the local fixed clock and never waits for a network callback.
    if(this.world.tick===this.latest.tick && !this.commands.size){
      // Do not send already elapsed startup frames as fresh input. Warm up the
      // provisional world neutrally and place the first command in the future.
      while(this.world.tick<target-1)this.step(idleControl());
      this.lastSent=this.world.tick;this.accumulator=Math.max(this.accumulator,MS);
    }
    let budget=32;
    while(this.accumulator+1e-7>=MS && budget--){
      const tick=this.world.tick+1,control={...input};this.commands.set(tick,control);
      this.step(control);this.metrics.steps++;this.accumulator-=MS;
    }
    this.accumulator=Math.min(this.accumulator,MS*2);
    if(now-(this.sentAt??-Infinity)>=1000/30)this.flush(now);
  }
  flush(now=performance.now()) {
    if(!this.latest)return;
    const commands=[...this.commands].filter(([tick])=>tick>this.lastSent).slice(0,12);
    if(!commands.length)return;
    this.send({generation:this.latest.actors.get(this.localId).generation,
      commands:commands.map(([tick,c])=>[tick,c.steer,c.throttle,c.brake,Number(Boolean(c.handbrake))])});
    this.lastSent=commands.at(-1)[0];this.sentAt=now;
  }
  sample(now) {
    const dt=Math.max(0,Math.min(.1,(now-(this.sampleAt??now))/1000));this.sampleAt=now;
    const result=this.world.sample();
    // Interpolate adjacent local fixed steps, then decay only the correction
    // offset. No packet-delay buffer or continuous low-pass on normal driving.
    const alpha=Math.max(0,Math.min(1,this.accumulator/MS));
    for(const a of result){
      const entry=this.world.actors.get(a.id),b=entry.sim.body;
      const current=a.pose.slice(0,3);
      for(let i=0;i<3;i++)a.pose[i]=[b.previousPosition.x,b.previousPosition.y,b.previousPosition.z][i]*(1-alpha)+current[i]*alpha;
      a.pose.splice(3,4,...quaternionSlerp([b.previousQuaternion.x,b.previousQuaternion.y,b.previousQuaternion.z,b.previousQuaternion.w],a.pose.slice(3,7),alpha));
      const error=this.errors.get(a.id);
      if(error){
        const distance=Math.hypot(...error.p),blend=1-Math.exp(-dt/(distance>1?.045:.09));
        error.p=distance>8?[0,0,0]:error.p.map(v=>v*(1-blend));
        for(let i=0;i<3;i++)a.pose[i]+=error.p[i];
        error.q=distance>8?[0,0,0,1]:quaternionSlerp(error.q,[0,0,0,1],blend);
        a.pose.splice(3,4,...multiplyQ(error.q,a.pose.slice(3,7)));
      }
      // Move wheels with the displayed chassis; preserve suspension/spin.
      const dq=new Float64Array(a.pose.slice(3,7));
      for(let w=0;w<4;w++){
        const wheel=entry.sim.wheels[w];
        if(wheel.detached)continue;
        const local=b.pointToLocalFrame(wheel.position);
        // Rotate with the render quaternion without importing the render engine.
        const x=local.x,y=local.y,z=local.z,qx=dq[0],qy=dq[1],qz=dq[2],qw=dq[3];
        const ix=qw*x+qy*z-qz*y,iy=qw*y+qz*x-qx*z,iz=qw*z+qx*y-qy*x,iw=-qx*x-qy*y-qz*z;
        a.wheels[w*7]=ix*qw-iw*qx-iy*qz+iz*qy+a.pose[0];
        a.wheels[w*7+1]=iy*qw-iw*qy-iz*qx+ix*qz+a.pose[1];
        a.wheels[w*7+2]=iz*qw-iw*qz-ix*qy+iy*qx+a.pose[2];
      }
      this.rendered.set(a.id,a);
    }
    return result;
  }
  dispose(){this.world.dispose();this.commands.clear();this.history.clear();this.errors.clear();this.rendered.clear();}
}
