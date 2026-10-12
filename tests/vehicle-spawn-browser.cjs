// Run explicitly with node, outside node:test. Uses the real Vite/WebGL game.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const phase = process.argv[2] || 'after';
const output = `docs/knowledge/vehicle-spawn-${phase}.json`;
let referenceMain = null;
if (phase === 'before-controlled') {
  const root = '.task0083-reference';
  const git = args => execFileSync('git', ['-c','safe.directory='+process.cwd().replaceAll('\\','/'),...args], {encoding:'utf8'});
  for (const file of git(['ls-tree','-r','--name-only','9f71cfe','--','src','package.json']).trim().split('\n')) {
    const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});
    let source=git(['show','9f71cfe:'+file]);
    if(file==='src/traffic.js') source=source
      .replace('const servicePending = (maxAdds = 4, maxChecks = 256) => {',
        'const servicePending = (maxAdds = 4, maxChecks = 256) => { const spawnStarted = now();')
      .replace('    return added;', '    profile.spawnMs = now() - spawnStarted; return added;');
    fs.writeFileSync(target,source);
  }
  referenceMain=root+'/src/main.js';
}
const hook = `window.spawnBench = {
  configure(count) { traffic.setCount(count); },
  traffic, scene, renderer, sim,
  async sample(count) {
    traffic.setCount(0);
    await new Promise(resolve => setTimeout(resolve, 150));
    const before = traffic.poolStats(), rows = [], start = performance.now();
    traffic.setCount(count);
    let previous = start, filled = null, previousCounter = carLab.frameCounters().rendered;
    await new Promise((resolve, reject) => {
      function tick(time) {
        const counter = carLab.frameCounters().rendered;
        if (counter === previousCounter) { requestAnimationFrame(tick); return; }
        previousCounter = counter;
        const status = traffic.status(), pools = traffic.poolStats();
        rows.push({ ms: time - previous, count: status.count, spawn: traffic.performance().spawnMs ?? null,
          cpu: carLab.performance().frameCpuMs });
        previous = time;
        if (status.count === count && !status.pending && filled === null) filled = time - start;
        if (filled !== null && time - start >= filled + 10000) return resolve();
        if (time - start > 90000) return reject(new Error('Spawn did not finish: '+JSON.stringify(status)));
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    const values = rows.map(row => row.ms).slice(1).sort((a,b)=>a-b);
    const percentile = p => values[Math.floor((values.length-1)*p)];
    const cpu = rows.map(row=>row.cpu).sort((a,b)=>a-b);
    return { count, filledMs: filled, before, after: traffic.poolStats(),
      frame: { p95: percentile(.95), p99: percentile(.99), max: values.at(-1), over50: values.filter(v=>v>50).length },
      cpu: {p95:cpu[Math.floor((cpu.length-1)*.95)],p99:cpu[Math.floor((cpu.length-1)*.99)],max:cpu.at(-1)},
      maxAdds: Math.max(...rows.map((row,i)=>i ? row.count-rows[i-1].count : 0)),
      maxSpawnMs: Math.max(...rows.map(row=>row.spawn || 0)),
      samples: values.length,
      intervalHistogram: values.reduce((bins,value)=>{const key=(Math.round(value*10)/10).toFixed(1);bins[key]=(bins[key]||0)+1;return bins;},{}),
      rows: rows.filter((row,index)=>row.ms>16.7 || index===0 || row.count!==rows[index-1].count) };
  }
};\n`;
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl'] });
  const report = { phase, viewport: {width:1440,height:900}, quality:'low', runs:[], errors:[] };
  try {
    const page = await browser.newPage({viewport:report.viewport});
    page.on('pageerror', e => report.errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('carwars.defaults.v1', JSON.stringify({version:1,values:{
      quality:'Лёгкая',trafficCount:0,policeCount:0,blurStrength:0,roadWidth:15}})));
    await page.addInitScript(()=>{
      let seed=0x5c3e2026;
      Math.random=()=>{seed=(seed+0x6d2b79f5)>>>0;let n=seed;
        n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return((n^n>>>14)>>>0)/4294967296;};
    });
    await page.route('**/src/main.js*', async route => {
      const response=await route.fetch(referenceMain ? {url:'http://127.0.0.1:5173/'+referenceMain} : {}), source=await response.text();
      await route.fulfill({response,body:source.replace('window.carLab = {',hook+'window.carLab = {')});
    });
    const started=Date.now();
    await page.goto('http://127.0.0.1:5173/?play=1#debug');
    await page.waitForFunction(()=>window.carLab?.modelReady, null, {timeout:120000});
    report.loadMs=Date.now()-started;
    await page.waitForTimeout(1500);
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    report.readyGc=await cdp.send('Runtime.getHeapUsage');
    report.ready=await page.evaluate(()=>({pools:carLab.pools(),heap:performance.memory?.usedJSHeapSize,
      gpu:spawnBench.renderer.info.memory, start:carLab.startScreen()}));
    for(let repeat=0;repeat<3;repeat++) for(const count of [60,300]) {
      console.log(phase,repeat+1,count);
      const run=await page.evaluate(count=>spawnBench.sample(count),count);
      report.runs.push({repeat:repeat+1,...run});
      fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
      if(phase.startsWith('after')) { assert.ok(run.maxAdds<=1); assert.equal(run.after.civilian.created,300);assert.equal(run.after.civilian.evicted,0); }
    }
    report.final=await page.evaluate(()=>({pools:carLab.pools(),heap:performance.memory?.usedJSHeapSize,gpu:spawnBench.renderer.info.memory}));
    await cdp.send('HeapProfiler.collectGarbage');
    report.finalGc=await cdp.send('Runtime.getHeapUsage');
    assert.deepEqual(report.errors,[]);
  } finally {fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n'); await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
