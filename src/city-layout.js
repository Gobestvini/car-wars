// Orthogonal cell districts. Every district contributes its complete boundary road loop.
export const CITY_SHAPES = Object.freeze({
  '+': [[1,0],[0,1],[1,1],[2,1],[1,2]],
  L: [[0,0],[0,1],[0,2],[1,2]], T: [[0,0],[1,0],[2,0],[1,1]],
  S: [[1,0],[2,0],[0,1],[1,1]], U: [[0,0],[2,0],[0,1],[1,1],[2,1]],
  J: [[1,0],[1,1],[0,2],[1,2]], O: [[0,0]],
});
export function seededRandom(seed) {
  let state=seed>>>0;
  return () => { state+=0x6D2B79F5; let n=state; n=Math.imul(n^n>>>15,n|1);
    n^=n+Math.imul(n^n>>>7,n|61); return ((n^n>>>14)>>>0)/4294967296; };
}
const key=(x,z)=>`${x}:${z}`;
export function createCityLayout(seed, roadWidth, sidewalkWidth, { fallback = false } = {}) {
  const random=seededRandom(fallback ? 1977 : seed ^ 0x25b13);
  const protectedCells=new Set(['3:3']);
  const districts=[
    {type:'+',cells:[[2,1],[1,2],[2,2],[3,2],[2,3]]},
    {type:'L',cells:[[4,1],[4,2],[4,3],[5,3]]},
    {type:'T',cells:[[1,4],[2,4],[3,4],[2,5]]},
    {type:'plaza',cells:[[3,3]]},
  ];
  districts.forEach(d=>d.cells.forEach(([x,z])=>protectedCells.add(key(x,z))));
  const active=new Set();
  for(let x=0;x<7;x++) for(let z=0;z<7;z++) active.add(key(x,z));
  // Remove four independently sized corner staircases: no holes or one-cell necks.
  for(const [sx,sz] of [[1,1],[-1,1],[1,-1],[-1,-1]]) {
    const depth=1+Math.floor(random()*3);
    for(let a=0;a<depth;a++) for(let b=0;b<depth-a;b++) {
      const x=sx===1?a:6-a,z=sz===1?b:6-b;
      if(!protectedCells.has(key(x,z))) active.delete(key(x,z));
    }
  }
  const occupied=new Set(protectedCells);
  const candidates=[];
  for(let x=0;x<7;x++) for(let z=0;z<7;z++) candidates.push({x,z,rank:random()});
  candidates.sort((a,b)=>a.rank-b.rank);
  const types=Object.keys(CITY_SHAPES).filter(t=>t!=='O');
  for(const {x,z} of candidates) {
    if(!active.has(key(x,z))||occupied.has(key(x,z))) continue;
    let placed=false;
    const start=Math.floor(random()*types.length);
    for(let i=0;i<types.length&&!placed;i++) {
      const type=types[(start+i)%types.length], turn=Math.floor(random()*4);
      let cells=CITY_SHAPES[type].map(([a,b])=>turn===0?[a,b]:turn===1?[-b,a]:turn===2?[-a,-b]:[b,-a]);
      const minX=Math.min(...cells.map(c=>c[0])),minZ=Math.min(...cells.map(c=>c[1]));
      cells=cells.map(([a,b])=>[a-minX+x,b-minZ+z]);
      if(cells.every(([a,b])=>active.has(key(a,b))&&!occupied.has(key(a,b)))) {
        districts.push({type,cells}); cells.forEach(([a,b])=>occupied.add(key(a,b))); placed=true;
      }
    }
    if(!placed) { districts.push({type:'O',cells:[[x,z]]}); occupied.add(key(x,z)); }
  }
  const nodes=new Map(), edgeMap=new Map();
  const world=(x,z)=>({x:x*50-175,z:z*50-175,id:key(x*50-175,z*50-175)});
  for(const district of districts) {
    const own=new Set(district.cells.map(([x,z])=>key(x,z)));
    for(const [x,z] of district.cells) {
      const sides=[[-1,0,[x,z],[x,z+1]],[1,0,[x+1,z],[x+1,z+1]],
        [0,-1,[x,z],[x+1,z]],[0,1,[x,z+1],[x+1,z+1]]];
      for(const [dx,dz,a,b] of sides) if(!own.has(key(x+dx,z+dz))) {
        const from=world(...a),to=world(...b),id=[from.id,to.id].sort().join('|');
        nodes.set(from.id,from); nodes.set(to.id,to);
        edgeMap.set(id,{from:from.id,to:to.id,length:50});
      }
    }
  }
  const intersections=[...nodes.values()].sort((a,b)=>a.x-b.x||a.z-b.z);
  const edges=[...edgeMap.values()].sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
  const roadSegments=edges.map(e=>({from:nodes.get(e.from),to:nodes.get(e.to)}));
  const margin=roadWidth/2+sidewalkWidth+3;
  const territory=[...active].map(k=>{
    const [x,z]=k.split(':').map(Number);
    return {minX:x*50-175-margin,maxX:(x+1)*50-175+margin,
      minZ:z*50-175-margin,maxZ:(z+1)*50-175+margin};
  });
  return { activeCells:[...active].map(k=>k.split(':').map(Number)), districts, roadSegments, territory,
    spawnArea:{minX:-25,maxX:25,minZ:-25,maxZ:25},
    roadNetwork:{intersections,edges,horizontal:[],vertical:[]} };
}

/** Canonical topology under all rotations/reflections, independent of road width. */
export function cityLayoutSignature(plan) {
  const transforms=[(x,z)=>[x,z],(x,z)=>[-x,z],(x,z)=>[x,-z],(x,z)=>[-x,-z],
    (x,z)=>[z,x],(x,z)=>[-z,x],(x,z)=>[z,-x],(x,z)=>[-z,-x]];
  return transforms.map(transform=>{
    const cells=plan.activeCells.map(([x,z])=>transform(x*2+1,z*2+1));
    const edges=plan.roadSegments.map(({from,to})=>[transform((from.x+175)/25,(from.z+175)/25),
      transform((to.x+175)/25,(to.z+175)/25)]);
    const all=[...cells,...edges.flat()], minX=Math.min(...all.map(p=>p[0])),minZ=Math.min(...all.map(p=>p[1]));
    const encode=p=>`${p[0]-minX}:${p[1]-minZ}`;
    return cells.map(encode).sort().join(',')+'|'+edges.map(e=>e.map(encode).sort().join('>')).sort().join(',');
  }).sort()[0];
}

export function containsCityPoint(plan, x, z) {
  return !plan.territory || plan.territory.some(r=>x>=r.minX&&x<=r.maxX&&z>=r.minZ&&z<=r.maxZ);
}

export function nextRoundPlan(createPlan, current, seed, options) {
  for(let attempt=0;attempt<32;attempt++) {
    const candidate=createPlan((seed+attempt)>>>0,options);
    if(!current||cityLayoutSignature(candidate)!==cityLayoutSignature(current)) return candidate;
  }
  throw new Error('Cannot generate a distinct next city after 32 deterministic attempts.');
}
