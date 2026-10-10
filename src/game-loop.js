// Input → fixed physics → interpolated visuals → camera → render.
// Bound catch-up work after stalls; never enlarge the physics timestep.
export const MAX_RENDER_FPS = 60;

/** Keep rAF on a fixed time grid without rendering more than once per callback. */
export class FrameRateLimiter {
  constructor(maxFps = MAX_RENDER_FPS) {
    this.intervalMs = 1000 / Math.max(1, Number.isFinite(maxFps) ? maxFps : MAX_RENDER_FPS);
    this.nextFrameTime = null;
  }

  reset() { this.nextFrameTime = null; }

  shouldRender(timestamp) {
    if (!Number.isFinite(timestamp)) return false;
    if (this.nextFrameTime === null) {
      this.nextFrameTime = timestamp + this.intervalMs;
      return true;
    }
    if (timestamp + 1e-6 < this.nextFrameTime) return false;

    // Skip missed slots after a stall but keep the cadence grid during normal jitter.
    const lateness = Math.max(0, timestamp - this.nextFrameTime);
    const missedIntervals = Math.floor(lateness / this.intervalMs) + 1;
    this.nextFrameTime += missedIntervals * this.intervalMs;
    return true;
  }
}

export class FixedStepper {
  constructor(step = 1 / 120, maxSteps = 10) {
    this.step = step;
    this.maxSteps = maxSteps;
    this.accumulator = 0;
    this.droppedSeconds = 0;
  }
  reset() { this.accumulator = 0; }
  advance(seconds, tick) {
    const budget = this.step * this.maxSteps;
    const incoming = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const available = this.accumulator + incoming;
    this.droppedSeconds += Math.max(0, available - budget);
    this.accumulator = Math.min(available, budget);
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.step && steps < this.maxSteps) {
      tick(this.step);
      this.accumulator = Math.max(0, this.accumulator - this.step);
      steps++;
    }
    return { alpha: Math.min(this.accumulator / this.step, 1), steps };
  }
}
