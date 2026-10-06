// Deterministic street grid and buildings, measured in metres.
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
  const sizeRandom = mulberry32(seed ^ 0x51D3A9B7);
  const buildings = [];
  const landmarks = [];
  const palettes = ['#c8a989', '#b9b5a6', '#c58b72', '#8fa39a', '#d0c4a5', '#a98f83'];
  const availableExtent = BLOCK_PITCH / 2 - roadWidth / 2 - sidewalkWidth - buildingSetback;
  const maxFootprint = Math.min(buildingFootprint.max, availableExtent * 2 - buildingGap);
  const minFootprint = Math.min(buildingFootprint.min, maxFootprint);
  if (!Number.isFinite(maxFootprint) || maxFootprint <= 0) throw new RangeError('Road width leaves no room for city buildings.');
  const inset = BLOCK_PITCH / 2 - roadWidth / 2 - sidewalkWidth - buildingSetback - maxFootprint / 2;
  let id = 0;

  for (let bx = 0; bx < ROAD_CENTRES.length - 1; bx++) for (let bz = 0; bz < ROAD_CENTRES.length - 1; bz++) {
    // Keep a generous open plaza at the player spawn.
    if (bx === 3 && bz === 3) continue;
    const cx = (ROAD_CENTRES[bx] + ROAD_CENTRES[bx + 1]) / 2;
    const cz = (ROAD_CENTRES[bz] + ROAD_CENTRES[bz + 1]) / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      random(); random(); // Preserve the height/style sequence for existing city seeds.
      const width = minFootprint + sizeRandom() * (maxFootprint - minFootprint);
      const depth = minFootprint + sizeRandom() * (maxFootprint - minFootprint);
      const floors = 2 + Math.floor(random() * 3);
      const height = floors * (2.7 + random() * 0.16);
      buildings.push({ id: id++, x: cx + sx * inset, z: cz + sz * inset, width, depth, height,
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

  const intersections = ROAD_CENTRES.flatMap(x => ROAD_CENTRES.map(z => ({ x, z, id: `${x}:${z}` })));
  const edges = [];
  for (let x = 0; x < ROAD_CENTRES.length; x++) for (let z = 0; z < ROAD_CENTRES.length; z++) {
    const from = `${ROAD_CENTRES[x]}:${ROAD_CENTRES[z]}`;
    if (x + 1 < ROAD_CENTRES.length) edges.push({ from, to: `${ROAD_CENTRES[x + 1]}:${ROAD_CENTRES[z]}`, length: BLOCK_PITCH });
    if (z + 1 < ROAD_CENTRES.length) edges.push({ from, to: `${ROAD_CENTRES[x]}:${ROAD_CENTRES[z + 1]}`, length: BLOCK_PITCH });
  }
  const roadNetwork = { intersections, edges, horizontal: ROAD_CENTRES, vertical: ROAD_CENTRES };
  return {
    seed, bounds: CITY_BOUNDS, roads: ROAD_CENTRES, roadWidth, blockPitch: BLOCK_PITCH,
    buildingSetback, sidewalkWidth, buildingFootprint: { min: minFootprint, max: maxFootprint }, buildingGap,
    buildings, landmarks, roadNetwork,
  };
}
