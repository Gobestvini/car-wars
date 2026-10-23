import { createRoundedSidewalkLayout, createSidewalkSupportBoxes, createSidewalkSupportPrisms } from '../road-surface.js';
import { footprintsOverlap } from '../traffic-spawn.js';
import { streetManifest } from './street-world.js';

export const MAP_VERSION = 3;
export function cityColliders(plan,damageObstacles=[]) {
  const middle = Math.floor(plan.roads.length / 2), span = Math.abs(plan.roads[middle]-plan.roads[middle-1]);
  const sidewalks = createRoundedSidewalkLayout(plan,plan.bounds,plan.roadWidth,plan.sidewalkWidth,
    {centerX:0,centerZ:0,width:span,depth:span});
  // landmarks is an array of IDs; the landmark buildings already belong to buildings.
  const boxes = [...plan.buildings,...(plan.boundaryBuildings || [])].map(b=>({x:b.x,y:b.height/2,z:b.z,
    halfX:b.width/2,halfY:b.height/2,halfZ:b.depth/2})).concat(createSidewalkSupportBoxes(sidewalks.rectangles));
  const prisms = createSidewalkSupportPrisms(sidewalks.corners);
  for(const [x,z,width,depth,height=1.4,yaw=0]of damageObstacles)boxes.push({x,y:height/2,z,halfX:width/2,halfY:height/2,halfZ:depth/2,yaw});
  if(boxes.some(b=>!['x','y','z','halfX','halfY','halfZ'].every(k=>Number.isFinite(b[k])) ||
    ['halfX','halfY','halfZ'].some(k=>b[k]<=0)))throw Error('Invalid server city collider');
  if(prisms.some(p=>![p.x,p.y,p.z,...p.vertices.flat()].every(Number.isFinite)))throw Error('Invalid server sidewalk collider');
  return {boxes,prisms,props:streetManifest(plan,{damageObstacles})};
}
export const mapContract = (plan,colliders=cityColliders(plan),damageObstacles=[])=>({version:MAP_VERSION,plan,colliders,...(damageObstacles.length?{damageObstacles}: {})});
export const mapBytes = data=>JSON.stringify({version:data.version,plan:data.plan,colliders:data.colliders});
export async function verifyMap(data,signature) {
  if(data?.version!==MAP_VERSION || !data.plan?.roadNetwork || !Number.isSafeInteger(data.plan.seed))throw Error('Версия карты изменилась. Обновите страницу.');
  const expected=cityColliders(data.plan,data.damageObstacles??[]);
  if(JSON.stringify(expected)!==JSON.stringify(data.colliders))throw Error('Карта и серверные коллизии не совпадают. Обновите страницу.');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(mapBytes(data)));
  const actual=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  if(actual!==signature)throw Error('Получена повреждённая карта. Подключитесь заново.');
  return data.plan;
}
export class CityObstacleIndex {
  constructor(plan){
    this.cells=new Map();
    for(const b of [...plan.buildings,...plan.boundaryBuildings]){
      const box={x:b.x,z:b.z,halfX:b.width/2,halfZ:b.depth/2};
      for(let x=Math.floor((b.x-box.halfX)/12);x<=Math.floor((b.x+box.halfX)/12);x++)
        for(let z=Math.floor((b.z-box.halfZ)/12);z<=Math.floor((b.z+box.halfZ)/12);z++){
          const key=`${x}:${z}`;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(box);
        }
    }
  }
  overlaps(pose){
    for(let x=Math.floor((pose.x-3)/12);x<=Math.floor((pose.x+3)/12);x++)
      for(let z=Math.floor((pose.z-3)/12);z<=Math.floor((pose.z+3)/12);z++)
        if(this.cells.get(`${x}:${z}`)?.some(box=>footprintsOverlap(pose,box,.12)))return true;
    return false;
  }
}
