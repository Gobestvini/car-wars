import { edgeProgress } from '../src/traffic-planner.js';
import { heading, STEP } from '../tools/multiplayer-spike/world.js';

export const greenSignals = { phase: () => ({ color: 'green', canEnter: true, controlled: true }) };

// A lateral knock onto the sidewalk on the NPC's actual incoming street. Route
// and pose use the same edge; only this initial test setup repositions the car.
export function sidewalkImpact(world, { type = 'bin', speed = 16, follower = false, choice = 0, actorIndex = 0 } = {}) {
  const choices = world.props.entries.filter(e => e.type === type && e.state === 'intact').flatMap(prop =>
    world.graph.directed.map(edge => ({ prop, edge, along: edgeProgress(prop, edge),
      offset: Math.abs((prop.x-edge.start.x)*Math.cos(edge.heading)-(prop.z-edge.start.z)*Math.sin(edge.heading)) }))
      .filter(c => c.along > 12 && c.along < c.edge.length-15 && c.offset < 6));
  const { prop, edge } = choices.sort((a,b)=>a.offset-b.offset)[choice] || {};
  if (!prop) throw Error(`No coherent sidewalk fixture for ${type}`);
  const actor = world.npcs[actorIndex], fx = Math.sin(edge.heading), fz = Math.cos(edge.heading);
  const outgoing = world.graph.adjacency.get(edge.to).find(e=>Math.cos(e.heading-edge.heading)>.99)
    || world.graph.adjacency.get(edge.to).find(e=>e.to!==edge.from);
  Object.assign(actor, { edge, route:[outgoing.to], path:null, outgoing:null, physical:true });
  world.setPath(actor);
  const b=actor.sim.body;
  if(!world.world.bodies.includes(b))world.world.addBody(b);
  b.position.set(prop.x-fx*2.5,prop.y+.96,prop.z-fz*2.5);
  b.quaternion.setFromEuler(0,edge.heading,0);b.velocity.set(fx*speed,0,fz*speed);b.angularVelocity.setZero();
  b.previousPosition.copy(b.position);b.previousQuaternion.copy(b.quaternion);b.aabbNeedsUpdate=true;b.wakeUp();
  actor.sim.syncWheelPositions();
  world.setPath(actor);
  actor.propBlocker=null;actor.propManeuver=null;actor.propStall=0;
  const players=[...world.players.values()];
  players.forEach((p,i)=>{p.sim.body.position.set(b.position.x+12+i*7,1,b.position.z-15);p.sim.body.aabbNeedsUpdate=true;});
  if(follower && world.npcs[1]) {
    const a=world.npcs[1];Object.assign(a,{edge,route:[outgoing.to],path:null,physical:true});world.setPath(a);
    const body=a.sim.body;if(!world.world.bodies.includes(body))world.world.addBody(body);
    body.position.set(edge.start.x+fx*(edgeProgress(b.position,edge)-9),.96,edge.start.z+fz*(edgeProgress(b.position,edge)-9));
    body.quaternion.setFromEuler(0,edge.heading,0);body.velocity.setZero();body.angularVelocity.setZero();body.aabbNeedsUpdate=true;
  }
  return {actor,prop,edge,initial:{...b.position},speed};
}

export function npcTrace(world, actor) {
  const b=actor.sim.body;
  return {time:world.tick*STEP,id:actor.id,physical:actor.physical,p:[b.position.x,b.position.y,b.position.z],
    q:[b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w],v:[b.velocity.x,b.velocity.y,b.velocity.z],
    speed:Math.hypot(b.velocity.x,b.velocity.z),heading:heading(b.quaternion),edge:[actor.edge.from,actor.edge.to],
    progress:actor.logicalProgress,targetSpeed:actor.targetSpeed,control:actor.control,
    owner:world.junctionOwners.get(actor.edge.to)??null,reason:actor.waitReason??null,blocker:actor.blocker??null};
}
