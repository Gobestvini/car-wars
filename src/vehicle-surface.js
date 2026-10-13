// The authored sedan atlases share these 4x4 tile roles. Keep material response
// in linear lighting; the existing final pass owns tone mapping and sRGB.
// Windows are affine UV trapezoids. Evaluate their coverage in screen pixels,
// so even a close view of a 512px traffic atlas has smooth diagonal seals.
export const VEHICLE_WINDOWS_FRAGMENT = `
  #include <map_fragment>
  #ifdef USE_MAP
    float windowTile = floor(vMapUv.x * 4.0) + 4.0 * (3.0 - floor(vMapUv.y * 4.0));
    vec2 windowUV = (vec2(fract(vMapUv.x * 4.0), 1.0 - fract(vMapUv.y * 4.0)) - .03125) / .9375;
    float sideWindow = 1.0 - step(.5, abs(windowTile - 3.0));
    float leftSeal = .035 + mix(.081, .138, sideWindow) * windowUV.y;
    float rightSeal = .965 - mix(.081, .197, sideWindow) * windowUV.y;
    float windowDistance = min(min(windowUV.x-leftSeal, rightSeal-windowUV.x),
      min(windowUV.y-.055, .945-windowUV.y));
    float windowAA = max(fwidth(windowDistance), .00001);
    float coverage = smoothstep(-windowAA*.5, windowAA*.5, windowDistance);
    float pillarDistance = .014 - abs(windowUV.x - .473);
    float pillarAA = max(fwidth(windowUV.x), .00001);
    float pillarCoverage = sideWindow * smoothstep(-pillarAA*.5, pillarAA*.5, pillarDistance);
    vec3 glass = pow((vec3(32.,44.,73.) / 255. + .055) / 1.055, vec3(2.4));
    vec3 pillar = pow((vec3(48.,57.,75.) / 255. + .055) / 1.055, vec3(2.4));
    vec3 paint = texture2D(map, vec2(.125,.875)).rgb;
    if (windowTile >= 1.0 && windowTile <= 3.0) {
      diffuseColor.rgb = diffuse * mix(paint, mix(glass,pillar,pillarCoverage) * (.90+.18*windowUV.y), coverage);
    }
  #endif
`;

export const VEHICLE_ROUGHNESS_FRAGMENT = `
  #include <roughnessmap_fragment>
  #ifdef USE_MAP
    float surfaceTile = floor(vMapUv.x * 4.0) + 4.0 * (3.0 - floor(vMapUv.y * 4.0));
    if (surfaceTile >= 1.0 && surfaceTile <= 3.0) roughnessFactor = 0.38;
    if (abs(surfaceTile - 5.0) < 0.5 || abs(surfaceTile - 7.0) < 0.5) roughnessFactor = 0.95;
    if (abs(surfaceTile - 4.0) < 0.5 || abs(surfaceTile - 6.0) < 0.5) roughnessFactor = 0.48;
  #endif
`;
