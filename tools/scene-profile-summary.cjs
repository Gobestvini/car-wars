// Read-only reduction of raw benchmark reports. Never averages frame percentiles across runs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = process.argv[2];
assert.ok(directory, 'Pass the raw report directory');
const percentile = (values, fraction) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
};
const reports = fs.readdirSync(directory).filter(name => /-\d+\.json$/.test(name)).sort().map(name => {
  const data = JSON.parse(fs.readFileSync(path.join(directory, name)));
  assert.deepEqual(data.errors, [], name);
  assert.equal(data.profile.overwritten, 0, name);
  assert.equal(new Set(data.profile.rows.map(row => row[0])).size, data.profile.rows.length, name);
  const sampleMax = getter => Math.max(...data.samples.map(getter));
  return {
    file: name, case: data.cfg.id, repeat: data.repeat, code: data.code,
    durationMs: data.elapsedMs, frames: data.profile.rows.length,
    cpu: data.summary, gpu: { status: data.profile.gpu.status, samples: data.profile.gpu.rows.length,
      p50: percentile(data.profile.gpu.rows.map(row => row[1]), .5),
      p95: percentile(data.profile.gpu.rows.map(row => row[1]), .95),
      p99: percentile(data.profile.gpu.rows.map(row => row[1]), .99),
      discarded: data.profile.gpu.discarded, skipped: data.profile.gpu.skipped },
    heapBefore: data.before.heap, heapAfter: data.after.heap,
    resourcesBefore: data.before.resources, resourcesAfter: data.after.resources,
    max: { traffic: sampleMax(s => s.traffic.count), damage: sampleMax(s => s.telemetry.damage),
      tireSmoke: sampleMax(s => s.smoke.active), proxies: sampleMax(s => s.proxies),
      proxyCreated: sampleMax(s => s.occlusion.created), proxyHighWater: sampleMax(s => s.occlusion.highWater),
      vehicleCreated: sampleMax(s => s.trafficPerformance.vehicleCreated) },
    lifecycle: data.events.filter(e => Number.isInteger(e.cycle)).map(e => ({ cycle: e.cycle,
      counts: e.afterGc.traffic.roleCounts, heap: e.afterGc.heap, resources: e.afterGc.resources,
      listeners: e.afterGc.worldListeners, collisionListeners: e.afterGc.bodyCollisionListeners,
      collected: e.collected.pickups.pickups.find(p => p.id === e.pickup.id).status,
      restored: e.restored.pickups.every(p => p.status === 'available') })),
  };
});
const cases = [...new Set(reports.map(r => r.case))].map(id => {
  const runs = reports.filter(r => r.case === id);
  const range = getter => { const values = runs.map(getter); return {
    min: Math.min(...values), median: percentile(values, .5), max: Math.max(...values) }; };
  return { id, repeats: runs.length, cpuP95: range(r => r.cpu.cpuMs.p95),
    physicsP95: range(r => r.cpu.physicsMs.p95), gpuP95: range(r => r.gpu.p95),
    intervalP95: range(r => r.cpu.intervalMs.p95), heapDelta: range(r => r.heapAfter - r.heapBefore) };
});
const result = { directory, reports, cases };
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(cases, null, 2));
