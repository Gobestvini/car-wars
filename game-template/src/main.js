import './style.css';
import { createStepper } from './loop.js';
import { createInput } from './input.js';
import { createScene } from './scene.js';

const canvas = document.querySelector('canvas');
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D is unavailable');
const pauseButton = document.querySelector('#pause');
const status = document.querySelector('#status');
const input = createInput();
const scene = createScene();
const stepper = createStepper();
let paused = false;
let previous = null;
let frame;
let disposed = false;

function clearTiming() { previous = null; stepper.reset(); input.reset(); }
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  scene.render(context, canvas.width, canvas.height, 0);
}
function setPaused(value) {
  paused = value;
  clearTiming();
  pauseButton.textContent = paused ? 'Продолжить' : 'Пауза';
  status.textContent = paused ? 'Пауза' : 'Готово';
}
function reset() { scene.reset(); clearTiming(); scene.render(context, canvas.width, canvas.height, 0); }
function visibility() { clearTiming(); }
function tick(now) {
  if (disposed) return;
  const delta = previous === null ? 0 : (now - previous) / 1000;
  previous = now;
  let alpha = 0;
  if (!paused && !document.hidden) alpha = stepper.advance(delta, dt => scene.update(dt, input)).alpha;
  scene.render(context, canvas.width, canvas.height, alpha);
  frame = requestAnimationFrame(tick);
}
const toggle = () => setPaused(!paused);
pauseButton.addEventListener('click', toggle);
document.querySelector('#reset').addEventListener('click', reset);
document.addEventListener('visibilitychange', visibility);
window.addEventListener('resize', resize);
resize();
frame = requestAnimationFrame(tick);
function dispose() {
  disposed = true;
  cancelAnimationFrame(frame);
  input.dispose(); scene.dispose();
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', visibility);
  pauseButton.removeEventListener('click', toggle);
  document.querySelector('#reset').removeEventListener('click', reset);
  if (import.meta.env.DEV) delete window.gameDebug;
}
if (import.meta.env.DEV) {
  window.gameDebug = { snapshot: () => ({ ...scene.snapshot(), paused, keys: [...input.keys] }), reset };
}
if (import.meta.hot) import.meta.hot.dispose(dispose);
