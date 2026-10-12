export function createRoadMarkings(roadCenters, bounds, roadWidth, spacing = 6, endMargin = 6) {
  if (!Array.isArray(roadCenters) && roadCenters.roadSegments) {
    const marks=[];
    for(const {from,to} of roadCenters.roadSegments) {
      const dx=to.x-from.x,dz=to.z-from.z,length=Math.hypot(dx,dz),margin=roadWidth/2+3;
      for(let along=margin+1.1;along<=length-margin-1.1;along+=spacing) {
        marks.push({x:from.x+dx*along/length,z:from.z+dz*along/length,
          yaw:dx?Math.PI/2:0,axis:dx?'x':'z'});
      }
    }
    return marks;
  }
  if(!Array.isArray(roadCenters)) roadCenters=roadCenters.roads;
  const marks = [];
  for (const road of roadCenters) {
    for (let offset = -bounds + endMargin; offset <= bounds - endMargin; offset += spacing) {
      if (roadCenters.some(cross => Math.abs(offset - cross) < roadWidth / 2 + 3)) continue;
      marks.push({ x: road, z: offset, yaw: 0, axis: 'z' });
      marks.push({ x: offset, z: road, yaw: Math.PI / 2, axis: 'x' });
    }
  }
  return marks;
}
