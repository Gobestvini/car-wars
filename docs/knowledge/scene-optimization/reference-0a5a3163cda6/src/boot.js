import { createLoadingScreen } from './loading-screen.js';

// This small entry owns the only loading UI, including the game module download.
let retryGame;
const loadingScreen = createLoadingScreen({ onRetry: () => retryGame ? retryGame() : location.reload() });
async function boot() {
  try {
    await loadingScreen.paint();
    loadingScreen.update(2, 'Loading game…');
    const { startGame } = await import('./main.js');
    const game = await startGame(loadingScreen);
    retryGame = game.retry;
  } catch (error) {
    console.error('Game initialization failed', error);
    // Preserve a more specific error already reported by WebGL initialization.
    if (document.getElementById('loading-screen').dataset.error !== 'true') {
      loadingScreen.fail('Could not prepare the game. Please retry.');
    }
  }
}
void boot();
