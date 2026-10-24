const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const out=process.env.ARTIFACT_DIR||'docs/knowledge/multiplayer/2026-10-24-client';
const report={date:new Date().toISOString(),browsers:['Edge','Chrome'],mobile:'390x844 touch emulation, low',cases:[],errors:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=20000){const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw Error('Client browser fixture timeout');await delay(20);}}
(async()=>{
 fs.mkdirSync(out,{recursive:true});process.env.CARWARS_FIXED_SEED='42';
 const {startHostedServer}=await import('../tools/multiplayer-spike/deploy/server.js');const {createServer}=await import('vite');
 const address=Object.values(os.networkInterfaces()).flat().find(a=>a.family==='IPv4'&&!a.internal)?.address||'127.0.0.1';
 const service=await startHostedServer({port:0,host:'0.0.0.0',maxRooms:3});
 const endpoint=`http://${address}:${service.server.transport.server.address().port}`;report.serverEndpoint=endpoint;
 const vite=await createServer({server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_GAME_SERVER_URL':JSON.stringify(endpoint)}});await vite.listen();
 const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
 const edge=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']}),chrome=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl']});
 const pages=[];let stage='boot';
 async function page(browser,mobile=false){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
  const p=await context.newPage();pages.push(p);p.on('pageerror',e=>report.errors.push(e.message));
  await p.route('**/src/multiplayer/game.js*',async route=>{const response=await route.fetch(),body=await response.text();
   await route.fulfill({response,body:body.replace('window.__multiplayer={snapshot:','window.__clientHarness={network,models,scene};window.__multiplayer={snapshot:')});});
  await p.goto(base+'/?online=1&netdebug=1',{waitUntil:'domcontentloaded',timeout:120000});await p.waitForFunction(()=>window.__multiplayer,null,{timeout:120000});return p;
 }
 async function join(p,id){if(id){await p.locator('#online-room').fill(id);await p.locator('#online-join').click();}else await p.locator('#online-create').click();
  await p.waitForFunction(()=>__multiplayer.snapshot().ready&&__multiplayer.snapshot().actors.some(a=>a.role==='player'),null,{timeout:120000});return p.evaluate(()=>__multiplayer.snapshot());}
 async function leave(p){await p.locator('#online-menu').click();await p.locator('#online-leave').click();
  await p.waitForFunction(()=>!__multiplayer.snapshot().resources.city&&!__multiplayer.snapshot().resources.inputTimer&&!__multiplayer.snapshot().resources.pingTimer&&__multiplayer.snapshot().meshes===0);}
 try{
  const a=await page(edge),b=await page(chrome,true),c=await page(edge);await b.locator('#online-quality').click({force:true}).catch(()=>{});
  stage='connect';const sa=await join(a),sb=await join(b,sa.roomId);await b.locator('#online-quality').click();
  const room=[...service.rooms].find(r=>r.roomId===sa.roomId),world=room.sim,pa=world.players.get(sa.playerId),pb=world.players.get(sb.playerId);
  await until(()=>!pa.sim.appearing&&!pb.sim.appearing);assert.equal(sa.signature,sb.signature);
  const invite=await a.locator('#online-invite').inputValue();assert.equal(new URL(invite).searchParams.get('room'),sa.roomId);assert.ok(!invite.includes('token'));
  stage='drive';await a.locator('#scene').click({position:{x:600,y:400}});await a.keyboard.down('w');await delay(900);await a.keyboard.up('w');
  const touch=await b.context().newCDPSession(b);await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:550,id:7}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:450,id:7}]});await delay(900);
  report.joystick=await b.evaluate(()=>({...__clientHarness.network.input}));assert.notEqual(report.joystick.throttle,0);
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
  await until(()=>pa.lastAppliedTick>0&&pb.lastAppliedTick>0);report.cases.push('independent keyboard/joystick and applied server controls');
  stage='collision';function pose(p,x,z,v=0){p.sim.body.position.set(x,.96,z);p.sim.body.quaternion.setFromEuler(0,0,0);p.sim.body.velocity.set(0,0,v);p.sim.body.angularVelocity.setZero();p.sim.body.aabbNeedsUpdate=true;p.sim.body.wakeUp();}
  pose(pa,0,-6,15);pose(pb,0,0);await until(()=>pa.sim.damage>0||pb.sim.damage>0);
  await Promise.all([a,b].map(p=>p.waitForFunction(()=>__multiplayer.snapshot().actors.filter(a=>a.role==='player').some(a=>a.damage>0))));report.cases.push('player collision/damage replicated');
  stage='repair-race';const pickup=world.repairs.placements[0];pa.sim.damage=pb.sim.damage=.5;const revisions=[pa.repairRevision??0,pb.repairRevision??0];
  // Both segments enter one shared pickup in the same authoritative tick.
  pose(pa,pickup.x-.8,pickup.z-2.2,8);pose(pb,pickup.x+.8,pickup.z-2.2,8);
  await until(()=>pickup.status==='consumed');await Promise.all([a,b].map(p=>p.waitForFunction(()=>__multiplayer.repairs().state.pickups[0].status==='consumed')));
  assert.equal([pa,pb].filter(p=>(p.repairRevision??0)>0).length,1);report.repairWinner=world.events.filter(e=>e.type==='repair');report.cases.push('shared repair race: one winner');
  stage='props-latejoin';const prop=world.props.entries.find(p=>p.type==='bin'&&p.state==='intact');pose(pa,prop.x,prop.z-2.5,16);await until(()=>prop.state!=='intact');
  const sc=await join(c,sa.roomId);assert.equal(sc.signature,sa.signature);await c.waitForFunction(()=>__clientHarness.network.prediction.world.props.changedEntries.size>0);
  assert.equal(await c.evaluate(()=>__clientHarness.network.events.length),0);report.cases.push('durable destroyed prop late join without historical effects');
  const fourth=await page(chrome);await fourth.locator('#online-room').fill(sa.roomId);await fourth.locator('#online-join').click();await fourth.waitForFunction(()=>__multiplayer.snapshot().phase==='full');
  assert.match(await fourth.locator('#online-message').textContent(),/заполнена/);report.cases.push('fourth full without auto-hop');
  stage='wanted-arrest';pa.wanted.reset();pb.wanted.reset();pa.wanted.update(.51,[{type:'property-collision'}]);
  await a.waitForFunction(()=>document.querySelector('#wanted').getAttribute('aria-label').startsWith('Розыск: 1'));
  await b.waitForFunction(()=>document.querySelector('#wanted').getAttribute('aria-label').startsWith('Розыск: 0'));
  await until(()=>world.runtime.states.some(u=>u.role==='police'&&u.ai.targetId===pa.id));pose(pa,0,0);
  const unit=world.runtime.states.find(u=>u.role==='police'&&u.ai.targetId===pa.id);pose({sim:unit.simulation},0,-5);
  world.runtime.registerRole('police',{maxCount:6,physicalOnly:true,update:()=>({state:'holding',control:{steer:0,throttle:0,brake:1}})});
  await a.waitForFunction(()=>document.querySelector('#arrest-status').textContent.includes('удерживает'),null,{timeout:20000});await a.screenshot({path:path.join(out,'desktop-holding.png')});
  await a.waitForFunction(()=>document.querySelector('#arrest-status').textContent.startsWith('Арест —'),null,{timeout:20000});await a.screenshot({path:path.join(out,'desktop-arresting.png')});
  await until(()=>pa.arrest.snapshot().state==='arrested');await a.waitForFunction(()=>document.querySelector('#arrest-status').textContent==='Арестован');
  assert.equal(await b.locator('#arrest-banner').isVisible(),false);await a.screenshot({path:path.join(out,'desktop-arrested.png')});await b.screenshot({path:path.join(out,'portrait-low.png')});
  const generations=[pa.generation,pb.generation];await a.locator('#arrest-restart').click();await until(()=>pa.generation===generations[0]+1);assert.equal(pb.generation,generations[1]);assert.equal(world.signature,sa.signature);
  await a.waitForFunction(()=>document.querySelector('#arrest-banner').hidden&&document.querySelector('#wanted').getAttribute('aria-label')==='Розыск: 0 из 6');report.cases.push('personal HUD holding/arresting/arrested and personal respawn');
  stage='menu-camera-hidden';await a.locator('#online-camera').click();const before=world.tick;await a.keyboard.down('w');await delay(500);await a.keyboard.up('w');assert.equal(await a.evaluate(()=>__clientHarness.network.input.throttle),0);assert.ok(world.tick>before);
  await a.locator('#online-camera').click();await a.locator('#online-menu').click();await delay(150);assert.equal(await a.evaluate(()=>__clientHarness.network.input.brake),1);await a.locator('#online-continue').click();
  await a.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await delay(400);assert.equal(await a.evaluate(()=>__clientHarness.network.input.throttle),0);
  await a.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});report.cases.push('menu/free camera/hidden neutral while server advances');
  stage='reconnect';room.clients.find(p=>p.sessionId===pa.id).ref.terminate();await until(()=>!pa.connected);await until(()=>pa.connected);await a.waitForFunction(()=>__multiplayer.snapshot().phase==='playing');assert.equal(await a.evaluate(()=>__multiplayer.snapshot().playerId),pa.id);report.cases.push('reconnect full state');
  stage='cycles';await leave(c);for(let i=0;i<10;i++){await leave(a);await until(()=>world.players.size===1);await join(a,sa.roomId);await until(()=>world.players.size===2);}
  report.cases.push('10 leave/join cycles release city/models/prediction/timers');
  stage='cancel';await leave(a);
  await a.route('**/matchmake/**',async route=>{await delay(800);await route.continue();});await a.locator('#online-create').click();await a.locator('#online-cancel').click();await delay(1800);
  assert.equal(await a.evaluate(()=>__multiplayer.snapshot().roomId),undefined);assert.equal(await a.evaluate(()=>__multiplayer.snapshot().resources.city),false);await a.unroute('**/matchmake/**');report.cases.push('cancel pending admission does not revive a late room');
  await a.evaluate(()=>{const old=__clientHarness.network.onWelcome;__clientHarness.network.onWelcome=async data=>{await new Promise(r=>setTimeout(r,800));if(__clientHarness.network.room?.roomId===data.roomId)await old(data);};});
  await a.locator('#online-room').fill(sa.roomId);await a.locator('#online-join').click();await a.waitForFunction(()=>__multiplayer.snapshot().phase==='map-loading');await a.locator('#online-cancel').click();await delay(1500);
  assert.equal(await a.evaluate(()=>__multiplayer.snapshot().resources.city),false);await join(a,sa.roomId);report.cases.push('cancel map loading, then retry');
  stage='offline';const offline=await edge.newPage();await offline.goto(base+'/?offline=1&debug=1');await offline.waitForFunction(()=>window.carLab?.modelReady,null,{timeout:120000});await offline.screenshot({path:path.join(out,'offline-high.png')});await offline.close();report.cases.push('offline starts independently');
  assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(e){report.failedStage=stage;throw e;}
 finally{fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));await Promise.all([edge.close(),chrome.close()]);await vite.close();await service.close();}
 console.log(JSON.stringify({passed:report.passed,cases:report.cases,errors:report.errors}));
})().catch(e=>{console.error(e);process.exitCode=1;});
