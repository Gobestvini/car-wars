// Independent hosted NPC contact, observed by three real WebGL clients.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),spike=createRequire(path.resolve('tools/multiplayer-spike/package.json'));
const {matchMaker}=spike('@colyseus/core'),out=__dirname;
const report={date:'2026-10-19',errors:[]},delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test){const end=Date.now()+15000;while(!test()){if(Date.now()>end)throw Error('NPC fixture timeout');await delay(10);}}
const hook=`window.__qaNpc={network,city:()=>city,target:null,frozen:false};const originalStart=network.startPrediction.bind(network);network.startPrediction=(...args)=>{originalStart(...args);const advance=network.prediction.advance.bind(network.prediction);network.prediction.advance=(...a)=>{if(__qaNpc.frozen)return;const result=advance(...a);if(network.prediction.world.props.entries.some(e=>e.id===__qaNpc.target&&e.state==='detached'))__qaNpc.frozen=true;return result;};};`;
(async()=>{
 process.env.CARWARS_FIXED_SEED='42';const {startHostedServer}=await import('../../../tools/multiplayer-spike/deploy/server.js');
 const service=await startHostedServer({port:2577,host:'127.0.0.1'}),browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
 try{
  const pages=[];let roomId;
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
   const p=await browser.newPage({viewport});p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
   await p.route('**/src/multiplayer/game.js*',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('window.__multiplayer={snapshot:',hook+'window.__multiplayer={snapshot:')});});
   await p.goto('http://127.0.0.1:5173/?online=1&netdebug=1');await p.waitForFunction(()=>window.__multiplayer,null,{timeout:120000});
   if(roomId){await p.locator('#online-room').fill(roomId);await p.locator('#online-join').click();}else await p.locator('#online-create').click();
   await p.waitForFunction(()=>__multiplayer.snapshot().ready&&__multiplayer.snapshot().actors.length>0,null,{timeout:120000});roomId=await p.evaluate(()=>__multiplayer.snapshot().roomId);pages.push(p);
  }
  const world=matchMaker.getLocalRoomById(roomId).sim,e=world.props.entries.find(e=>e.type==='bin'),npc=world.npcs[0],yaw=e.yaw+Math.PI,fx=Math.sin(yaw),fz=Math.cos(yaw);
  world.allPhysical=true;
  for(const p of pages)await p.evaluate(id=>__qaNpc.target=id,e.id);
  let i=0;for(const player of world.players.values()){player.sim.spawn={x:e.x-fx*8+5+i++*5,y:e.y+.65,z:e.z-fz*8,yaw};player.sim.reset();player.generation++;world.halt(player.id);}
  npc.sim.spawn={x:e.x-fx*2.5,y:e.y+.65,z:e.z-fz*2.5,yaw};npc.sim.reset();npc.sim.body.velocity.set(fx*20,0,fz*20);npc.generation++;
  npc.physical=true;if(!world.world.bodies.includes(npc.sim.body))world.world.addBody(npc.sim.body);npc.control={steer:0,throttle:0,brake:0};
  await until(()=>e.state==='detached');assert.equal(world.world.bodies.includes(e.body),false);
  await Promise.all(pages.map(p=>p.waitForFunction(()=>__qaNpc.frozen&&[...__qaNpc.city().propFade.active.values()].some(r=>r.group.userData.propId===__qaNpc.target))));
  report.observations=await Promise.all(pages.map(p=>p.evaluate(npcId=>{const h=__qaNpc,p=h.network.prediction.world,e=p.props.entries.find(e=>e.id===h.target),r=[...h.city().propFade.active.values()].find(r=>r.group.userData.propId===e.id);return {id:e.id,state:e.state,physical:p.world.bodies.includes(e.body),alpha:r.meshes.map(m=>m.material.opacity),npcPresent:__multiplayer.snapshot().actors.some(a=>a.id===npcId)};},npc.id)));
  report.actor={id:npc.id,role:npc.role,physical:npc.physical};
  for(const item of report.observations){assert.equal(item.state,'detached');assert.equal(item.physical,false);assert.ok(item.alpha.every(a=>a>0&&a<=.45));assert.equal(item.npcPresent,true);}
  await pages[0].screenshot({path:path.join(out,'npc-bin-ghost.png')});
  for(const p of pages.slice(1))await p.evaluate(()=>__qaNpc.network.leave());
  await pages[0].locator('#online-share').click();await pages[0].locator('#online-leave').click();
  await pages[0].evaluate(()=>{__qaNpc.frozen=false;__qaNpc.target=null;});await pages[0].locator('#online-create').click();
  await pages[0].waitForFunction(old=>__multiplayer.snapshot().ready&&__multiplayer.snapshot().roomId!==old&&__multiplayer.snapshot().actors.length>0,roomId,{timeout:120000});
  report.newRoom=await pages[0].evaluate(id=>{const h=__qaNpc,p=h.network.prediction.world,e=p.props.entries.find(e=>e.id===id);return {room:__multiplayer.snapshot().roomId,state:e.state,registry:h.city().propPhysics.entries.get(id).state,ghosts:h.city().propFade.stats().active};},e.id);
  assert.equal(report.newRoom.state,'intact');assert.equal(report.newRoom.registry,'intact');assert.equal(report.newRoom.ghosts,0);
  await pages[0].evaluate(()=>__qaNpc.network.leave());assert.deepEqual(report.errors,[]);console.log('NPC impact replicated to all three clients without removing the NPC; new room restores intact');
 }finally{await browser.close();await service.close();fs.writeFileSync(path.join(out,'npc-prop-report.json'),JSON.stringify(report,null,2));}
})().catch(e=>{report.failure=e.stack;fs.writeFileSync(path.join(out,'npc-prop-report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
