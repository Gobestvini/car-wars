import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoadingScreen } from '../src/loading-screen.js';

function fixture(t, { bypass = false, reduced = false } = {}) {
  const element = () => ({ hidden: false, inert: false, dataset: {}, style: {}, attrs: {}, textContent: '',
    classes: new Set(), events: {},
    setAttribute(name,value) { this.attrs[name] = value; },
    addEventListener(name,callback) { this.events[name] = callback; },
    querySelector(selector) { return nodes[selector]; },
  });
  const nodes = Object.fromEntries(['loading-screen','start-screen','[role="progressbar"]','.loading-fill',
    'loading-phase','loading-percent','loading-retry'].map(id => [id,element()]));
  for (const node of Object.values(nodes)) node.classList = {
    add: name => node.classes.add(name), remove: name => node.classes.delete(name),
  };
  const body = { dataset: {} }, timers = new Map();
  let timerId = 0, retries = 0;
  const globals = {
    document: { body, getElementById: id => nodes[id] },
    matchMedia: () => ({ matches: reduced }),
    setTimeout: callback => { timers.set(++timerId,callback); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  for (const [key,value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
    t.after(() => descriptor ? Object.defineProperty(globalThis,key,descriptor) : delete globalThis[key]);
  }
  const screen = createLoadingScreen({ bypass, onRetry: () => retries++ });
  const tick = () => { const queued = [...timers.values()]; timers.clear(); queued.forEach(callback => callback()); };
  return { screen,nodes,body,tick,get retries() { return retries; } };
}

test('loader keeps progress monotonic and only releases the menu after completion', t => {
  const {screen,nodes,body,tick} = fixture(t);
  assert.equal(nodes['start-screen'].inert,true);
  screen.update(68,'Preparing the city…');
  screen.update(35);
  assert.equal(nodes['[role="progressbar"]'].attrs['aria-valuenow'],'68');
  screen.update(200);
  assert.equal(nodes['loading-percent'].textContent,'100%');
  screen.finish();
  assert.equal(screen.isOpen,true);
  tick();
  assert.equal(screen.isOpen,true);
  tick();
  assert.equal(screen.isOpen,false);
  assert.equal(nodes['loading-screen'].hidden,true);
  assert.equal(nodes['start-screen'].inert,false);
  assert.equal(body.dataset.loading,'false');
});

test('failure cancels dismissal and ignores late resource events until Retry', t => {
  const f = fixture(t);
  f.screen.update(86,'Compiling…');
  f.screen.finish();
  f.screen.fail('Could not load the race.');
  f.screen.update(94,'Late resource callback');
  f.screen.finish();
  f.tick(); f.tick();
  assert.equal(f.screen.isOpen,true);
  assert.equal(f.nodes['loading-phase'].textContent,'Could not load the race.');
  assert.equal(f.nodes['loading-retry'].hidden,false);
  f.nodes['loading-retry'].events.click();
  assert.equal(f.retries,1);
  assert.equal(f.nodes['loading-percent'].textContent,'0%');
  assert.equal(f.nodes['loading-retry'].hidden,true);
  f.screen.update(60,'Loading cars…');
  assert.equal(f.nodes['loading-percent'].textContent,'60%');
});

test('fatal WebGL failure offers no retry', t => {
  const f = fixture(t);
  f.screen.fail('WebGL unavailable',{retryable:false});
  assert.equal(f.nodes['loading-retry'].hidden,true);
  assert.equal(f.screen.isOpen,true);
});

test('bypassed loader never blocks the simulation or reveals itself on begin', t => {
  const {screen,nodes,body} = fixture(t,{bypass:true});
  screen.begin(); screen.update(68); screen.finish();
  assert.equal(screen.isOpen,false);
  assert.equal(nodes['loading-screen'].hidden,true);
  assert.equal(body.dataset.loading,'false');
});
