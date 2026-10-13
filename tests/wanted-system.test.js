import test from 'node:test';
import assert from 'node:assert/strict';
import { createWantedSystem } from '../src/wanted-system.js';

test('first offense blinks as a warning, then a repeat confirms one star', () => {
  const wanted = createWantedSystem();
  assert.equal(wanted.update(1 / 60, [{ type: 'speeding' }]).stars[0], 'pending');
  assert.equal(wanted.update(0.25, [{ type: 'red-light' }]).level, 0);
  assert.equal(wanted.update(0.25, [{ type: 'red-light' }]).level, 1);
  assert.equal(wanted.snapshot().stars.filter(star => star === 'empty').length, 5);
});

test('warning expires and the next offense starts a fresh warning', () => {
  const wanted = createWantedSystem({ warningSeconds: 2 });
  wanted.update(0.1, [{ type: 'speeding' }]);
  wanted.update(2);
  assert.equal(wanted.snapshot().pendingStar, null);
  assert.equal(wanted.update(0.5, [{ type: 'red-light' }]).pendingStar, 1);
});

test('only one event is accepted per cooldown and collision severity wins ties', () => {
  const wanted = createWantedSystem();
  assert.equal(wanted.update(1, [{ type: 'speeding' }, { type: 'police-collision' }]).lastViolation, 'police-collision');
  assert.equal(wanted.update(0.25, [{ type: 'civilian-collision' }]).lastViolation, 'police-collision');
});

test('wanted system caps at six stars and reset clears its state', () => {
  const wanted = createWantedSystem({ warningSeconds: 0.3, eventCooldownSeconds: 0 });
  for (let i = 0; i < 12; i++) wanted.update(0.11, [{ type: 'red-light' }]);
  assert.equal(wanted.snapshot().level, 6);
  assert.deepEqual(wanted.reset().stars, Array(6).fill('empty'));
});

test('warning at its exact deadline expires before a new offense, and snapshots are isolated', () => {
  const wanted = createWantedSystem({ warningSeconds: 1, eventCooldownSeconds: 0 });
  const first = wanted.update(0.1, [{ type: 'speeding' }]);
  first.stars[0] = 'filled';
  wanted.update(1);
  const deadline = wanted.update(0, [{ type: 'red-light' }]);
  assert.equal(deadline.level, 0);
  assert.equal(deadline.pendingStar, 1);
  assert.equal(deadline.stars[0], 'pending');
});

test('property crime immediately fills one star, clears warnings and keeps cooldown and cap', () => {
  const wanted = createWantedSystem();
  wanted.update(.1,[{type:'speeding'}]);
  const state = wanted.update(.5,[{type:'property-collision'}]);
  assert.equal(state.level,1); assert.equal(state.pendingStar,null);
  assert.equal(wanted.update(.1,[{type:'property-collision'}]).level,1);
  for (let i=0;i<12;i++) wanted.update(.5,[{type:'property-collision'}]);
  assert.equal(wanted.snapshot().level,6);
});

test('property collision priority is independent of input order and below police', () => {
  for (const reverse of [false,true]) {
    const wanted = createWantedSystem();
    const events = [{type:'speeding'},{type:'civilian-collision'},{type:'property-collision'}];
    if (reverse) events.reverse();
    assert.equal(wanted.update(1,events).level,1);
    assert.equal(wanted.snapshot().lastViolation,'property-collision');
    assert.equal(wanted.update(.5,[...events,{type:'police-collision'}]).lastViolation,'police-collision');
    assert.equal(wanted.snapshot().pendingStar,2);
  }
});
