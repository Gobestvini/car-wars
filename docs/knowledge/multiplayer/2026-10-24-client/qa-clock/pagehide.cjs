const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
const {startHostedServer}=await import(require('node:url').pathToFileURL(require('node:path').resolve('tools/multiplayer-spike/deploy/server.js')).href),{createServer}=await import('vite');
const service=await startHostedServer({port:0,host:'127.0.0.1'}),endpoint='http://127.0.0.1:'+service.server.transport.server.address().port;
const vite=await createServer({server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_GAME_SERVER_URL':JSON.stringify(endpoint)}});await vite.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});const p=await browser.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
try{
await p.route('**/src/multiplayer/game.js*',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:body.replace('window.__multiplayer={snapshot:','window.__clientHarness={network,renderer,models};window.__multiplayer={snapshot:')});});
await p.goto('http://127.0.0.1:'+vite.httpServer.address().port+'/?online=1');await p.waitForFunction(()=>window.__multiplayer,null,{timeout:120000});await p.locator('#online-create').click();await p.waitForFunction(()=>__multiplayer.snapshot().ready,null,{timeout:120000});
const first=await p.evaluate(()=>{const r=__clientHarness.network.room;r.reconnection.minUptime=0;r.reconnection.minDelay=r.reconnection.maxDelay=1200;return{roomId:r.roomId,playerId:r.sessionId};});
const host=[...service.rooms].find(r=>r.roomId===first.roomId);host.clients.find(p=>p.sessionId===first.playerId).ref.terminate();await p.waitForFunction(()=>__multiplayer.snapshot().phase==='reconnecting');
const connectingState=await p.evaluate(()=>{const r=__clientHarness.network.room;window.__retiredRoom=r;r.send('input',{stale:true});r.connection.reconnect({reconnectionToken:r.reconnectionToken.split(':')[1],skipHandshake:true});const state=r.connection.transport.ws.readyState;document.querySelector('#online-cancel').click();return state;});assert.equal(connectingState,0);
await p.waitForTimeout(1800);const connectingCancel=await p.evaluate(()=>({state:__retiredRoom.connection.transport.ws.readyState,open:__retiredRoom.connection.isOpen,reconnecting:__retiredRoom.reconnection.isReconnecting,buffered:__retiredRoom.reconnection.enqueuedMessages.length,phase:__multiplayer.snapshot().phase}));assert.deepEqual(connectingCancel,{state:3,open:false,reconnecting:false,buffered:0,phase:'idle'});
await p.locator('#online-create').click();await p.waitForFunction(()=>__multiplayer.snapshot().ready,null,{timeout:120000});assert.notEqual(await p.evaluate(()=>__multiplayer.snapshot().roomId),first.roomId);
const cdp=await p.context().newCDPSession(p);
async function listeners(){let result={};for(const expr of ['window','document','document.getElementById("scene")']){const {result:o}=await cdp.send('Runtime.evaluate',{expression:expr});const {listeners}=await cdp.send('DOMDebugger.getEventListeners',{objectId:o.objectId});result[expr]=listeners.map(l=>l.type);}return result;}
const before=await listeners();const memoryBefore=await p.evaluate(()=>({...__clientHarness.renderer.info.memory}));
await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await p.waitForTimeout(200);const after=await listeners();
const result={connectingState,connectingCancel,before,after,memoryBefore,memoryAfter:await p.evaluate(()=>({...__clientHarness.renderer.info.memory})),snapshot:await p.evaluate(()=>__multiplayer.snapshot()),errors};
fs.writeFileSync('docs/knowledge/multiplayer/2026-10-24-client/qa-clock/pagehide.json',JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close();await vite.close();await service.close();}
})().catch(e=>{console.error(e);process.exitCode=1});



