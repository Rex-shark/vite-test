import './style.css'
import { initCharadesGame } from './games/charades/charades.js'
import { initActiveArcade } from './games/active-arcade/active-arcade.js'

const app = document.querySelector('#app');

function renderHome() {
  app.innerHTML = `
    <div class="container">
      <h1 class="game-title">遊戲中心</h1>
      <div class="game-menu">
        <button id="charades-btn" class="game-btn">🤚 比手畫腳</button>
        <button id="active-arcade-btn" class="game-btn">🏃 Active Arcade</button>
      </div>
    </div>
  `;

  document.getElementById('charades-btn').addEventListener('click', () => {
    renderCharadesGame();
  });

  document.getElementById('active-arcade-btn').addEventListener('click', () => {
    renderActiveArcade();
  });
}

function renderCharadesGame() {
  initCharadesGame(app);
}

function renderActiveArcade() {
  initActiveArcade(app);
}

// Initial render
renderHome();

// Listen for home navigation event
document.addEventListener('navigate-home', renderHome);
