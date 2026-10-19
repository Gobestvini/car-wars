import * as THREE from 'three';
import { SpikeWorld, STEP } from '../tools/multiplayer-spike/world.js';
import { createTraffic } from '../src/traffic.js';
import { attachForTrafficTest, frameStep } from './traffic-frame-helpers.js';
import { sidewalkImpact, greenSignals } from './npc-sidewalk-fixture.js';

export function offlineImpact(options={},runtime=createTraffic) {
  const world=new SpikeWorld({seed:42,npcCount:1,playerCount:1});
  const player=[...world.players.values()][0].sim;
  const traffic=runtime(new THREE.Scene(),THREE,1,world.plan.roadNetwork,world.plan.roadWidth,world.recoveryObstacles);
  attachForTrafficTest(traffic,player);traffic.setSignalController(greenSignals);
  const state=traffic.states[0];world.removeSim(world.npcs[0].sim);world.npcs[0].sim=state.simulation;
  const impact=sidewalkImpact(world,options),body=state.simulation.body;
  Object.assign(state.ai,{fromNode:impact.edge.from,targetNode:impact.edge.to,route:[impact.edge.to,impact.actor.outgoing.to],
    routeIndex:0,progressEdge:null,noProgressTime:0,maneuver:null});
  state.x=body.position.x;state.z=body.position.z;state.heading=impact.edge.heading;state.logical=false;
  if(traffic.setStreetProps)traffic.setStreetProps(world.props);
  return {world,traffic,state,...impact,step(){
    world.props.beforeStep(STEP,[{body:player.body,player:true},{body,player:false}]);
    frameStep(traffic,{brake:1},STEP);world.props.afterStep(STEP);world.tick++;
  },dispose(){traffic.dispose();world.npcs=[];world.dispose();}};
}
