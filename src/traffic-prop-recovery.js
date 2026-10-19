import { PROP_PHYSICS } from './street-prop-config.js';
import { footprintsOverlap } from './traffic-spawn.js';
import { driveControl, sweptPathIsSafe } from './traffic-planner.js';

function nearbyProps(props, car) {
  const entries = new Set();
  for (let x=Math.floor((car.x-20)/12);x<=Math.floor((car.x+20)/12);x++)
    for (let z=Math.floor((car.z-20)/12);z<=Math.floor((car.z+20)/12);z++)
      for (const entry of props.cells.get(`${x}:${z}`)||[]) if(entry.state==='intact') entries.add(entry);
  return [...entries].flatMap(e=>PROP_PHYSICS[e.type].boxes.filter(box=>box.center[1]-box.half[1]<1.8).map(box=>({
    id:e.id,x:e.x+Math.cos(e.yaw)*box.center[0]+Math.sin(e.yaw)*box.center[2],
    z:e.z-Math.sin(e.yaw)*box.center[0]+Math.cos(e.yaw)*box.center[2],heading:e.yaw,
    halfX:box.half[0],halfZ:box.half[2],
  })));
}

function corridorSafe(car, points, occupants, obstacles) {
  // A resting contact may separate in reverse. It may never be ignored on the
  // forward leg, and an initially overlapping neighbour still uses the shared
  // monotonic-separation check in sweptPathIsSafe.
  const touching=obstacles.filter(o=>footprintsOverlap(car,o,.2));
  if(points[1].reverse && touching.length) {
    const end=points[1];
    if(touching.some(o=>(end.x-car.x)*(o.x-car.x)+(end.z-car.z)*(o.z-car.z)>=0))return false;
  } else if(touching.length)return false;
  return sweptPathIsSafe(car,points,occupants,obstacles.filter(o=>!points[1].reverse||!touching.includes(o)),2.2);
}

/** Only a measured, upright physical prop collision can enter this recovery.
 * No body poses, route edges, wheel state or collision filters are modified.
 */
export function recoverPropContact(ai, car, target, { props, contact, occupants, obstacles, dt, canRecover=true, waitReason=null }) {
  if(contact)ai.propBlocker=contact;
  const blocker=ai.propBlocker;
  if(!blocker || blocker.state!=='intact') {
    ai.propBlocker=null;ai.propManeuver=null;ai.propStall=0;return null;
  }
  const speed=Math.hypot(car.vx,car.vz),fx=Math.sin(car.heading),fz=Math.cos(car.heading);
  const ahead=(blocker.x-car.x)*fx+(blocker.z-car.z)*fz;
  if(!ai.propManeuver && (ahead < 0 || Math.hypot(blocker.x-car.x,blocker.z-car.z)>5)) {
    ai.propBlocker=null;ai.propStall=0;return null;
  }
  ai.propStall=speed<.3?(ai.propStall||0)+dt:0;
  const statics=[...obstacles,...nearbyProps(props,car)];
  if(!ai.propManeuver && ai.propStall>=1 && canRecover) {
    const back={x:car.x-fx*4,z:car.z-fz*4,reverse:true};
    // Target is on the existing path, far enough ahead for a gentle return.
    const points=[{x:car.x,z:car.z},back,{...target}];
    if(corridorSafe(car,points.slice(0,2),occupants,statics)
      && corridorSafe({...car,...back},points.slice(1),occupants,statics))ai.propManeuver={points,index:1};
  }
  const maneuver=ai.propManeuver;
  let reason=!canRecover?(waitReason||'prop-wait'):ai.propStall<1?'prop-contact':'prop-no-safe-corridor',targetSpeed=0,control={steer:0,throttle:0,brake:1};
  if(maneuver) {
    let waypoint=maneuver.points[maneuver.index];
    if(Math.hypot(waypoint.x-car.x,waypoint.z-car.z)<.65) {
      maneuver.index++;
      if(maneuver.index===maneuver.points.length) {
        ai.propBlocker=null;ai.propManeuver=null;ai.propStall=0;return null;
      }
      waypoint=maneuver.points[maneuver.index];
    }
    const points=[{x:car.x,z:car.z},waypoint];
    const safe=canRecover && corridorSafe(car,points,occupants,statics);
    reason=safe?'prop-recovery':'prop-recovery-blocked';targetSpeed=safe?(waypoint.reverse?-2.2:4.4):0;
    control=driveControl(waypoint.x-car.x,waypoint.z-car.z,car.heading,car.vx*fx+car.vz*fz,targetSpeed,Boolean(waypoint.reverse));
  }
  return {control,targetSpeed,reason,blocker:blocker.id};
}
