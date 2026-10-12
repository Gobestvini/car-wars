// Explicit legacy grid for fixed-coordinate junction/curb regression scenarios.
// Production generation and its new topology are covered by city-layout.test.js.
import { createCityPlan as createGeneratedPlan, ROAD_CENTRES } from '../src/city-generator.js';
export function createCityPlan(seed, options) {
  const plan=createGeneratedPlan(seed,options), intersections=[],edges=[];
  for(let x=0;x<8;x++) for(let z=0;z<8;z++) {
    const id=`${ROAD_CENTRES[x]}:${ROAD_CENTRES[z]}`;
    intersections.push({id,x:ROAD_CENTRES[x],z:ROAD_CENTRES[z]});
    if(x<7) edges.push({from:id,to:`${ROAD_CENTRES[x+1]}:${ROAD_CENTRES[z]}`,length:50});
    if(z<7) edges.push({from:id,to:`${ROAD_CENTRES[x]}:${ROAD_CENTRES[z+1]}`,length:50});
  }
  delete plan.roadSegments;delete plan.territory;delete plan.contour;
  plan.roadNetwork={intersections,edges,horizontal:ROAD_CENTRES,vertical:ROAD_CENTRES};
  return plan;
}
