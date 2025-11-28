import './style.css'
import { initGame } from './game.js'

const app = document.querySelector('#app');

function renderHome() {
  app.innerHTML = `
    <div class="container">
      <h1 class="game-title">Game Homepage</h1>
      <div class="game-menu">
        <button id="charades-btn" class="game-btn">比手畫腳</button>
      </div>
    </div>
  `;

  document.getElementById('charades-btn').addEventListener('click', () => {
    renderGame();
  });
}

function renderGame() {
  initGame(app);
}

// Initial render
renderHome();

// Listen for home navigation event
document.addEventListener('navigate-home', renderHome);
