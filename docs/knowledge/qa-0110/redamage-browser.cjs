// Local operator fixture: only initial poses/damage/velocity are assigned.
// Pickup collection and repair run through the real server physics loop.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),spike=createRequire(path.resolve('tools/multiplayer-spike/package.json'));
const {matchMaker}=spike('@colyseus/core');
const out=process.env.ARTIFACT_DIR||'docs/knowledge/multiplayer/2026-10-23-repair';
const report={date:'2026-10-23',device:'Windows Edge headless WebGL; portrait touch emulation',errors:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const hook='window.__repairHarness={network,visuals:()=>repairVisuals,models,camera,focusId:null};\n';
async function until(check){const end=Date.now()+20000;while(!check()){if(Date.now()>end)throw Error('Repair browser server timeout');await delay(20);}}
async function read(page,id){return page.evaluate(id=>{
  const h=__repairHarness,v=h.models.get(id),p=__multiplayer.snapshot().actors.find(a=>a.id===id);
  const positions=v?.body.geometry.attributes.position.array,original=v?.deformation.originalPositions;
  let deformed=0;if(positions)for(let i=0;i<positions.length;i+=3)if(Math.hypot(positions[i]-original[i],positions[i+1]-original[i+1],positions[i+2]-original[i+2])>1e-5)deformed++;
  const visuals=h.visuals(),pickup=visuals?.pickups[0];
  const matrix=visuals?.meshes[0].matrix.clone();if(matrix)visuals.meshes[0].getMatrixAt(0,matrix);
  return{roomId:__multiplayer.snapshot().roomId,playerId:h.network.room?.sessionId,ready:__multiplayer.snapshot().ready,
    repairs:__multiplayer.repairs(),pickupScale:matrix?.determinant(),damaged:p?.damage,
    deformed,repairRevision:v?.repairRevision??0,detached:p?.wheels.filter((_,i)=>i%7===6),pickup};
},id);}
(async()=>{
  fs.mkdirSync(out,{recursive:true});process.env.CARWARS_FIXED_SEED='42';
  const {startHostedServer}=await import('../../../tools/multiplayer-spike/deploy/server.js');
  const {createServer}=await import('vite');
  const service=await startHostedServer({port:0,host:'127.0.0.1'}),port=service.server.transport.server.address().port;
  const vite=await createServer({server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_GAME_SERVER_URL':JSON.stringify(`http://127.0.0.1:${port}`)}});
  await vite.listen();const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl']});
  const pages=[];
  async function page(viewport,isMobile=false){
    const context=await browser.newContext({viewport,isMobile,hasTouch:isMobile,deviceScaleFactor:1}),p=await context.newPage();pages.push(p);
    p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
    await p.route('**/src/multiplayer/game.js*',async route=>{
      const response=await route.fetch(),body=await response.text();assert.ok(body.includes('window.__multiplayer={snapshot:'));
      await route.fulfill({response,body:body.replace('window.__multiplayer={snapshot:',hook+'window.__multiplayer={snapshot:')
        .replace('const focus=own?models.get(own.id).group:null;',
          'const focus=models.get(window.__repairHarness.focusId??own?.id)?.group??null;')});
    });
    await p.goto(base+'/?online=1&netdebug=1',{waitUntil:'domcontentloaded',timeout:120000});
    await p.waitForFunction(()=>window.__multiplayer,null,{timeout:120000});return p;
  }
  async function join(p,id){
    if(id){await p.locator('#online-room').fill(id);await p.locator('#online-join').click();}else await p.locator('#online-create').click();
    await p.waitForFunction(()=>__multiplayer.snapshot().ready&&__multiplayer.snapshot().actors.length>0&&__multiplayer.repairs().state,null,{timeout:120000});
    return p.evaluate(()=>__multiplayer.snapshot().roomId);
  }
  try{
    const first=await page({width:1440,height:900}),roomId=await join(first),joinedAt=Date.now();
    const second=await page({width:390,height:844},true);await join(second,roomId);await second.locator('#online-quality').click();
    const third=await page({width:844,height:390});
    const room=matchMaker.getLocalRoomById(roomId),world=room.sim,actor=world.players.get(await first.evaluate(()=>__multiplayer.snapshot().playerId));
    const pickup=world.repairs.placements[0];
    await second.evaluate(id=>{__repairHarness.focusId=id;},actor.id); // Screenshot the repaired subject, not the distant observer.
    actor.sim.spawn={x:pickup.x,y:.96,z:pickup.z-5,yaw:0};actor.sim.reset();actor.generation++;world.halt(actor.id);
    actor.sim.damage=.8;actor.dents=[{point:{x:.7,y:.2,z:1},normal:{x:-1,y:0,z:0},impact:{depth:.25,radius:1.2}}];actor.dentGeneration=actor.generation;
    actor.sim.detachWheelAtImpact({speed:25,point:actor.sim.wheels[0].mount,normal:{x:1,y:0,z:0}});
    await Promise.all([first,second].map(p=>p.waitForFunction(id=>{
      const a=__multiplayer.snapshot().actors.find(a=>a.id===id);return a?.damage>.7&&__repairHarness.models.get(id)?.dentCount>0;
    },actor.id)));
    report.before=await Promise.all([first,second].map(p=>read(p,actor.id)));
    report.before.forEach(s=>{assert.ok(s.deformed>0);assert.ok(s.detached.some(Boolean));assert.ok(s.pickupScale>.9);});
    await first.screenshot({path:path.join(out,'desktop-damaged.png')});await second.screenshot({path:path.join(out,'portrait-before.png')});
    // A fresh initial crossing pose avoids drift during slow screenshot capture.
    // From here on every pose and the repair result come from server steps.
    let injected=false;const patch=room.onBeforePatch.bind(room);
    room.onBeforePatch=function(){
      if(actor.repairRevision===1&&!injected){injected=true;actor.sim.damage=.3;actor.dents=[{point:{x:-.7,y:.2,z:-1},normal:{x:1,y:0,z:0},impact:{depth:.15,radius:1.2}}];}
      return patch();
    };
    actor.sim.body.position.set(pickup.x,.96,pickup.z-2.2);
    actor.sim.body.quaternion.setFromEuler(0,0,0);actor.sim.body.angularVelocity.setZero();
    actor.sim.body.velocity.set(0,0,8);actor.sim.body.aabbNeedsUpdate=true;actor.sim.body.wakeUp();
    await until(()=>pickup.status==='consumed');
    await Promise.all([first,second].map(p=>p.waitForFunction(id=>{
      const s=__multiplayer.repairs(),v=__repairHarness.models.get(id),a=__multiplayer.snapshot().actors.find(a=>a.id===id);
      return s.state.pickups[0].status==='consumed'&&v?.repairRevision===1&&v.dentCount===1&&a?.damage>.29&&a?.damage<.31&&a.wheels.every((v,i)=>i%7!==6||!v);
    },actor.id)));
    report.after=await Promise.all([first,second].map(p=>read(p,actor.id)));
    report.after.forEach(s=>{assert.ok(s.deformed>0);assert.equal(s.pickupScale,0);assert.equal(s.repairRevision,1);});
    report.redamage=await Promise.all([first,second].map(p=>p.evaluate(id=>{
      const v=__repairHarness.models.get(id);return {impacts:v.deformation.impacts,damage:__multiplayer.snapshot().actors.find(a=>a.id===id).damage};
    },actor.id)));
    report.redamage.forEach(s=>{assert.equal(s.impacts.length,1);assert.ok(s.impacts[0].point.x<0);assert.ok(s.damage>.29&&s.damage<.31);});
    await first.screenshot({path:path.join(out,'desktop-repaired.png')});await second.screenshot({path:path.join(out,'portrait-repaired.png')});
    await join(third,roomId);await third.waitForFunction(()=>__multiplayer.repairs().state.pickups[0].status==='consumed');
    report.lateJoin=await read(third,actor.id);assert.equal(report.lateJoin.pickupScale,0);
    await until(()=>world.players.size===3);
    await delay(Math.max(0,5500-(Date.now()-joinedAt)));
    const sessionId=actor.id;room.clients.find(c=>c.sessionId===sessionId).ref.terminate();
    await until(()=>!actor.connected);await until(()=>actor.connected);
    await first.waitForFunction(()=>__multiplayer.snapshot().ready&&__multiplayer.repairs().state?.pickups[0].status==='consumed');
    report.reconnect=await read(first,actor.id);assert.equal(report.reconnect.playerId,sessionId);
    // Explicit leave frees pickup resources; a new room gets a fresh placement state.
    for(const p of [first,second,third]){
      await p.locator('#online-share').click();await p.locator('#online-leave').click();
      await p.waitForFunction(()=>!__repairHarness.visuals());
    }
    const next=await join(first);assert.notEqual(next,roomId);
    report.newRoom=await read(first,await first.evaluate(()=>__multiplayer.snapshot().playerId));
    assert.ok(report.newRoom.repairs.state.pickups.every(p=>p.status==='available'));assert.ok(report.newRoom.pickupScale>.9);
    assert.deepEqual(report.errors,[]);report.passed=true;
  }finally{
    fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));
    await browser.close();await vite.close();await service.close();
  }
  console.log(JSON.stringify({passed:report.passed,threeClients:true,lateJoin:true,reconnect:true,newRoom:true,errors:report.errors}));
})().catch(e=>{console.error(e);process.exitCode=1;});
