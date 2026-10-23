import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('the full core loads and steps in Node with Three.js forbidden and no browser globals',()=>{
  const output=execFileSync(process.execPath,['--experimental-loader','./tests/headless-import-loader.mjs','--input-type=module','-e',`
    import {createGameWorld} from './src/simulation/game-world.js';
    if(typeof window!=='undefined'||typeof document!=='undefined')throw Error('Unexpected DOM');
    const w=createGameWorld({seed:42,npcCount:10});await w.ready;
    for(const id of ['a','b','c'])w.addPlayer(id);
    for(let i=0;i<120;i++)w.step();
    if(w.snapshot().players.length!==3||w.snapshot().actors.filter(a=>a.role==='civilian').length!==10)throw Error('Incomplete world');
    JSON.stringify(w.snapshot());w.dispose();if(w.world.bodies.length)throw Error('Residual body');
    console.log('headless-ok');
  `],{encoding:'utf8',timeout:20000,windowsHide:true});
  assert.ok(output.includes('headless-ok'));
});
