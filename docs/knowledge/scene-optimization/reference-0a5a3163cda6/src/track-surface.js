const UV = [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1];
const interpolate = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

/** Clip a decal to the sampled horizontal surfaces instead of bridging through a curb.
 * Each vertex carries x/y/z, birth, fade and UV; subdivision preserves their interpolation.
 * Only mixed-height triangles use the bounded boundary search. No city/marking scan is added.
 */
export function conformTrackSegment(segment, sampleHeight) {
  const vertices = Array.from({ length: 6 }, (_, i) => {
    const p = segment.positions.slice(i * 3, i * 3 + 3);
    p[1] = sampleHeight(p[0], p[2]);
    return [...p, segment.births[i], segment.fades[i], UV[i * 2], UV[i * 2 + 1]];
  });
  if (vertices.every(p => Math.abs(p[1] - vertices[0][1]) < 1e-6)) {
    return [{ ...segment, positions: vertices.flatMap(p => p.slice(0, 3)), uvs: UV }];
  }
  const triangles = [];
  const fan = polygon => {
    for (let i = 1; i + 1 < polygon.length; i++) triangles.push([polygon[0], polygon[i], polygon[i + 1]]);
  };
  for (let i = 0; i < 6; i += 3) {
    const triangle = vertices.slice(i, i + 3);
    const low = Math.min(...triangle.map(p => p[1])), high = Math.max(...triangle.map(p => p[1]));
    if (high - low < 1e-6) { triangles.push(triangle); continue; }
    const threshold = (low + high) / 2;
    const intersections = [];
    const boundary = (a, b) => {
      const aLow = a[1] <= threshold;
      let from = 0, to = 1;
      for (let iteration = 0; iteration < 14; iteration++) {
        const t = (from + to) / 2;
        const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
        if ((sampleHeight(x, z) <= threshold) === aLow) from = t;
        else to = t;
      }
      return interpolate(a, b, (from + to) / 2);
    };
    for (const lower of [true, false]) {
      const polygon = [];
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge], b = triangle[(edge + 1) % 3];
        const aInside = (a[1] <= threshold) === lower, bInside = (b[1] <= threshold) === lower;
        if (aInside) polygon.push([...a]);
        if (aInside !== bInside) {
          const point = boundary(a, b); point[1] = lower ? low : high;
          polygon.push(point);
          if (lower) intersections.push(point);
        }
      }
      fan(polygon);
    }
    // The two flat layers meet on the actual vertical curb face, rather than
    // on a diagonal ribbon floating over the road or hidden under the sidewalk.
    if (intersections.length === 2) {
      const [a, b] = intersections, topA = [...a], topB = [...b];
      topA[1] = high; topB[1] = high;
      triangles.push([a, b, topA], [b, topB, topA]);
    }
  }
  const parts = [];
  for (let i = 0; i < triangles.length; i += 2) {
    const first = triangles[i], second = triangles[i + 1] || [first[2], first[2], first[2]];
    const points = [...first, ...second];
    parts.push({ positions: points.flatMap(p => p.slice(0, 3)), births: points.map(p => p[3]),
      fades: points.map(p => p[4]), uvs: points.flatMap(p => p.slice(5, 7)) });
  }
  return parts;
}
