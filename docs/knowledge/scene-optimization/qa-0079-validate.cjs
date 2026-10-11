const fs=require('node:fs'),assert=require('node:assert/strict');
const root='docs/knowledge/scene-optimization/';
const reports=fs.readdirSync(root+'baseline-stable').filter(n=>/-\d+\.json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(root+'baseline-stable/'+n)));
assert.equal(reports.length,18);
const cases={};
for(const r of reports){
 assert.deepEqual(r.errors,[]);assert.equal(r.quick,false);assert.equal(r.warmupMs,10000);
 assert.ok(r.elapsedMs>=r.cfg.duration);assert.equal(r.profile.overwritten,0);
 assert.equal(new Set(r.profile.rows.map(a=>a[0])).size,r.profile.rows.length);
 assert.ok(r.profile.rows.slice(1).every((a,i)=>a[0]>r.profile.rows[i][0]&&a[1]>r.profile.rows[i][1]&&Math.abs(a[2]-(a[1]-r.profile.rows[i][1]))<1e-7));
 assert.ok(r.cpuAffinity.processes.filter(p=>p.present).every(p=>p.affinity===1));
 assert.equal(r.profile.gpu.status,'available');assert.equal(r.profile.gpu.discarded,0);assert.equal(r.profile.gpu.skipped,0);
 const ids=new Set(r.profile.rows.map(a=>a[0]));assert.ok(r.profile.gpu.rows.every(a=>ids.has(a[0])&&a[1]>=0));
 cases[r.cfg.id]=(cases[r.cfg.id]||[]).concat(r.repeat);
 if(r.cfg.lifecycle){const events=r.events.filter(e=>Number.isInteger(e.cycle));assert.equal(events.length,10);
  for(const e of events){assert.equal(e.collected.pickups.pickups.find(p=>p.id===e.pickup.id).status,'consumed');assert.ok(e.restored.pickups.every(p=>p.status==='available'));}
 }
}
for(const repeats of Object.values(cases))assert.deepEqual(repeats.sort(),[1,2,3]);
assert.equal(new Set(reports.map(r=>r.code.sourceHash)).size,1);
const effects=fs.readdirSync(root+'effects-baseline').filter(n=>/-\d+\.json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(root+'effects-baseline/'+n)));
assert.equal(effects.length,6);for(const r of effects){assert.deepEqual(r.errors,[]);assert.equal(r.durationMs,60000);assert.equal(r.samples.length,60);assert.equal(r.profile.overwritten,0);assert.equal(new Set(r.profile.rows.map(a=>a[0])).size,r.profile.rows.length);assert.ok(r.scenario==='skid'?r.max.tireSmoke>0&&r.max.damageSmoke>0:r.max.proxies>0&&r.max.proxyCreated>1);}
const allocation=JSON.parse(fs.readFileSync(root+'allocation-stable/desktop-high-300-1.json'));assert.equal(allocation.allocationRun,true);assert.ok(allocation.allocations.head.children.length>0);
console.log(JSON.stringify({passed:true,reports:reports.length,cases,effects:effects.map(r=>({scenario:r.scenario,repeat:r.repeat,max:r.max})),sourceHash:reports[0].code.sourceHash}));
