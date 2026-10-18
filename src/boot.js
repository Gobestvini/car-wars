import { createLoadingScreen } from './loading-screen.js';

// This small entry owns the only loading UI, including the game module download.
let retryGame;
const loadingScreen = createLoadingScreen({ onRetry: () => retryGame ? retryGame() : location.reload() });
async function boot() {
  try {
    await loadingScreen.paint();
    loadingScreen.update(2, 'Loading game…');
    const params = new URLSearchParams(location.search);
    const online = params.get('online') === '1' || params.has('room');
    const { startGame } = online ? await import('./multiplayer/game.js') : await import('./main.js');
    const game = await startGame(loadingScreen);
    retryGame = game.retry;
    if (!online) {
      const button = document.createElement('button');
      button.id = 'menu-online'; button.className = 'multiplayer-entry';
      button.textContent = 'Играть с друзьями'; button.type = 'button';
      button.onclick = () => { const url = new URL(location.href); url.search = '?online=1'; url.hash = ''; location.href = url.href; };
      document.querySelector('.menu-status-row').before(button);
      await import('./multiplayer/style.css');
    }
  } catch (error) {
    console.error('Game initialization failed', error);
    // Preserve a more specific error already reported by WebGL initialization.
    if (document.getElementById('loading-screen').dataset.error !== 'true') {
      loadingScreen.fail('Could not prepare the game. Please retry.');
    }
  }
}
void boot();
