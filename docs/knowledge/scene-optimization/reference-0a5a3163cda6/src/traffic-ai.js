const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

export function createRoadGraph(network, laneOffset = 2.8) {
  const nodes = new Map(network.intersections.map(node => [node.id, { ...node }]));
  const adjacency = new Map([...nodes.keys()].map(id => [id, []]));
  const directed = [];
  for (const edge of network.edges) for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
    const a = nodes.get(from), b = nodes.get(to);
    if (!a || !b || !Number.isFinite(edge.length) || edge.length <= 0) continue;
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const forwardX = dx / length, forwardZ = dz / length;
    const rightX = -forwardZ, rightZ = forwardX;
    const routeEdge = { from, to, length, heading: Math.atan2(forwardX, forwardZ),
      start: { x: a.x + rightX * laneOffset, z: a.z + rightZ * laneOffset },
      end: { x: b.x + rightX * laneOffset, z: b.z + rightZ * laneOffset } };
    adjacency.get(from).push(routeEdge);
    directed.push(routeEdge);
  }
  for (const outgoing of adjacency.values()) outgoing.sort((a, b) => a.to.localeCompare(b.to));
  return { nodes, adjacency, directed, laneOffset };
}

/** Deterministic shortest path over oriented street segments. */
export function findRoadRoute(graph, startId, goalId, excludedNodes = new Set()) {
  if (!graph.nodes.has(startId) || !graph.nodes.has(goalId)) return null;
  if (excludedNodes.has(startId) || excludedNodes.has(goalId)) return null;
  if (startId === goalId) return [startId];
  const queue = [startId], previous = new Map([[startId, null]]);
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === goalId) break;
    for (const edge of graph.adjacency.get(current) || []) {
      if (previous.has(edge.to) || excludedNodes.has(edge.to)) continue;
      previous.set(edge.to, current);
      queue.push(edge.to);
    }
  }
  if (!previous.has(goalId)) return null;
  const route = [];
  for (let at = goalId; at !== null; at = previous.get(at)) route.push(at);
  return route.reverse();
}

export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function chooseRoadGoal(graph, currentId, random, previousGoal = null) {
  const ids = [...graph.nodes.keys()].filter(id => id !== currentId && id !== previousGoal).sort();
  if (!ids.length) return null;
  // Try several seeded destinations and retain the first reachable one.
  for (let attempt = 0; attempt < Math.min(ids.length, 12); attempt++) {
    const goal = ids[Math.floor(random() * ids.length)];
    if (findRoadRoute(graph, currentId, goal)?.length > 1) return goal;
  }
  return ids.find(id => findRoadRoute(graph, currentId, id)?.length > 1) || null;
}

export function laneTarget(graph, fromId, toId, fraction = 1) {
  const edge = (graph.adjacency.get(fromId) || []).find(item => item.to === toId);
  if (!edge) return null;
  const t = Math.max(0, Math.min(1, fraction));
  return { x: edge.start.x + (edge.end.x - edge.start.x) * t,
    z: edge.start.z + (edge.end.z - edge.start.z) * t, heading: edge.heading };
}

export function turnDirection(graph, beforeId, nodeId, afterId) {
  const before = graph.nodes.get(beforeId), node = graph.nodes.get(nodeId), after = graph.nodes.get(afterId);
  if (!before || !node || !after) return 'straight';
  const ax = node.x - before.x, az = node.z - before.z;
  const bx = after.x - node.x, bz = after.z - node.z;
  const cross = ax * bz - az * bx;
  if (Math.abs(cross) < 1e-6) return 'straight';
  return cross > 0 ? 'right' : 'left';
}

export function nearestRoadNode(graph, position) {
  let nearest = null, distance = Infinity;
  for (const node of graph.nodes.values()) {
    const next = Math.hypot(node.x - position.x, node.z - position.z);
    if (next < distance) { nearest = node; distance = next; }
  }
  return nearest?.id ?? null;
}

export function headingError(targetHeading, currentHeading) { return wrap(targetHeading - currentHeading); }
