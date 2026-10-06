import { findRoadRoute } from './traffic-ai.js';
import { segmentIntersectsAabb } from './building-occlusion.js';

export const TRAFFIC_EVASION = Object.freeze({ impactSpeed: 1.5, speed: 16,
  minimumDuration: 6, maximumDuration: 20, safeDistance: 60, replanInterval: 3 });

export function hiddenFromPlayer(car, player, obstacles) {
  return obstacles.some(box => {
    const heading = box.heading || 0, c = Math.cos(heading), s = Math.sin(heading);
    const local = point => ({ x: (point.x - box.x) * c - (point.z - box.z) * s,
      z: (point.x - box.x) * s + (point.z - box.z) * c, y: 1 });
    return segmentIntersectsAabb(local(player), local(car), {
      min: { x: -box.halfX, y: 0, z: -box.halfZ }, max: { x: box.halfX, y: 2, z: box.halfZ } });
  });
}

/** Prefer distant, occluded streets without turning back into the pursuer. */
export function escapeRoute(graph, edge, player, obstacles) {
  let best = null, score = -Infinity;
  for (const node of graph.nodes.values()) {
    if (node.id === edge.to) continue;
    const route = findRoadRoute(graph, edge.to, node.id);
    if (!route || route.length < 2) continue;
    const next = graph.adjacency.get(edge.to).find(item => item.to === route[1]);
    const distance = Math.hypot(node.x - player.x, node.z - player.z);
    const value = distance + (hiddenFromPlayer(node, player, obstacles) ? 35 : 0)
      - route.length * 0.8 - (Math.cos(next.heading - edge.heading) < -0.5 ? 100 : 0);
    if (value > score) { score = value; best = route; }
  }
  return best;
}
