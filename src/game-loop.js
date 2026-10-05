// Input → fixed physics → interpolated visuals → camera → render.
// Bound catch-up work after stalls; never enlarge the physics timestep.
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
