function createLease(value) {
  return { lease: Object.freeze({ get value() { return value; } }), invalidate: () => { value = null; } };
}

/** Lazy, bounded storage. A lease becomes unreadable as soon as its life ends. */
export class ObjectPool {
  constructor({ capacity, create, acquire = () => {}, release = () => {}, destroy = () => {} }) {
    if (!Number.isInteger(capacity) || capacity < 0 || typeof create !== 'function') {
      throw new TypeError('A pool needs a nonnegative capacity and factory.');
    }
    this.capacity = capacity;
    this.create = create;
    this.onAcquire = acquire;
    this.onRelease = release;
    this.destroy = destroy;
    this.records = new Set();
    this.free = [];
    this.active = new Map();
    this.disposed = false;
    this.created = this.reused = this.highWater = this.overflow = this.evicted = 0;
  }

  acquire(key = '', context) {
    if (this.disposed) throw new Error('Cannot acquire disposed storage.');
    let index = this.free.findIndex(record => record.key === key);
    let record = index < 0 ? null : this.free.splice(index, 1)[0];
    if (!record && this.records.size >= this.capacity && this.free.length) {
      // Only incompatible idle storage may be replaced; never steal an active lease.
      const retired = this.free.shift();
      this.records.delete(retired); this.destroy(retired.value); this.evicted++;
    }
    if (!record && this.records.size >= this.capacity) { this.overflow++; return null; }
    const reused = !!record;
    if (!record) {
      record = { key, value: this.create(key, context), lease: null, context: null };
      this.records.add(record); this.created++;
    }
    const life = createLease(record.value), lease = life.lease;
    record.invalidateLease = life.invalidate;
    record.lease = lease; record.context = context;
    this.active.set(lease, record);
    try { this.onAcquire(record.value, context); }
    catch (error) { this.release(lease); throw error; }
    if (reused) this.reused++;
    this.highWater = Math.max(this.highWater, this.active.size);
    return lease;
  }

  release(lease) {
    const record = this.active.get(lease);
    if (!record) return false;
    this.active.delete(lease); record.lease = null;
    record.invalidateLease(); record.invalidateLease = null;
    try { this.onRelease(record.value, record.context); }
    finally { record.context = null; this.free.push(record); }
    return true;
  }

  reset() { for (const lease of [...this.active.keys()]) this.release(lease); }

  setCapacity(capacity) {
    if (this.disposed) throw new Error('Cannot resize disposed storage.');
    if (!Number.isInteger(capacity) || capacity < this.active.size) throw new RangeError('Capacity cannot evict live owners.');
    this.capacity = capacity;
    while (this.records.size > capacity) {
      const record = this.free.shift(); this.records.delete(record); this.destroy(record.value); this.evicted++;
    }
  }

  dispose() {
    if (this.disposed) return false;
    this.reset();
    for (const record of this.records) this.destroy(record.value);
    this.records.clear(); this.free.length = 0; this.disposed = true;
    return true;
  }

  snapshot() {
    return { active: this.active.size, free: this.free.length, capacity: this.capacity,
      created: this.created, reused: this.reused, highWater: this.highWater,
      overflow: this.overflow, evicted: this.evicted, disposed: this.disposed };
  }
}
