// Replace this empty scene with the first playable mechanic.
export function createScene() {
  let elapsed = 0;
  return {
    update(dt, input) { elapsed += dt; },
    render(context, width, height, alpha) {
      context.fillStyle = '#0f172a';
      context.fillRect(0, 0, width, height);
    },
    reset() { elapsed = 0; },
    snapshot() { return { elapsed }; },
    dispose() {},
  };
}
