// Legacy traffic fixtures start with the former eight-car initial population.
// Each insertion is now an explicit synthetic display frame, without advancing physics.
export function attachForTrafficTest(runtime, player) {
  runtime.attachPhysics(player);
  for (let frame = 0; frame < 8; frame++) runtime.advanceSpawnFrame(.025);
}

export function framePrepare(runtime, dt) {
  runtime.advanceSpawnFrame(dt);
  return runtime.prepare(dt);
}

export function frameStep(runtime, input, dt) {
  runtime.advanceSpawnFrame(dt);
  return runtime.stepWorld(input, dt);
}
