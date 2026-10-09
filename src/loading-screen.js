export function createLoadingScreen({ bypass = false, onRetry }) {
  const root = document.getElementById('loading-screen');
  const menu = document.getElementById('start-screen');
  const bar = root.querySelector('[role="progressbar"]');
  const fill = root.querySelector('.loading-fill');
  const phase = document.getElementById('loading-phase');
  const percent = document.getElementById('loading-percent');
  const retry = document.getElementById('loading-retry');
  let progress = 0, open = !bypass, leaving = false, failed = false;
  let dismissTimer;

  function update(value, label) {
    if (!open || leaving || failed) return;
    progress = Math.max(progress, Math.min(100, Math.round(value)));
    bar.setAttribute('aria-valuenow', String(progress));
    fill.style.width = `${progress}%`;
    percent.textContent = `${progress}%`;
    if (label) phase.textContent = label;
  }
  function begin() {
    if (bypass) return;
    clearTimeout(dismissTimer);
    open = true; leaving = false; failed = false; progress = 0;
    root.hidden = false; root.inert = false;
    root.classList.remove('is-leaving');
    root.dataset.error = 'false'; root.setAttribute('aria-busy','true');
    document.body.dataset.loading = 'true'; menu.inert = true;
    retry.hidden = true;
    update(0,'Starting engines…');
  }
  retry.addEventListener('click', () => { begin(); onRetry(); });
  if (bypass) { root.hidden = true; document.body.dataset.loading = 'false'; }
  else begin();

  return {
    get isOpen() { return open; },
    begin,
    update,
    // Yield a paint before constructing the city and allocating WebGL resources.
    paint: () => bypass ? Promise.resolve() : new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve,0))),
    finish() {
      if (!open || leaving || failed) return;
      update(100,'Ready to race!');
      root.setAttribute('aria-busy','false');
      leaving = true;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      dismissTimer = setTimeout(() => {
        root.classList.add('is-leaving');
        dismissTimer = setTimeout(() => {
          open = false; root.hidden = true; root.inert = true;
          document.body.dataset.loading = 'false';
          menu.inert = menu.hidden;
        }, reduced ? 0 : 450);
      }, reduced ? 0 : 320);
    },
    fail(message, { retryable = true } = {}) {
      if (!open) return;
      clearTimeout(dismissTimer); leaving = false; failed = true;
      root.classList.remove('is-leaving'); root.dataset.error = 'true';
      root.setAttribute('aria-busy','false');
      phase.textContent = message;
      retry.hidden = !retryable;
    },
  };
}
