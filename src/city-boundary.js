import { seededRandom } from './city-layout.js';

/** Tile each full contour segment with touching, exterior tower footprints. */
export function createCityBoundary(plan) {
  if(!plan.contour) return [];
  const random=seededRandom(plan.seed^0x613f5b),buildings=[];
  for(const [segment,edge]of plan.contour.entries()) {
    const length=edge.max-edge.min,count=Math.max(1,Math.ceil(length/(12+random()*6)));
    const span=length/count,depth=8+random()*6;
    const sign=edge.side==='north'||edge.side==='west'?1:-1;
    for(let slot=0;slot<count;slot++) {
      const along=edge.min+span*(slot+.5),normal=edge.value+sign*depth/2;
      buildings.push({id:10000+buildings.length,segment,slot,
        x:edge.axis==='x'?along:normal,z:edge.axis==='x'?normal:along,
        width:edge.axis==='x'?span:depth,depth:edge.axis==='x'?depth:span,
        height:24+random()*21,color:'#a5ccdc',style:1,landmark:false,boundary:true,
        crownHeight:2+random()*4,crownInset:.7+random()*1.1});
    }
  }
  return buildings;
}
