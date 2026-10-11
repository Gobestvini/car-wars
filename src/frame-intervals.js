/** Bounded accepted-frame interval window; never includes time across a pause. */
export class FrameIntervals {
  constructor(capacity = 600) {
    this.values = new Float64Array(capacity);
    this.reset();
  }
  reset() { this.count = 0; this.cursor = 0; this.previous = null; }
  push(timestamp) {
    if (!Number.isFinite(timestamp)) return;
    if (this.previous !== null && timestamp > this.previous) {
      this.values[this.cursor] = timestamp - this.previous;
      this.cursor = (this.cursor + 1) % this.values.length;
      this.count = Math.min(this.count + 1, this.values.length);
    }
    this.previous = timestamp;
  }
  snapshot() {
    const sorted = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
    const p = fraction => sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
    const durationMs = sorted.reduce((a, b) => a + b, 0);
    return { sampleCount: sorted.length, durationMs, mean: sorted.length ? durationMs / sorted.length : null,
      p50: p(.5), p95: p(.95), p99: p(.99), max: sorted.at(-1) ?? null,
      over25: sorted.filter(v => v > 25).length, over33_34: sorted.filter(v => v > 33.34).length,
      over50: sorted.filter(v => v > 50).length };
  }
}
