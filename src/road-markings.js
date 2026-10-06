export function createRoadMarkings(roadCenters, bounds, roadWidth, spacing = 6, endMargin = 6) {
  const marks = [];
  for (const road of roadCenters) {
    for (let offset = -bounds + endMargin; offset <= bounds - endMargin; offset += spacing) {
      if (roadCenters.some(cross => Math.abs(offset - cross) < roadWidth / 2 + 3)) continue;
      marks.push({ x: road, z: offset, yaw: 0, axis: 'z' });
      marks.push({ x: offset, z: road, yaw: Math.PI / 2, axis: 'x' });
    }
  }
  return marks;
}
