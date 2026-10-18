const mix = (a, b, t) => a + (b - a) * t;
const copy = actor => ({ id: actor.id, role: actor.role, generation: actor.generation,
  pose: Array.from(actor.pose), wheels: Array.from(actor.wheels), steering: actor.steering,
  damage: actor.damage, ack: actor.ack, connected: actor.connected, dents:actor.dents });

export function quaternionSlerp(a, b, t) {
  let dot = a.reduce((sum, value, i) => sum + value * b[i], 0);
  if (dot < 0) { b = b.map(value => -value); dot = -dot; }
  dot = Math.min(1, dot);
  const angle = Math.acos(dot), sine = Math.sin(angle);
  const x = sine > .001 ? Math.sin((1-t)*angle)/sine : 1-t;
  const y = sine > .001 ? Math.sin(t*angle)/sine : t;
  const q = a.map((value, i) => value*x+b[i]*y);
  const length = Math.hypot(...q) || 1;
  return q.map(value => value/length);
}

// Copies decoded Schema values: Colyseus mutates the source objects in place.
export class SnapshotBuffer {
  constructor() { this.frames = [];this.rendered=new Map();this.delay=90;this.gaps=[];this.clockOffset=null; }
  clear() { this.frames.length = 0;this.rendered.clear();this.gaps=[];this.delay=90;this.clockOffset=null; }
  setMap(plan) { this.obstacles=new CityObstacleIndex(plan); }
  push(state, receivedAt) {
    if (!state?.actors?.size) return;
    const last = this.frames.at(-1);
    if (last && state.tick <= last.tick) return;
    if(last){
      this.gaps.push(receivedAt-last.receivedAt);if(this.gaps.length>40)this.gaps.shift();
      const sorted=[...this.gaps].sort((a,b)=>a-b),gap=sorted[Math.ceil(sorted.length*.95)-1];
      const desired=Math.max(90,Math.min(180,gap+30));this.delay+=(desired-this.delay)*.1;
    }
    const time=state.tick*1000/120,offset=receivedAt-time;
    this.clockOffset=this.clockOffset===null?offset:Math.min(this.clockOffset+.1,offset);
    this.frames.push({ tick: state.tick, time, receivedAt,
      actors: new Map([...state.actors.values()].map(actor => [actor.id, copy(actor)])) });
    if (this.frames.length > 12) this.frames.shift();
  }
  get age() { return this.frames.at(-1)?.receivedAt ?? null; }
  sample(now, localId) {
    const latest = this.frames.at(-1);
    if (!latest) return [];
    for(const id of this.rendered.keys())if(!latest.actors.has(id))this.rendered.delete(id);
    return [...latest.actors.values()].map(actor => {
      const target = now - this.clockOffset - (actor.id === localId ? Math.max(60,this.delay*.65) : this.delay);
      const end = this.frames.find(frame => frame.time >= target) || latest;
      const index = this.frames.indexOf(end), start = this.frames[Math.max(0,index-1)];
      const b = end.actors.get(actor.id) || actor, a = start.actors.get(actor.id) || b;
      if (actor.generation !== b.generation) return { ...actor, pose: [...actor.pose], wheels: [...actor.wheels] };
      const result = { ...actor, pose: [...b.pose], wheels: [...b.wheels] };
      const teleported = a.generation !== b.generation || Math.hypot(...a.pose.slice(0,3).map((v,i)=>v-b.pose[i])) > 12;
      if (!teleported && target < end.time && end.time > start.time) {
        const t = Math.max(0, Math.min(1,(target-start.time)/(end.time-start.time)));
        for (let i=0;i<3;i++) result.pose[i] = mix(a.pose[i],b.pose[i],t);
        result.pose.splice(3,4,...quaternionSlerp(a.pose.slice(3,7),b.pose.slice(3,7),t));
        result.wheels = b.wheels.map((v,i) => i%7 < 4 ? mix(a.wheels[i] ?? v,v,t) : v);
        result.steering = mix(a.steering,b.steering,t);
      } else if (target > latest.time) {
        const seconds = Math.min(80,target-latest.time)/1000;
        for (let i=0;i<3;i++) result.pose[i] += (result.pose[7+i] || 0)*seconds;
        for (let w=0;w<result.wheels.length/7;w++) for (let i=0;i<3;i++) result.wheels[w*7+i] += (result.pose[7+i] || 0)*seconds;
        const q=result.pose.slice(3,7),heading=Math.atan2(2*(q[0]*q[2]+q[3]*q[1]),1-2*(q[0]**2+q[1]**2));
        if(this.obstacles?.overlaps({x:result.pose[0],z:result.pose[2],heading})){
          result.pose=[...b.pose];result.wheels=[...b.wheels];
        }
      }
      const previous=this.rendered.get(actor.id),distance=previous?Math.hypot(...result.pose.slice(0,3).map((v,i)=>v-previous.pose[i])):0;
      if(previous && previous.generation===actor.generation && !teleported && distance>.35 && distance<12){
        const blend=1-Math.exp(-Math.min(.1,Math.max(0,(now-previous.time)/1000))/.035);
        for(let i=0;i<3;i++){
          const correction=mix(previous.pose[i],result.pose[i],blend)-result.pose[i];result.pose[i]+=correction;
          for(let w=0;w<result.wheels.length/7;w++)result.wheels[w*7+i]+=correction;
        }
      }
      this.rendered.set(actor.id,{pose:[...result.pose],time:now,generation:actor.generation});
      return result;
    });
  }
}
import { CityObstacleIndex } from './map-contract.js';
