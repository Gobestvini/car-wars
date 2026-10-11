import './start-screen.css';

// Menu ownership is independent of the simulation: a closed menu starts a new run,
// and an open menu never forwards input or time to the world.
export function createStartScreen({ bypass = false, onPlay, onShow, onSettings }) {
  const root = document.getElementById('start-screen');
  const play = document.getElementById('menu-play');
  const status = document.getElementById('menu-status');
  const home = document.getElementById('menu-button');
  const roleButtons = [...root.querySelectorAll('.menu-role')];
  let side = 'racer', ready = false, launching = false;
  let open = !bypass;
  let launchTimer;

  function render() {
    root.dataset.side = side;
    root.hidden = !open;
    root.inert = !open || document.body.dataset.loading === 'true';
    home.hidden = open;
    document.body.dataset.screen = open ? 'menu' : 'playing';
    for (const button of roleButtons) button.setAttribute('aria-pressed', String(button.dataset.chooseSide === side));
    play.disabled = launching || !ready || side === 'city';
    status.textContent = side === 'city' ? 'City mode is coming soon.' : '';
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
    // Reveal the prepared race underneath the fading menu, with input still paused.
    document.body.dataset.screen = 'launching';
    onPlay(side);
    // Equal to the CSS exit; reduced-motion users enter immediately.
    launchTimer = setTimeout(() => {
      open = false;
      launching = false;
      root.classList.remove('is-launching');
      render();
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
  render();

  return {
    get isOpen() { return open; },
    get isLaunching() { return launching; },
    snapshot: () => ({ open, side, ready, launching }),
    setReady(value) { ready = value; render(); },
  };
}
