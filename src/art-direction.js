// Shared sRGB swatches. Pure data: rendering and physics do not depend on the DOM.
export const ART = Object.freeze({
  asphalt: '#58677a', sidewalk: '#d8c49a', ground: '#dbd8cf', roof: '#4779b0',
  fog: '#d7eafa', player: '#c66f24', ink: '#26334c', marking: '#fff6dc',
  facades: ['#f6a5a0', '#ffc876', '#7dc4ed'],
  traffic: ['#6aafe0', '#df8880', '#ba9bde', '#75bccc', '#d8a677', '#7894d6'],
});
export const ART_LIGHT = Object.freeze({ sky: 0xffffff, ground: 0x9ca8c7, ambient: 1.8,
  sun: 0xffefd4, intensity: 2.4, exposure: 1.08 });

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
