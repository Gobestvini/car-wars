export function createInput(target = window) {
  const keys = new Set();
  const down = event => keys.add(event.code);
  const up = event => keys.delete(event.code);
  const reset = () => keys.clear();
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', reset);
  return {
    keys, reset,
    dispose() {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', reset);
      reset();
    },
  };
}
