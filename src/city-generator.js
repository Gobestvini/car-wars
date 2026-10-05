// Small deterministic European-style district, measured in metres.
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

export const CITY_BOUNDS = 110;
export const ROAD_WIDTH = 22;
export const ROAD_CENTRES = [-75, -25, 25, 75];
export const BLOCK_PITCH = 50;
export const BUILDING_SETBACK = 1.5;

export function createCityPlan(seed = 20261005) {
  const random = mulberry32(seed);
  const buildings = [];
  const landmarks = [];
  const palettes = ['#c8a989', '#b9b5a6', '#c58b72', '#8fa39a', '#d0c4a5', '#a98f83'];
  let id = 0;
  for (let bx = 0; bx < 3; bx++) for (let bz = 0; bz < 3; bz++) {
    const cx = -BLOCK_PITCH + bx * BLOCK_PITCH, cz = -BLOCK_PITCH + bz * BLOCK_PITCH;
    // Keep the centre entirely open as a broad starting plaza.
    if (bx === 1 && bz === 1) continue;
    const inset = 9;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const width = 4.4 + random() * 0.8;
      const depth = 4.4 + random() * 0.8;
      const floors = 2 + Math.floor(random() * 3);
      const height = floors * (2.7 + random() * 0.16);
      buildings.push({ id: id++, x: cx + sx * inset, z: cz + sz * inset, width, depth, height, color: palettes[Math.floor(random() * palettes.length)], style: Math.floor(random() * 3), landmark: false });
    }
  }
  // Three low-poly landmarks break up the roofline and are also collidable.
  for (const [x, z, kind] of [[-BLOCK_PITCH, -BLOCK_PITCH, 'tower'], [BLOCK_PITCH, 0, 'hall'], [0, BLOCK_PITCH, 'clock']]) {
    const building = buildings.find(item => Math.abs(item.x - x) < 12 && Math.abs(item.z - z) < 12);
    if (building) {
      building.landmark = true;
      building.kind = kind;
      building.height = kind === 'tower' ? 23 : kind === 'hall' ? 12 : 17;
      landmarks.push(building.id);
    }
  }
  return { seed, bounds: CITY_BOUNDS, roads: ROAD_CENTRES, roadWidth: ROAD_WIDTH, blockPitch: BLOCK_PITCH, buildingSetback: BUILDING_SETBACK, buildings, landmarks };
}
