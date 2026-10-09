import './start-screen.css';

// Menu ownership is independent of the simulation: a closed menu starts a new run,
// and an open menu never forwards input or time to the world.
export function createStartScreen({ bypass = false, onPlay, onShow, onSettings, onRetry }) {
  const root = document.getElementById('start-screen');
  const play = document.getElementById('menu-play');
  const status = document.getElementById('menu-status');
  const retry = document.getElementById('menu-retry');
  const home = document.getElementById('menu-button');
  const settings = document.getElementById('menu-settings');
  const roleButtons = [...root.querySelectorAll('.menu-role')];
  let side = 'racer', ready = false, error = '', launching = false;
  let open = !bypass;
  let retryable = true;
  let launchTimer;

  function render() {
    root.dataset.side = side;
    root.hidden = !open;
    root.inert = !open || document.body.dataset.loading === 'true';
    home.hidden = open;
    document.body.dataset.screen = open ? 'menu' : 'playing';
    for (const button of roleButtons) button.setAttribute('aria-pressed', String(button.dataset.chooseSide === side));
    play.disabled = launching || !ready || side === 'city';
    status.textContent = error || (side === 'city' ? 'City mode is coming soon.' : ready ? '' : 'Preparing race…');
    retry.hidden = !error || !retryable;
    settings.disabled = !!error && !retryable;
  }

  function choose(value) {
    if (launching || !open || !['racer', 'city'].includes(value) || side === value) return;
    side = value;
    render();
  }
  for (const button of root.querySelectorAll('[data-choose-side]')) {
    button.addEventListener('click', () => choose(button.dataset.chooseSide));
  }
  root.querySelector('.menu-role-choices').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const value = ['ArrowLeft', 'Home'].includes(event.key) ? 'racer' : 'city';
    choose(value);
    roleButtons.find(button => button.dataset.chooseSide === value).focus();
  });
  play.addEventListener('click', () => {
    if (play.disabled || launching || !open) return;
    launching = true;
    root.classList.add('is-launching');
    root.inert = true;
    play.disabled = true;
    // Equal to the CSS exit; reduced-motion users enter immediately.
    launchTimer = setTimeout(() => {
      open = false;
      launching = false;
      root.classList.remove('is-launching');
      render();
      onPlay(side);
      document.getElementById('scene').focus({ preventScroll: true });
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520);
  });
  home.addEventListener('click', () => {
    clearTimeout(launchTimer);
    launching = false;
    open = true;
    root.classList.remove('is-launching');
    onShow();
    render();
    roleButtons.find(button => button.dataset.chooseSide === side).focus({ preventScroll: true });
  });
  document.getElementById('menu-settings').addEventListener('click', onSettings);
  retry.addEventListener('click', () => { error = ''; render(); onRetry(); });
  render();

  return {
    get isOpen() { return open; },
    snapshot: () => ({ open, side, ready, launching }),
    setReady(value) { ready = value; error = ''; render(); },
    setError(message, { retryable: canRetry = true } = {}) { ready = false; error = message; retryable = canRetry; render(); },
  };
}
