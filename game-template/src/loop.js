// Simulation uses seconds. Rendering never changes the simulation timestep.
export function createStepper({ step = 1 / 60, maxSteps = 8 } = {}) {
  if (!Number.isFinite(step) || step <= 0 || !Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError('Invalid fixed-step configuration');
  }
  let accumulator = 0;
  return {
    reset() { accumulator = 0; },
    advance(delta, update) {
      if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Invalid frame delta');
      accumulator += delta;
      let steps = 0;
      while (accumulator + step * 1e-9 >= step && steps < maxSteps) {
        update(step);
        accumulator = Math.max(0, accumulator - step);
        steps++;
      }
      // Discard full overdue steps, preserve the interpolation remainder.
      const dropped = Math.floor((accumulator + step * 1e-9) / step) * step;
      accumulator = Math.max(0, accumulator - dropped);
      return { steps, alpha: Math.min(accumulator / step, 1), dropped };
    },
  };
}
