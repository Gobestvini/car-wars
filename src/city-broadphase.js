import { Body, SAPBroadphase } from 'cannon-es';

const axisName = index => index === 1 ? 'y' : index === 2 ? 'z' : 'x';
const cellKey = (x, z) => `${x}:${z}`;

/** SAP ordering and Cannon narrow phase, with static pairs skipped and indexed static queries. */
export class CityBroadphase extends SAPBroadphase {
  constructor(world) {
    super(world);
    this.useBoundingBoxes = true;
    this.activeIndices = [];
    this.movingBodies = [];
    this.staticBounds = new Map();
    this.staticCells = new Map();
    this.globalStatics = [];
    this.bodyOrder = new Map();
    this.queryBodies = [];
    this.querySeen = new Set();
    this.cellSize = 12;
    // Cannon's SAP handlers update the list but do not dirty its ordering on add/remove.
    const add = this._addBodyHandler, remove = this._removeBodyHandler;
    world.removeEventListener('addBody', add); world.removeEventListener('removeBody', remove);
    this._addBodyHandler = event => { add(event); this.dirty = true; };
    this._removeBodyHandler = event => { remove(event); this.dirty = true; };
    world.addEventListener('addBody', this._addBodyHandler);
    world.addEventListener('removeBody', this._removeBodyHandler);
  }

  sortList() {
    super.sortList();
    this.bodyOrder.clear(); this.movingBodies.length = 0;
    let staticCount = 0, changed = false;
    for (let i = 0; i < this.axisList.length; i++) {
      const body = this.axisList[i];
      this.bodyOrder.set(body, i);
      if (body.type !== Body.STATIC) { this.movingBodies.push(body); continue; }
      staticCount++;
      const before = this.staticBounds.get(body), { lowerBound: lo, upperBound: hi } = body.aabb;
      if (!before || before[0] !== lo.x || before[1] !== lo.y || before[2] !== lo.z
        || before[3] !== hi.x || before[4] !== hi.y || before[5] !== hi.z) changed = true;
    }
    if (changed || staticCount !== this.staticBounds.size) this.rebuildStaticCells();
  }

  rebuildStaticCells() {
    this.staticBounds.clear(); this.staticCells.clear(); this.globalStatics.length = 0;
    for (const body of this.axisList) {
      if (body.type !== Body.STATIC) continue;
      const { lowerBound: lo, upperBound: hi } = body.aabb;
      this.staticBounds.set(body, [lo.x, lo.y, lo.z, hi.x, hi.y, hi.z]);
      const x0 = Math.floor(lo.x / this.cellSize), x1 = Math.floor(hi.x / this.cellSize);
      const z0 = Math.floor(lo.z / this.cellSize), z1 = Math.floor(hi.z / this.cellSize);
      // Infinite ground planes and very large shapes never expand into unbounded grids.
      if (!Number.isFinite(x0 + x1 + z0 + z1) || (x1 - x0 + 1) * (z1 - z0 + 1) > 64) {
        this.globalStatics.push(body); continue;
      }
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const key = cellKey(x, z);
        let bucket = this.staticCells.get(key);
        if (!bucket) this.staticCells.set(key, bucket = []);
        bucket.push(body);
      }
    }
  }

  collisionPairs(world, pairs1, pairs2) {
    if(this.indexedPairs)return this.indexedCollisionPairs(world,pairs1,pairs2);
    if (this.dirty) { this.sortList(); this.dirty = false; }
    const bodies = this.axisList, active = this.activeIndices, axis = axisName(this.axisIndex);
    active.length = 0;
    for (let i = 0; i < bodies.length; i++) {
      if (!(bodies[i].type & Body.STATIC) && bodies[i].sleepState !== Body.SLEEPING) active.push(i);
    }
    // Preserve the original SAP i/j ordering; only static-static/sleeping pairs disappear.
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i], upper = body.aabb.upperBound[axis];
      const resting = (body.type & Body.STATIC) || body.sleepState === Body.SLEEPING;
      if (resting) {
        for (const j of active) {
          if (j <= i) continue;
          const other = bodies[j];
          if (other.aabb.lowerBound[axis] > upper) break;
          if (this.needBroadphaseCollision(body, other)) this.intersectionTest(body, other, pairs1, pairs2);
        }
      } else {
        for (let j = i + 1; j < bodies.length; j++) {
          const other = bodies[j];
          if (other.aabb.lowerBound[axis] > upper) break;
          if (this.needBroadphaseCollision(body, other)) this.intersectionTest(body, other, pairs1, pairs2);
        }
      }
    }
  }

  indexedCollisionPairs(world,pairs1,pairs2) {
    if(this.dirty){this.sortList();this.dirty=false;}
    const candidates=[],pairs=[];
    for(const body of this.movingBodies){
      if(body.sleepState===Body.SLEEPING)continue;
      if(body.aabbNeedsUpdate)body.updateAABB();
      candidates.length=0;this.aabbQuery(world,body.aabb,candidates);
      const i=this.bodyOrder.get(body);
      for(const other of candidates){
        if(body===other)continue;
        const j=this.bodyOrder.get(other),active=other.type!==Body.STATIC&&other.sleepState!==Body.SLEEPING;
        if(active&&j<i)continue;
        if(!this.needBroadphaseCollision(body,other))continue;
        pairs.push(i<j?{i,j,a:body,b:other}:{i:j,j:i,a:other,b:body});
      }
    }
    // Keep Cannon's exact SAP contact/solver ordering while eliminating the
    // scan over every static house for every moving car during replay.
    pairs.sort((a,b)=>a.i-b.i||a.j-b.j);
    for(const pair of pairs)this.intersectionTest(pair.a,pair.b,pairs1,pairs2);
  }

  aabbQuery(world, aabb, result = []) {
    if (this.dirty) { this.sortList(); this.dirty = false; }
    const x0 = Math.floor(aabb.lowerBound.x / this.cellSize), x1 = Math.floor(aabb.upperBound.x / this.cellSize);
    const z0 = Math.floor(aabb.lowerBound.z / this.cellSize), z1 = Math.floor(aabb.upperBound.z / this.cellSize);
    if (!Number.isFinite(x0 + x1 + z0 + z1) || (x1 - x0 + 1) * (z1 - z0 + 1) > 64) {
      return super.aabbQuery(world, aabb, result);
    }
    const candidates = this.queryBodies, seen = this.querySeen;
    candidates.length = 0; seen.clear();
    const collect = bodies => {
      for (const body of bodies) {
        if (seen.has(body)) continue;
        seen.add(body);
        if (body.aabbNeedsUpdate) body.updateAABB();
        if (body.aabb.overlaps(aabb)) candidates.push(body);
      }
    };
    collect(this.globalStatics); collect(this.movingBodies);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const bucket = this.staticCells.get(cellKey(x, z));
      if (bucket) collect(bucket);
    }
    // Equal-distance ray hits retain Cannon's existing SAP tie order.
    candidates.sort((a, b) => this.bodyOrder.get(a) - this.bodyOrder.get(b));
    for (const body of candidates) result.push(body);
    return result;
  }
}
