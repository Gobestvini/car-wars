import { createTreePlacements } from '../tree-placement.js';
import { createStreetPropPlacements } from '../street-prop-placement.js';
import { getSignalPosition } from '../signal-layout.js';
import { createSurfaceHeightSampler, ROAD_SURFACE_HEIGHTS } from '../road-surface.js';

// The manifest is generated on the server, signed with the map and checked by
// clients. Stable array indices are the wire IDs; rendering uses the same IDs.
export function streetManifest(plan) {
  const signals=[];
  for(const edge of plan.roadNetwork.edges)for(const [fromId,nodeId]of [[edge.from,edge.to],[edge.to,edge.from]]){
    const node=plan.roadNetwork.intersections.find(n=>n.id===nodeId),from=plan.roadNetwork.intersections.find(n=>n.id===fromId);
    const degree=plan.roadNetwork.edges.filter(e=>e.from===nodeId||e.to===nodeId).length;
    if(!node||!from||degree<4)continue;
    const dx=node.x-from.x,dz=node.z-from.z,length=Math.hypot(dx,dz),fx=dx/length,fz=dz/length;
    signals.push({id:`signal:${nodeId}:${fromId}`,type:'signal',...getSignalPosition(node,{forwardX:fx,forwardZ:fz,rightX:-fz,rightZ:fx},plan.roadWidth,plan.sidewalkWidth),
      y:ROAD_SURFACE_HEIGHTS.sidewalk,yaw:Math.atan2(-fx,-fz)});
  }
  const trees=createTreePlacements(plan,{signals}),surface=createSurfaceHeightSampler(plan,0);
  const props=createStreetPropPlacements(plan,{signals,trees});
  return [...props.map(p=>({id:`${p.type}:${p.id}`,type:p.type,x:p.x,y:surface(p.x,p.z),z:p.z,yaw:p.yaw})),
    ...signals,...trees.map((t,i)=>({id:`tree:${i}`,type:'tree',x:t.x,y:surface(t.x,t.z),z:t.z,yaw:0}))];
}

// Complete, bounded lifecycle state. Intact objects are implicit; removed IDs
// remain present for late joins. No client collision reports are accepted.
export function captureStreet(physics) {
  const states=[];
  for(let i=0;i<physics.entries.length;i++){
    const e=physics.entries[i];if(e.state==='intact')continue;
    if(e.state==='removed'){states.push([i,-1]);continue;}
    const {position:p,quaternion:q,velocity:v,angularVelocity:a}=e.body;
    states.push([i,physics.clock-e.destroyedAt,p.x,p.y,p.z,q.x,q.y,q.z,q.w,v.x,v.y,v.z,a.x,a.y,a.z]);
  }
  return states;
}

export function restoreStreet(physics,states,time) {
  const byIndex=new Map(states.map(s=>[s[0],s]));physics.clock=time;physics.debris=[];
  for(let i=0;i<physics.entries.length;i++){
    const e=physics.entries[i],s=byIndex.get(i),state=!s?'intact':s[1]<0?'removed':'detached';
    if(e.state!==state){
      physics.world.removeBody(e.body);physics.byBody.delete(e.body);physics.activeIntact.delete(e);
      e.active=false;
      if(state!=='removed'){
        e.body=physics.makeBody(e,state==='detached');e.active=true;
        if(state==='intact')physics.activeIntact.add(e);
      }
      e.state=state;
    }
    if(state!=='detached')continue;
    e.destroyedAt=time-s[1];const b=e.body;
    b.position.set(...s.slice(2,5));b.quaternion.set(...s.slice(5,9));b.velocity.set(...s.slice(9,12));b.angularVelocity.set(...s.slice(12,15));
    b.previousPosition.copy(b.position);b.previousQuaternion.copy(b.quaternion);b.force.setZero();b.torque.setZero();
    b.vlambda.setZero();b.wlambda.setZero();b.aabbNeedsUpdate=true;b.wakeUp();physics.debris.push(e);
  }
  physics.events.length=0;
}

export function streetMatches(a=[],b=[]) {
  if(a.length!==b.length)return false;
  return a.every((s,i)=>s.length===b[i].length&&s.every((v,j)=>Math.abs(v-b[i][j])<(j<2?.001:j<9?.025:.15)));
}
