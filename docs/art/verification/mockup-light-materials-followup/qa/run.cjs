const fs = require('node:fs');
process.env.PLAYWRIGHT_MODULE='C:/Users/gobes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
process.env.ART_REVIEW_ROOT='docs/art/verification/mockup-light-materials-followup/qa';
process.argv[2]='runtime';
let source=fs.readFileSync('tools/city-app-check.cjs','utf8').replaceAll("phase==='after'",'true');
source=source.replace("const cold=await page.evaluate",`await page.route('**/src/main.js*', async route=>{ const response=await route.fetch(); let body=await response.text(); body=body.replace('window.carLab = {', 'window.qaDriveStart=()=>{ Object.assign(sim.spawn,{x:-75,z:-50,yaw:0}); reset(); }; window.carLab = {'); await route.fulfill({response,body}); });
   await page.reload();await page.waitForFunction(()=>window.carLab?.modelReady);await page.locator('#loading-screen').waitFor({state:'hidden'});
   const cold=await page.evaluate`);
source=source.replace("await page.keyboard.down('KeyW');await page.waitForTimeout(1500);await page.keyboard.up('KeyW');",`await page.evaluate(()=>qaDriveStart());
   const crossing=[]; await page.keyboard.down('KeyW');
   for(let i=0;i<120;i++){ await page.waitForTimeout(500); const item=await page.evaluate(()=>({telemetry:carLab.telemetry(),shadow:carLab.shadow(),camera:carLab.camera()}));crossing.push(item); if(i%8===0) await page.screenshot({path:out+'/crossing-'+i+'.png'}); if(item.telemetry.position.z>-10)break; }
   await page.keyboard.up('KeyW');
   fs.writeFileSync(out+'/crossing.json',JSON.stringify(crossing,null,2));
   assert.ok(crossing[0].telemetry.position.z < -34.5); assert.ok(crossing.at(-1).telemetry.position.z > -15.5,'Full intersection crossing');
   report.crossing={start:crossing[0].telemetry.position,end:crossing.at(-1).telemetry.position,samples:crossing.length};`);
source=source.replace('if(i%8===0)', 'if(true)');
source=source.replace("assert.deepEqual(errors,[]);await page.close();", `report.environment=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2');const ext=gl.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,dpr:devicePixelRatio,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR)};});assert.deepEqual(errors,[]);await page.close();`);
eval(source);
