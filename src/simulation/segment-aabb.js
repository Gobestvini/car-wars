export function segmentAabbEntry(start, end, bounds) {
  let minimum = 0;
  let maximum = 1;
  for (const axis of ['x', 'y', 'z']) {
    const origin = start[axis];
    const delta = end[axis] - origin;
    if (Math.abs(delta) < 1e-9) {
      if (origin < bounds.min[axis] || origin > bounds.max[axis]) return null;
      continue;
    }
    let near = (bounds.min[axis] - origin) / delta;
    let far = (bounds.max[axis] - origin) / delta;
    if (near > far) [near, far] = [far, near];
    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);
    if (minimum > maximum) return null;
  }
  return maximum > 1e-4 && minimum < 1 - 1e-4 ? minimum : null;
}

export function segmentIntersectsAabb(start, end, bounds) {
  return segmentAabbEntry(start, end, bounds) !== null;
}
