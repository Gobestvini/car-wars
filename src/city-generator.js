// Deterministic street grid and buildings, measured in metres.
import { createCityLayout, cityLayoutSignature, MAX_HOUSES_PER_ROW } from './city-layout.js';
import { createRectangleUnionEdges, createRoadSurfaceRectangles } from './road-surface.js';
import { createCityBoundary } from './city-boundary.js';
const mulberry32 = seed => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
};

export const CITY_BOUNDS = 210;
export const ROAD_WIDTH = 15;
export const ROAD_CENTRES = [-175, -125, -75, -25, 25, 75, 125, 175];
export const BLOCK_PITCH = 50;
export const BUILDING_SETBACK = 1.5;
export const DEFAULT_CITY_SEED = 20261005;
export const ROAD_WIDTH_LIMITS = Object.freeze({ min: 12, max: 30, step: 1 });
export const CITY_CONFIG = Object.freeze({
  sidewalkWidth: 2,
  buildingSetback: BUILDING_SETBACK,
  buildingFootprint: Object.freeze({ min: 10, max: 12 }),
  buildingGap: 1,
});

export function createCityPlan(seed = DEFAULT_CITY_SEED, { roadWidth = ROAD_WIDTH, config = CITY_CONFIG } = {}) {
  if (!Number.isSafeInteger(seed)) throw new TypeError('City seed must be a safe integer.');
  if (!Number.isFinite(roadWidth) || roadWidth < ROAD_WIDTH_LIMITS.min || roadWidth > ROAD_WIDTH_LIMITS.max) {
    throw new RangeError(`Road width must be between ${ROAD_WIDTH_LIMITS.min} and ${ROAD_WIDTH_LIMITS.max} metres.`);
  }
  const { sidewalkWidth, buildingSetback, buildingFootprint, buildingGap } = config;
  if (![sidewalkWidth, buildingSetback, buildingGap, buildingFootprint?.min, buildingFootprint?.max]
    .every(Number.isFinite) || sidewalkWidth < 0 || buildingSetback < 0 || buildingGap < 0
    || buildingFootprint.min <= 0 || buildingFootprint.max < buildingFootprint.min) {
    throw new RangeError('City dimensions must be finite and building footprint limits must be positive and ordered.');
  }

  const random = mulberry32(seed);
  const layout = createCityLayout(seed, roadWidth, sidewalkWidth);
  const active = new Set(layout.activeCells.map(([x,z])=>`${x}:${z}`));
  const parcels = new Map(layout.housingParcels.flatMap(p=>p.cells.map(([x,z])=>[`${x}:${z}`,p.id])));
  const sizeRandom = mulberry32(seed ^ 0x51D3A9B7);
  const buildings = [];
  const landmarks = [];
  const palettes = ['#c8a989', '#b9b5a6', '#c58b72', '#8fa39a', '#d0c4a5', '#a98f83'];
  const availableExtent = BLOCK_PITCH / 2 - roadWidth / 2 - sidewalkWidth - buildingSetback;
  const maxFootprint = Math.min(buildingFootprint.max, availableExtent * 2 - buildingGap);
  const minFootprint = Math.min(buildingFootprint.min, maxFootprint);
  if (!Number.isFinite(maxFootprint) || maxFootprint <= 0) throw new RangeError('Road width leaves no room for city buildings.');
  const clearance = roadWidth / 2 + sidewalkWidth + buildingSetback;
  const streetEdges = new Set(layout.roadNetwork.edges.map(e => [e.from,e.to].sort().join('|')));
  const hasStreet = (x1,z1,x2,z2) => streetEdges.has([`${x1}:${z1}`,`${x2}:${z2}`].sort().join('|'));
  const reserved = createRoadSurfaceRectangles(layout,CITY_BOUNDS,roadWidth+2*(sidewalkWidth+buildingSetback),
    {centerX:0,centerZ:0,width:BLOCK_PITCH,depth:BLOCK_PITCH});
  let id = 0;

  for (let bx = 0; bx < ROAD_CENTRES.length - 1; bx++) for (let bz = 0; bz < ROAD_CENTRES.length - 1; bz++) {
    // Keep a generous open plaza at the player spawn.
    if (bx === 3 && bz === 3) continue;
    if (!active.has(`${bx}:${bz}`)) continue;
    const x0=ROAD_CENTRES[bx],x1=ROAD_CENTRES[bx+1],z0=ROAD_CENTRES[bz],z1=ROAD_CENTRES[bz+1];
    const leftStreet=hasStreet(x0,z0,x0,z1),rightStreet=hasStreet(x1,z0,x1,z1);
    const topStreet=hasStreet(x0,z0,x1,z0),bottomStreet=hasStreet(x0,z1,x1,z1);
    const minX=x0+(leftStreet?clearance:buildingGap/2);
    const maxX=x1-(rightStreet?clearance:buildingGap/2);
    const minZ=z0+(topStreet?clearance:buildingGap/2);
    const maxZ=z1-(bottomStreet?clearance:buildingGap/2);
    const perCell = MAX_HOUSES_PER_ROW / 2;
    const nx=Math.min(perCell,Math.max(1,Math.floor((maxX-minX+buildingGap)/(minFootprint+buildingGap))));
    const nz=Math.min(perCell,Math.max(1,Math.floor((maxZ-minZ+buildingGap)/(minFootprint+buildingGap))));
    const slotX=(maxX-minX+buildingGap)/nx,slotZ=(maxZ-minZ+buildingGap)/nz;
    const fitX=Math.min(maxFootprint,slotX-buildingGap),fitZ=Math.min(maxFootprint,slotZ-buildingGap);
    for(let ix=0;ix<nx;ix++)for(let iz=0;iz<nz;iz++) {
      const width=Math.min(minFootprint,fitX)+sizeRandom()*(fitX-Math.min(minFootprint,fitX));
      const depth=Math.min(minFootprint,fitZ)+sizeRandom()*(fitZ-Math.min(minFootprint,fitZ));
      // Internal district seams are narrow house gaps, not implied streets.
      // Anchor the edge rows there even when a wide road reduces slot counts.
      const x=ix===0&&!leftStreet?minX+width/2:ix===nx-1&&!rightStreet?maxX-width/2
        :minX+slotX*(ix+.5)-buildingGap/2;
      const z=iz===0&&!topStreet?minZ+depth/2:iz===nz-1&&!bottomStreet?maxZ-depth/2
        :minZ+slotZ*(iz+.5)-buildingGap/2;
      // Neighbouring streets can have end caps projecting into this cell even
      // when its own side is an internal district seam. Keep the full setback.
      if(reserved.some(r=>x+width/2>r.minX+1e-7&&x-width/2<r.maxX-1e-7
        &&z+depth/2>r.minZ+1e-7&&z-depth/2<r.maxZ-1e-7))continue;
      const floors = 2 + Math.floor(random() * 3);
      const height = floors * (2.7 + random() * 0.16);
      buildings.push({ id: id++, x, z, width, depth, height, parcelId:parcels.get(`${bx}:${bz}`),
        color: palettes[Math.floor(random() * palettes.length)], style: Math.floor(random() * 3), landmark: false });
    }
  }

  for (const [x, z, kind] of [[-150, -150, 'tower'], [150, 0, 'hall'], [0, 150, 'clock']]) {
    let landmark = null, closest = Infinity;
    for (const building of buildings) {
      const distance = (building.x - x) ** 2 + (building.z - z) ** 2;
      if (distance < closest) { closest = distance; landmark = building; }
    }
    landmark.landmark = true;
    landmark.kind = kind;
    landmark.height = kind === 'tower' ? 23 : kind === 'hall' ? 12 : 17;
    landmarks.push(landmark.id);
  }

  const roadNetwork = layout.roadNetwork;
  const contour = createRectangleUnionEdges(layout.territory);
  const plan = {
    seed, bounds: CITY_BOUNDS, roads: ROAD_CENTRES, roadWidth, blockPitch: BLOCK_PITCH,
    buildingSetback, sidewalkWidth, buildingFootprint: { min: minFootprint, max: maxFootprint }, buildingGap,
    buildings, landmarks, ...layout, roadNetwork, contour,
    signature: cityLayoutSignature(layout),
  };
  plan.boundaryBuildings=createCityBoundary(plan);
  return plan;
}
