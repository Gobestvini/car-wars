import { junctionMovement, pathProgress, pathTarget } from '../../src/traffic-junction.js';
export { CityObstacleIndex as BuildingIndex } from '../../src/multiplayer/map-contract.js';
export { pathProgress, pathTarget };
export function drivingPath(incoming,outgoing,node,width) {
  const turn=junctionMovement(incoming,outgoing,node,width);
  const back=width/2+9;
  const points=[{...incoming.start},
    {x:incoming.end.x-Math.sin(incoming.heading)*back,z:incoming.end.z-Math.cos(incoming.heading)*back},...turn.points];
  let distance=0;
  for(let i=0;i<points.length;i++){
    if(i)distance+=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);
    points[i]={...points[i],distance};
  }
  return {...turn,points,length:distance};
}
export function pointOnPath(path,distance) {
  const points=path.points;
  for(let i=1;i<points.length;i++){
    const b=points[i],a=points[i-1];if(b.distance<distance)continue;
    const t=Math.max(0,Math.min(1,(distance-a.distance)/Math.max(1e-8,b.distance-a.distance)));
    return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,heading:Math.atan2(b.x-a.x,b.z-a.z)};
  }
  const last=points.at(-1),previous=points.at(-2);
  return {...last,heading:Math.atan2(last.x-previous.x,last.z-previous.z)};
}
