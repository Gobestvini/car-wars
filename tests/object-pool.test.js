import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectPool } from '../src/object-pool.js';

test('bounded reuse resets data, rejects stale releases, and destroys storage once', () => {
  let destroyed = 0;
  const pool = new ObjectPool({ capacity: 2, create: () => ({ damage: 0 }),
    acquire: item => { item.damage = 0; }, destroy: () => { destroyed++; } });
  const old = pool.acquire('car'); const body = old.value; body.damage = 1;
  const second = pool.acquire('car');
  assert.equal(pool.acquire('car'), null);
  assert.equal(pool.release(old), true); assert.equal(old.value, null);
  const fresh = pool.acquire('car');
  assert.equal(fresh.value, body); assert.equal(fresh.value.damage, 0);
  assert.equal(pool.release(old), false); assert.equal(fresh.value, body);
  assert.deepEqual(pool.snapshot(), { active: 2, free: 0, capacity: 2, created: 2,
    reused: 1, highWater: 2, overflow: 1, evicted: 0, disposed: false });
  pool.reset(); assert.equal(second.value, null); assert.equal(fresh.value, null);
  assert.equal(pool.dispose(), true); assert.equal(pool.dispose(), false); assert.equal(destroyed, 2);
  assert.throws(() => pool.acquire('car'), /disposed/);
});

test('variant exhaustion replaces idle storage without evicting a live owner', () => {
  const destroyed = [];
  const pool = new ObjectPool({ capacity: 2, create: key => ({ key }), destroy: value => destroyed.push(value.key) });
  const green = pool.acquire('green'), grey = pool.acquire('grey');
  pool.release(grey);
  const police = pool.acquire('police');
  assert.equal(green.value.key, 'green'); assert.equal(police.value.key, 'police');
  assert.deepEqual(destroyed, ['grey']); assert.equal(pool.snapshot().evicted, 1);
  assert.equal(pool.acquire('grey'), null);
  pool.dispose(); assert.deepEqual(destroyed, ['grey', 'green', 'police']);
});

test('capacity changes retire only free storage and preserve current leases', () => {
  let destroyed=0;
  const pool=new ObjectPool({capacity:3,create:()=>({}),destroy:()=>destroyed++});
  const active=pool.acquire(),free1=pool.acquire(),free2=pool.acquire();
  pool.release(free1);pool.release(free2);
  assert.throws(()=>pool.setCapacity(0),/live owners/);
  pool.setCapacity(1);assert.equal(destroyed,2);assert.ok(active.value);
  assert.equal(pool.acquire(),null);
  pool.dispose();assert.equal(active.value,null);assert.equal(destroyed,3);
  assert.throws(()=>pool.setCapacity(1),/disposed/);
});

test('preparation is idle, bounded, idempotent and retryable after a factory error', () => {
  let fail = true, acquired = 0, released = 0, destroyed = 0;
  const pool = new ObjectPool({ capacity: 2, create: key => {
    if (fail) throw Error('factory');
    return {key};
  }, acquire: () => acquired++, release: () => released++, destroy: () => destroyed++ });
  assert.throws(() => pool.prepareOne('green', {}, 1), /factory/);
  assert.equal(pool.snapshot().created,0);assert.equal(pool.snapshot().free,0);
  fail = false;
  assert.equal(pool.prepareOne('green', {}, 1),true);
  assert.equal(pool.prepareOne('green', {}, 1),false);
  assert.equal(pool.prepareOne('grey', {}, 1),true);
  assert.equal(pool.prepareOne('police', {}, 1),false);
  assert.equal(acquired,0);assert.equal(released,0);assert.equal(pool.snapshot().active,0);
  const value=pool.preparedValue('green'), lease=pool.acquire('green');
  assert.equal(value,lease.value);assert.equal(pool.snapshot().created,2);
  pool.dispose();assert.equal(destroyed,2);assert.equal(released,1);
  assert.throws(()=>pool.prepareOne('green',{},1),/disposed/);
});
