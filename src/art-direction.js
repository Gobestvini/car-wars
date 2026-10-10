// Shared sRGB swatches. Pure data: rendering and physics do not depend on the DOM.
export const ART = Object.freeze({
  asphalt: '#566f95', sidewalk: '#f4dfbd', ground: '#ded5c6', roof: '#1877ef',
  fog: '#d7eafa', player: '#c66f24', ink: '#26334c', marking: '#fff6dc',
  facades: ['#f2b9a0', '#ffda87', '#a5ccdc'],
  traffic: ['#6aafe0', '#df8880', '#ba9bde', '#75bccc', '#d8a677', '#7894d6'],
});
export const ART_LIGHT = Object.freeze({ sky: 0xdceaff, ground: 0x9faac8, ambient: 1.65,
  sun: 0xfff1da, intensity: 3.2, exposure: 1.12, offset: Object.freeze([-18, 32, -24]) });

export function buildingArt(building, seed) {
  // Keep this hash separate from city generation, so art cannot move a collider.
  const hash = (Math.imul((building.id + 1) | 0, 2654435761) ^ seed) >>> 0;
  const district = building.x < -70 ? 0 : building.x > 70 ? 2 : 1;
  const family = hash % 3;
  return { family, district, color: ART.facades[family === 2 ? (district + 1) % 3 : district], tint: .94 + (hash % 5) * .025 };
}

export function artQuality(quality) {
  return quality === 'low'
    ? { dpr: 1, shadow: 512, roofDetail: false, edgeBlur: { scale: 0.25, radiiCss: [4, 8, 12] } }
    : { dpr: 1.75, shadow: 1024, roofDetail: true, edgeBlur: { scale: 0.5, radiiCss: [6, 12, 18] } };
}
