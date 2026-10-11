// Diagnostic storage is allocated only by an explicit start(). No per-frame objects.
export const PROFILE_STAGES = ['aiMs', 'playerPrepareMs', 'trafficPrepareMs', 'npcPrepareMs',
  'worldStepMs', 'postMs', 'stepGameplayMs', 'signalMs', 'trafficVisualMs', 'occlusionMs',
  'damageVisualMs', 'smokeVisualMs', 'pickupVisualMs'];
export const PROFILE_COLUMNS = ['frame', 'timestamp', 'intervalMs', 'cpuMs', 'physicsMs',
  'visualMs', 'renderCpuMs', 'calls', 'triangles', 'steps', 'droppedSeconds', ...PROFILE_STAGES];

export class SceneProfile {
  constructor(capacity = 32768) {
    this.capacity = capacity;
    this.accepted = 0;
    this.rendered = 0;
    this.data = null;
    this.count = 0;
    this.total = 0;
    this.lastTimestamp = null;
    this.stages = null;
  }
  accept() { this.accepted++; }
  start() {
    this.data = new Float64Array(this.capacity * PROFILE_COLUMNS.length);
    this.count = this.total = 0;
    this.lastTimestamp = null;
    this.stages = Object.fromEntries(PROFILE_STAGES.map(key => [key, 0]));
  }
  resetStages() { if (this.stages) for (const key of PROFILE_STAGES) this.stages[key] = 0; }
  stop() { this.data = this.stages = null; this.count = this.total = 0; this.lastTimestamp = null; }
  record(timestamp, cpuMs, physicsMs, visualMs, renderCpuMs, calls, triangles, steps, droppedSeconds) {
    this.rendered++;
    if (!this.data) return;
    const offset = (this.total % this.capacity) * PROFILE_COLUMNS.length;
    const d = this.data;
    d[offset] = this.rendered;
    d[offset + 1] = timestamp;
    d[offset + 2] = this.lastTimestamp === null ? NaN : timestamp - this.lastTimestamp;
    d[offset + 3] = cpuMs;
    d[offset + 4] = physicsMs;
    d[offset + 5] = visualMs;
    d[offset + 6] = renderCpuMs;
    d[offset + 7] = calls;
    d[offset + 8] = triangles;
    d[offset + 9] = steps;
    d[offset + 10] = droppedSeconds;
    for (let i = 0; i < PROFILE_STAGES.length; i++) d[offset + 11 + i] = this.stages[PROFILE_STAGES[i]];
    this.lastTimestamp = timestamp;
    this.total++;
    this.count = Math.min(this.total, this.capacity);
  }
  snapshot() {
    const rows = [], width = PROFILE_COLUMNS.length;
    for (let i = this.total - this.count; i < this.total; i++) {
      rows.push(Array.from(this.data.subarray((i % this.capacity) * width, (i % this.capacity + 1) * width)));
    }
    return { columns: PROFILE_COLUMNS, rows, accepted: this.accepted, rendered: this.rendered,
      capacity: this.capacity, overwritten: this.total - this.count };
  }
}

// Query only the GPU command interval; CPU submission time remains a separate metric.
export class GpuProfile {
  constructor(gl, capacity = 32768) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.capacity = capacity;
    this.pending = [];
    this.samples = [];
    this.discarded = 0;
    this.skipped = 0;
  }
  begin(frame) {
    if (!this.ext) return;
    if (this.poll() === false) { this.skipped++; return; }
    if (this.pending.length >= 8) { this.skipped++; return; }
    const query = this.gl.createQuery();
    if (!query) { this.skipped++; return; }
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.current = { frame, query };
  }
  end() {
    if (!this.current) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.current);
    this.current = null;
  }
  poll() {
    if (!this.ext) return;
    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      this.discarded += this.pending.length;
      for (const { query } of this.pending) this.gl.deleteQuery(query);
      this.pending.length = 0;
      return false;
    }
    while (this.pending.length && this.gl.getQueryParameter(this.pending[0].query, this.gl.QUERY_RESULT_AVAILABLE)) {
      const { frame, query } = this.pending.shift();
      const ns = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT);
      if (Number.isFinite(ns) && ns >= 0 && this.samples.length < this.capacity) this.samples.push([frame, ns / 1e6]);
      else this.discarded++;
      this.gl.deleteQuery(query);
    }
  }
  snapshot() {
    this.poll();
    return { status: this.ext ? 'available' : 'unavailable', columns: ['frame', 'gpuMs'],
      rows: this.samples.slice(), pending: this.pending.length, discarded: this.discarded, skipped: this.skipped };
  }
  dispose() {
    this.end();
    for (const { query } of this.pending) this.gl.deleteQuery(query);
    this.pending.length = 0;
  }
}
