// The authored sedan atlases share these 4x4 tile roles. Keep material response
// in linear lighting; the existing final pass owns tone mapping and sRGB.
export const VEHICLE_ROUGHNESS_FRAGMENT = `
  #include <roughnessmap_fragment>
  #ifdef USE_MAP
    float surfaceTile = floor(vMapUv.x * 4.0) + 4.0 * (3.0 - floor(vMapUv.y * 4.0));
    if (surfaceTile >= 1.0 && surfaceTile <= 3.0) roughnessFactor = 0.38;
    if (abs(surfaceTile - 5.0) < 0.5 || abs(surfaceTile - 7.0) < 0.5) roughnessFactor = 0.95;
    if (abs(surfaceTile - 4.0) < 0.5 || abs(surfaceTile - 6.0) < 0.5) roughnessFactor = 0.48;
  #endif
`;
