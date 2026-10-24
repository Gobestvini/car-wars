const {chromium}=require(process.env.PLAYWRIGHT_MODULE),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const {startHostedServer}=await import(require('node:url').pathToFileURL(path.resolve('tools/multiplayer-spike/deploy/server.js')).href),{createServer}=await import('vite');
 const service=await startHostedServer({port:0,host:'127.0.0.1'}),endpoint='http://127.0.0.1:'+service.server.transport.server.address().port;
 const vite=await createServer({server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_GAME_SERVER_URL':JSON.stringify(endpoint)}});await vite.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],pages=[];
 try{
  for(let i=0;i<3;i++){
   const context=await browser.newContext({viewport:{width:1440,height:900}}),p=await context.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));
   await p.addInitScript(()=>{const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){this.canvas.dataset.qaText=String(text);return original.call(this,text,...args);};});
   await p.route('**/src/multiplayer/game.js*',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:body.replace('window.__multiplayer={snapshot:','window.__clientHarness={network,models};window.__multiplayer={snapshot:')});});
   await p.goto('http://127.0.0.1:'+vite.httpServer.address().port+'/?online=1');await p.waitForFunction(()=>window.__multiplayer,null,{timeout:120000});
  }
  async function join(p,id){if(id){await p.locator('#online-room').fill(id);await p.locator('#online-join').click();}else await p.locator('#online-create').click();await p.waitForFunction(()=>__multiplayer.snapshot().ready,null,{timeout:120000});return p.evaluate(()=>__multiplayer.snapshot());}
  const first=await join(pages[0]);await join(pages[1],first.roomId);await join(pages[2],first.roomId);
  await pages[0].waitForFunction(()=>[...__clientHarness.models.values()].filter(m=>m.player).length===3);
  const labels=()=>pages[0].evaluate(()=>[...__clientHarness.models].filter(([,m])=>m.player).map(([id,m])=>({id,text:m.texture.image.dataset.qaText,labelBackground:Array.from(m.texture.image.getContext('2d').getImageData(128,10,1,1).data).slice(0,3),bodyColor:m.body.material.color.getHexString()})));
  const before=await labels();await pages[1].locator('#online-menu').click();await pages[1].locator('#online-leave').click();
  await pages[0].waitForFunction(()=>[...__clientHarness.models.values()].filter(m=>m.player).length===2);
  const middle=await labels();await join(pages[1],first.roomId);await pages[0].waitForFunction(()=>[...__clientHarness.models.values()].filter(m=>m.player).length===3);
  const after=await labels(),remote=after.filter(m=>m.text!=='Вы'),result={before,middle,after,errors,defect:new Set(remote.map(m=>m.text)).size!==remote.length||new Set(remote.map(m=>String(m.labelBackground))).size!==remote.length};
  fs.writeFileSync('docs/knowledge/multiplayer/2026-10-24-client/qa-accept/label-rejoin.json',JSON.stringify(result,null,2));
  const room=[...service.rooms].find(r=>r.roomId===first.roomId);let x=0;for(const player of room.sim.players.values()){player.sim.body.position.set(x,0.96,0);player.sim.body.velocity.setZero();player.sim.body.aabbNeedsUpdate=true;x+=5;}
  await pages[0].waitForTimeout(1000);await pages[0].screenshot({path:'docs/knowledge/multiplayer/2026-10-24-client/qa-accept/label-rejoin.png'});console.log(result);
 }finally{await browser.close();await vite.close();await service.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});


