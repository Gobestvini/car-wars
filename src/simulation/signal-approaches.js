import { getSignalPosition, getStopLineLayout } from '../signal-layout.js';
export function createSignalApproaches(plan){
  const nodes=new Map(plan.roadNetwork.intersections.map(n=>[n.id,n])),degree=new Map();
  for(const e of plan.roadNetwork.edges)for(const id of [e.from,e.to])degree.set(id,(degree.get(id)??0)+1);
  const result=[];
  for(const e of plan.roadNetwork.edges)for(const [fromId,nodeId]of [[e.from,e.to],[e.to,e.from]]){
    const node=nodes.get(nodeId),from=nodes.get(fromId);if(!node||!from||degree.get(nodeId)<4)continue;
    const dx=node.x-from.x,dz=node.z-from.z,length=Math.hypot(dx,dz),forwardX=dx/length,forwardZ=dz/length,rightX=-forwardZ,rightZ=forwardX;
    const basis={forwardX,forwardZ,rightX,rightZ},stop=getStopLineLayout(node,basis,plan.roadWidth),signal=getSignalPosition(node,basis,plan.roadWidth,plan.sidewalkWidth);
    result.push({nodeId,fromId,...basis,stopX:stop.x,stopZ:stop.z,stopDistance:stop.distanceFromNode,stopLineLength:stop.length,
      stopLineThickness:stop.thickness,signalX:signal.x,signalZ:signal.z,signalVisible:true,yaw:Math.atan2(forwardX,forwardZ),signalYaw:Math.atan2(-forwardX,-forwardZ)});
  }
  return result;
}
