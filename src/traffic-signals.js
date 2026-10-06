export const SIGNAL_TIMING = Object.freeze({ green: 8, yellow: 2, allRed: 1 });
export const SIGNAL_PERIOD = (SIGNAL_TIMING.green + SIGNAL_TIMING.yellow + SIGNAL_TIMING.allRed) * 2;

const stableOffset = id => {
  let value = 2166136261;
  for (const char of id) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return (value >>> 0) / 4294967296 * SIGNAL_PERIOD;
};

export function createTrafficSignals(network, timing = SIGNAL_TIMING) {
  const nodes = new Map(network.intersections.map(node => [node.id, node]));
  const controlled = new Set();
  for (const node of network.intersections) {
    const [x, z] = node.id.split(':').map(Number);
    const degree = network.edges.reduce((count, edge) => count + Number(edge.from === node.id || edge.to === node.id), 0);
    if (degree >= 4 && Number.isFinite(x + z)) controlled.add(node.id);
  }
  const cycle = (timing.green + timing.yellow + timing.allRed) * 2;
  return {
    timing, controlled,
    phase(nodeId, fromId, time) {
      if (!controlled.has(nodeId) || !nodes.has(nodeId) || !nodes.has(fromId)) return { color: 'priority', canEnter: true, controlled: false };
      const node = nodes.get(nodeId), from = nodes.get(fromId);
      const axis = node.x === from.x ? 'ns' : 'ew';
      const local = ((time + stableOffset(nodeId)) % cycle + cycle) % cycle;
      const green = timing.green, yellow = timing.yellow, allRed = timing.allRed;
      const inFirstAxis = local < green + yellow + allRed;
      const activeAxis = inFirstAxis ? 'ns' : 'ew';
      const axisTime = inFirstAxis ? local : local - green - yellow - allRed;
      let color = axis !== activeAxis ? 'red' : axisTime < green ? 'green' : axisTime < green + yellow ? 'yellow' : 'red';
      return { color, axis, canEnter: color === 'green', controlled: true };
    },
    reset() {},
  };
}
