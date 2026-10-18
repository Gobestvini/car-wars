export const PROTOCOL_VERSION = 1;
export function validateInput(payload, roundId = 'round-1') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const allowed = ['roundId', 'seq', 'steer', 'throttle', 'brake', 'handbrake'];
  if (Object.keys(payload).some(k => !allowed.includes(k))) return null;
  if (payload.roundId !== roundId || !Number.isSafeInteger(payload.seq) || payload.seq < 0 || payload.seq > 2147483647) return null;
  if (Object.entries({ steer: 1, throttle: 1, brake: 0 }).some(([k, signed]) =>
    !Number.isFinite(payload[k]) || payload[k] < (signed ? -1 : 0) || payload[k] > 1)) return null;
  if (payload.handbrake !== undefined && typeof payload.handbrake !== 'boolean') return null;
  return { seq: payload.seq, steer: payload.steer, throttle: payload.throttle, brake: payload.brake,
    handbrake: payload.handbrake === true };
}
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}
export function summary(values) {
  return { count: values.length, p50: percentile(values, .5), p95: percentile(values, .95),
    p99: percentile(values, .99), max: values.length ? Math.max(...values.slice(-50000)) : null };
}
