// Pairwise diagnostic only: this does not replace the six-case acceptance matrix.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2];
assert.ok(root, 'Pass the sequential comparison directory');
const sequence = JSON.parse(fs.readFileSync(path.join(root, 'sequence.json'), 'utf8').replace(/^\uFEFF/, ''));
const quantile = (values, fraction) => {
  const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b);
  return sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)] ?? null;
};
const reports = sequence.flatMap(event => {
  assert.equal(event.exitCode, 0, 'Wait for all runs to finish');
  const directory = path.join(root, `${event.version}-${event.pair}`);
  return fs.readdirSync(directory).filter(name=>/-\d+\.json$/.test(name)).map(name=>{
    const data = JSON.parse(fs.readFileSync(path.join(directory,name)));
    assert.deepEqual(data.errors,[]); assert.equal(data.quick,false);
    assert.equal(data.profile.overwritten,0);
    return {event,name,data};
  });
});
const pairs = reports.filter(r=>r.event.version==='reference').map(before=>{
  const after=reports.find(r=>r.event.pair===before.event.pair&&r.event.version==='current'&&r.data.cfg.id===before.data.cfg.id);
  assert.ok(after,'Missing candidate');
  const b=before.data,a=after.data;
  assert.deepEqual(a.cfg,b.cfg);assert.deepEqual(a.pose,b.pose);
  assert.deepEqual({...a.protocol,referenceRevision:null},{...b.protocol,referenceRevision:null});
  assert.equal(a.browser,b.browser);assert.equal(a.device,b.device);
  const gpu = report => report.profile.gpu.status==='available' ? quantile(report.profile.gpu.rows.map(row=>row[1]),.95) : null;
  const fields=['cpuMs','physicsMs','renderCpuMs','intervalMs','worldStepMs'];
  return {pair:before.event.pair,case:a.cfg.id,referenceCode:b.code,candidateCode:a.code,
    measurements:Object.fromEntries(fields.map(field=>[field,{before:b.summary[field].p95,after:a.summary[field].p95,
      ratio:a.summary[field].p95/b.summary[field].p95}])),gpuP95:{before:gpu(b),after:gpu(a)}};
});
const cases=[...new Set(pairs.map(p=>p.case))].map(id=>{
  const values=pairs.filter(p=>p.case===id);
  return {id,pairs:values.length,metrics:Object.fromEntries(Object.keys(values[0].measurements).map(field=>{
    const stats=side=>{const numbers=values.map(p=>p.measurements[field][side]);return{min:Math.min(...numbers),median:quantile(numbers,.5),max:Math.max(...numbers)};};
    return[field,{before:stats('before'),after:stats('after'),pairedRatios:stats('ratio')}];
  }))};
});
const result={purpose:'Alternating-order control to diagnose changing host timings; acceptance budgets remain unchanged.',sequence,pairs,cases};
fs.writeFileSync(path.join(root,'comparison.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(cases,null,2));
