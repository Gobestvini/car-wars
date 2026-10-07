export const TRAFFIC_SPAWN = Object.freeze({
  endpointClearance: 15,
  slotSpacing: 7,
  minimumGap: 2,
  timeHeadway: 0.8,
  braking: 5.5,
  halfLength: 2.08,
  halfWidth: 0.87,
});

export function createTrafficSpawnSlots(directedEdges) {
  const byEdge = directedEdges.map(edge => {
    const slots = [];
    for (let distance = TRAFFIC_SPAWN.endpointClearance;
      distance <= edge.length - TRAFFIC_SPAWN.endpointClearance; distance += TRAFFIC_SPAWN.slotSpacing) {
      const t = distance / edge.length;
      slots.push({ x: edge.start.x + (edge.end.x - edge.start.x) * t,
        z: edge.start.z + (edge.end.z - edge.start.z) * t,
        heading: edge.heading, edge, t });
    }
    return slots;
  });
  const slots = [];
  for (let index = 0; byEdge.some(edgeSlots => index < edgeSlots.length); index++) {
    for (const edgeSlots of byEdge) if (edgeSlots[index]) slots.push(edgeSlots[index]);
  }
  return slots;
}

/** Interleave lanes from the whole map in proportion to available safe spawn slots. */
export function distributeTrafficSpawnSlots(slots, bounds, divisions = 3) {
  if (!slots.length || !bounds || !Number.isInteger(divisions) || divisions < 1) return [...slots];
  const width = Math.max(1e-8, bounds.maxX - bounds.minX);
  const depth = Math.max(1e-8, bounds.maxZ - bounds.minZ);
  const sectors = Array.from({ length: divisions * divisions }, () => []);
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    const slot = slots[slotIndex];
    const column = Math.max(0, Math.min(divisions - 1, Math.floor((slot.x - bounds.minX) / width * divisions)));
    const row = Math.max(0, Math.min(divisions - 1, Math.floor((slot.z - bounds.minZ) / depth * divisions)));
    sectors[row * divisions + column].push({ slot, slotIndex });
  }
  const cursor = new Uint32Array(sectors.length), ordered = [];
  while (ordered.length < slots.length) {
    let selected = -1, lowestShare = Infinity, earliest = Infinity;
    for (let index = 0; index < sectors.length; index++) {
      const sector = sectors[index];
      if (cursor[index] >= sector.length) continue;
      const share = cursor[index] / sector.length;
      const firstUnallocated = sector[cursor[index]].slotIndex;
      if (share < lowestShare || share === lowestShare && firstUnallocated < earliest) {
        selected = index; lowestShare = share; earliest = firstUnallocated;
      }
    }
    if (selected < 0) break;
    ordered.push(sectors[selected][cursor[selected]++].slot);
  }
  return ordered;
}

function projectedHalfExtent(item, axisX, axisZ) {
  const heading = item.heading ?? 0;
  const forwardX = Math.sin(heading), forwardZ = Math.cos(heading);
  const rightX = Math.cos(heading), rightZ = -Math.sin(heading);
  const halfLength = item.halfLength ?? item.halfZ ?? TRAFFIC_SPAWN.halfLength;
  const halfWidth = item.halfWidth ?? item.halfX ?? TRAFFIC_SPAWN.halfWidth;
  return halfLength * Math.abs(forwardX * axisX + forwardZ * axisZ)
    + halfWidth * Math.abs(rightX * axisX + rightZ * axisZ);
}

export function footprintsOverlap(a, b, clearance = 0) {
  const headingA = a.heading ?? 0, headingB = b.heading ?? 0;
  const axes = [[Math.sin(headingA), Math.cos(headingA)], [Math.cos(headingA), -Math.sin(headingA)],
    [Math.sin(headingB), Math.cos(headingB)], [Math.cos(headingB), -Math.sin(headingB)]];
  const dx = b.x - a.x, dz = b.z - a.z;
  return axes.every(([axisX, axisZ]) => {
    const separation = Math.abs(dx * axisX + dz * axisZ);
    return separation < projectedHalfExtent(a, axisX, axisZ) + projectedHalfExtent(b, axisX, axisZ) + clearance;
  });
}

function unsafeClosingGap(candidate, other, minimumGap) {
  const forwardX = Math.sin(candidate.heading), forwardZ = Math.cos(candidate.heading);
  const rightX = Math.cos(candidate.heading), rightZ = -Math.sin(candidate.heading);
  const dx = other.x - candidate.x, dz = other.z - candidate.z;
  const ahead = dx * forwardX + dz * forwardZ;
  const lateral = Math.abs(dx * rightX + dz * rightZ);
  const headingAgreement = Math.abs(Math.sin(other.heading) * forwardX + Math.cos(other.heading) * forwardZ);
  if (lateral > TRAFFIC_SPAWN.halfWidth * 2 + 0.2 || headingAgreement < 0.9) return false;
  const bumperGap = Math.abs(ahead) - TRAFFIC_SPAWN.halfLength * 2;
  const otherAlong = other.vx * forwardX + other.vz * forwardZ;
  const followerSpeed = ahead < 0 ? Math.max(0, otherAlong) : Math.max(0, -otherAlong);
  const closingSpeed = followerSpeed;
  const required = minimumGap + TRAFFIC_SPAWN.timeHeadway * followerSpeed
    + closingSpeed * closingSpeed / (2 * TRAFFIC_SPAWN.braking);
  return bumperGap < required;
}

export function isTrafficSpawnSafe(candidate, occupants, obstacles = [], minimumGap = TRAFFIC_SPAWN.minimumGap) {
  if (obstacles.some(obstacle => footprintsOverlap(candidate, obstacle, 0.2))) return false;
  for (const other of occupants) {
    if (footprintsOverlap(candidate, other, minimumGap) || unsafeClosingGap(candidate, other, minimumGap)) return false;
  }
  return true;
}
