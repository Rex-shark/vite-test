import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let poseLandmarker;
let video;
let canvas;
let canvasCtx;
let animationFrameId;
let gameState = {
    score: 0,
    timeLeft: 60,
    isPlaying: false,
    blocks: [],
    playerY: 0,
    playerX: 0.5,
    playerFootY: 0,
    previousFootY: 0,
    hasAction: false,
    lastJumpTime: 0,
    isJumping: false
};

const BLOCK_WIDTH = 80;
const BLOCK_HEIGHT = 40;
const JUMP_THRESHOLD = 0.3;
const ACTION_THRESHOLD = 0.05; // 腳部移動閾值
const GAME_DURATION = 60;

export async function initActiveArcade(container) {
    container.innerHTML = `
    <div class="game-container">
      <div class="header">
        <button id="back-btn" class="game-btn small">← 返回首頁</button>
        <div class="game-info">
          <div class="score-display">分數: <span id="score">0</span></div>
          <div class="timer-display">時間: <span id="timer">60</span>秒</div>
        </div>
      </div>
      
      <div class="arcade-content">
        <div class="game-area">
          <canvas id="game-canvas"></canvas>
          <div id="game-status" class="game-status">準備開始...</div>
        </div>
      </div>
      
      <div class="controls">
        <button id="start-btn" class="game-btn">開始遊戲</button>
        <button id="stop-btn" class="game-btn" style="display: none;">停止遊戲</button>
      </div>
    </div>
  `;

    addGameStyles();

    document.getElementById('back-btn').addEventListener('click', () => {
        cleanup();
        document.dispatchEvent(new Event('navigate-home'));
    });

    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('stop-btn').addEventListener('click', stopGame);

    await initMediaPipe();
}

async function initMediaPipe() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1
        });

        console.log("MediaPipe Pose Landmarker 初始化成功");
    } catch (error) {
        console.error("MediaPipe 初始化失敗:", error);
        document.getElementById('game-status').textContent = "初始化失敗，請重新整理頁面";
    }
}

async function startGame() {
    if (!poseLandmarker) {
        alert("系統尚未準備好，請稍候再試");
        return;
    }

    gameState = {
        score: 0,
        timeLeft: GAME_DURATION,
        isPlaying: true,
        blocks: [],
        playerY: 0,
        playerX: 0.5,
        playerFootY: 0,
        previousFootY: 0,
        hasAction: false,
        lastJumpTime: 0,
        isJumping: false
    };

    updateScore();
    updateTimer();

    document.getElementById('start-btn').style.display = 'none';
    document.getElementById('stop-btn').style.display = 'inline-block';
    document.getElementById('game-status').style.display = 'none';

    await startCamera();
    gameLoop();
    startTimer();
    startBlockGeneration();
}

function stopGame() {
    gameState.isPlaying = false;
    cleanup();

    document.getElementById('start-btn').style.display = 'inline-block';
    document.getElementById('stop-btn').style.display = 'none';
    const statusEl = document.getElementById('game-status');
    statusEl.style.display = 'block';
    statusEl.textContent = `遊戲結束！最終分數: ${gameState.score}`;
}

async function startCamera() {
    canvas = document.getElementById('game-canvas');
    canvasCtx = canvas.getContext('2d');

    canvas.width = 640;
    canvas.height = 480;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 }
        });

        video = document.createElement('video');
        video.srcObject = stream;
        video.addEventListener('loadeddata', () => {
            video.play();
        });
    } catch (error) {
        console.error("無法啟動攝影機:", error);
        alert("無法啟動攝影機，請確認權限設定");
        stopGame();
    }
}

function gameLoop() {
    if (!gameState.isPlaying) return;

    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvasCtx.save();
        canvasCtx.scale(-1, 1);
        canvasCtx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
        canvasCtx.restore();

        detectPose();
    }

    drawBlocks();
    checkCollisions();

    animationFrameId = requestAnimationFrame(gameLoop);
}

async function detectPose() {
    if (!poseLandmarker || !video) return;

    try {
        const startTimeMs = performance.now();
        const results = await poseLandmarker.detectForVideo(video, startTimeMs);

        if (results.landmarks && results.landmarks.length > 0) {
            const landmarks = results.landmarks[0];

            drawPoseLandmarks(landmarks);

            const nose = landmarks[0];
            const leftAnkle = landmarks[27];
            const rightAnkle = landmarks[28];

            const currentFootY = (leftAnkle.y + rightAnkle.y) / 2;

            // 偵測腳部動作（向下踩或向上跳）
            if (gameState.previousFootY > 0) {
                const footMovement = Math.abs(currentFootY - gameState.previousFootY);

                // 如果腳部有明顯移動，設定 hasAction 為 true
                if (footMovement > ACTION_THRESHOLD) {
                    gameState.hasAction = true;
                    console.log(`偵測到動作！腳部移動: ${(footMovement * 100).toFixed(1)}%`);
                }
            }

            gameState.playerFootY = currentFootY;
            gameState.playerX = (leftAnkle.x + rightAnkle.x) / 2;
            gameState.playerY = nose.y;
            gameState.previousFootY = currentFootY;

            detectJump(nose.y);
        }
    } catch (error) {
        console.error("姿勢偵測錯誤:", error);
    }
}

function drawPoseLandmarks(landmarks) {
    canvasCtx.fillStyle = 'rgba(0, 255, 0, 0.8)';
    landmarks.forEach(landmark => {
        const x = (1 - landmark.x) * canvas.width;
        const y = landmark.y * canvas.height;
        canvasCtx.beginPath();
        canvasCtx.arc(x, y, 5, 0, 2 * Math.PI);
        canvasCtx.fill();
    });

    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 7],
        [0, 4], [4, 5], [5, 6], [6, 8],
        [9, 10],
        [11, 12],
        [11, 13], [13, 15],
        [12, 14], [14, 16],
        [11, 23], [12, 24],
        [23, 24],
        [23, 25], [25, 27],
        [24, 26], [26, 28]
    ];

    canvasCtx.strokeStyle = 'rgba(0, 255, 0, 0.6)';
    canvasCtx.lineWidth = 2;
    connections.forEach(([start, end]) => {
        if (landmarks[start] && landmarks[end]) {
            const startX = (1 - landmarks[start].x) * canvas.width;
            const startY = landmarks[start].y * canvas.height;
            const endX = (1 - landmarks[end].x) * canvas.width;
            const endY = landmarks[end].y * canvas.height;

            canvasCtx.beginPath();
            canvasCtx.moveTo(startX, startY);
            canvasCtx.lineTo(endX, endY);
            canvasCtx.stroke();
        }
    });
}

let previousY = 0;
let baselineY = 0;
let frameCount = 0;

function detectJump(currentY) {
    frameCount++;

    if (frameCount < 30) {
        baselineY = (baselineY * (frameCount - 1) + currentY) / frameCount;
        previousY = currentY;
        return;
    }

    const deltaY = baselineY - currentY;

    if (deltaY > JUMP_THRESHOLD && !gameState.isJumping) {
        gameState.isJumping = true;
        gameState.hasAction = true; // 跳躍也算動作
        gameState.lastJumpTime = Date.now();
        console.log("偵測到跳躍！");
    }

    if (gameState.isJumping && Date.now() - gameState.lastJumpTime > 500) {
        gameState.isJumping = false;
        baselineY = currentY;
    }

    previousY = currentY;
}

function drawBlocks() {
    gameState.blocks.forEach(block => {
        if (block.active) {
            canvasCtx.fillStyle = block.color;
            canvasCtx.fillRect(block.x, block.y, BLOCK_WIDTH, BLOCK_HEIGHT);

            canvasCtx.strokeStyle = '#fff';
            canvasCtx.lineWidth = 3;
            canvasCtx.strokeRect(block.x, block.y, BLOCK_WIDTH, BLOCK_HEIGHT);
        }
    });
}

function checkCollisions() {
    // 必須有動作才能得分
    if (!gameState.hasAction) return;

    gameState.blocks.forEach(block => {
        if (!block.active) return;

        const playerFootScreenY = gameState.playerFootY * canvas.height;
        const playerScreenX = (1 - gameState.playerX) * canvas.width;

        const blockCenterX = block.x + BLOCK_WIDTH / 2;
        const blockCenterY = block.y + BLOCK_HEIGHT / 2;

        const distanceX = Math.abs(playerScreenX - blockCenterX);
        const distanceY = Math.abs(playerFootScreenY - blockCenterY);

        if (distanceX < 100 && distanceY < 100) {
            console.log(`玩家位置: X=${playerScreenX.toFixed(0)}, FootY=${playerFootScreenY.toFixed(0)}, 有動作: ${gameState.hasAction}`);
            console.log(`方塊位置: X=${blockCenterX.toFixed(0)}, Y=${blockCenterY.toFixed(0)}`);
            console.log(`距離: X=${distanceX.toFixed(0)}, Y=${distanceY.toFixed(0)}`);
        }

        if (distanceX < BLOCK_WIDTH / 2 + 20 && distanceY < BLOCK_HEIGHT / 2 + 30) {
            console.log("✅ 踩到方塊！得分！");
            block.active = false;
            gameState.score += 10;
            updateScore();

            showScorePopup(block.x, block.y);

            // 重置動作狀態，避免連續得分
            gameState.hasAction = false;
        }
    });

    gameState.blocks = gameState.blocks.filter(block => block.active);
}

function showScorePopup(x, y) {
    canvasCtx.fillStyle = '#FFD700';
    canvasCtx.font = 'bold 30px Arial';
    canvasCtx.fillText('+10', x, y);
}

function startBlockGeneration() {
    if (!gameState.isPlaying) return;

    const interval = setInterval(() => {
        if (!gameState.isPlaying) {
            clearInterval(interval);
            return;
        }

        generateBlock();
    }, 2000);
}

function generateBlock() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8'];
    const positions = [
        { x: 160, y: canvas.height - 40 },
        { x: 240, y: canvas.height - 40 },
        { x: 320, y: canvas.height - 40 },
        { x: 400, y: canvas.height - 40 }
    ];

    const randomPos = positions[Math.floor(Math.random() * positions.length)];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    gameState.blocks.push({
        x: randomPos.x,
        y: randomPos.y,
        color: randomColor,
        active: true,
        createdAt: Date.now()
    });

    if (gameState.blocks.length > 6) {
        gameState.blocks.shift();
    }
}

function startTimer() {
    const timerInterval = setInterval(() => {
        if (!gameState.isPlaying) {
            clearInterval(timerInterval);
            return;
        }

        gameState.timeLeft--;
        updateTimer();

        if (gameState.timeLeft <= 0) {
            clearInterval(timerInterval);
            stopGame();
        }
    }, 1000);
}

function updateScore() {
    document.getElementById('score').textContent = gameState.score;
}

function updateTimer() {
    document.getElementById('timer').textContent = gameState.timeLeft;
}

function cleanup() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }

    if (video && video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
    }

    gameState.isPlaying = false;
}

function addGameStyles() {
    const style = document.createElement('style');
    style.textContent = `
    .arcade-content {
      display: flex;
      justify-content: center;
      align-items: center;
      flex-grow: 1;
      margin: 20px 0;
    }

    .game-area {
      position: relative;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 20px;
      padding: 20px;
      border: 2px solid rgba(255, 255, 255, 0.2);
    }

    #game-canvas {
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }

    .game-status {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 2em;
      color: #fff;
      background: rgba(0, 0, 0, 0.7);
      padding: 20px 40px;
      border-radius: 10px;
      pointer-events: none;
      text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
    }

    .game-info {
      display: flex;
      gap: 30px;
      align-items: center;
    }

    .timer-display {
      font-size: 2em;
      color: #FFD700;
      text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
    }

    .controls {
      display: flex;
      justify-content: center;
      gap: 20px;
      margin-top: 20px;
    }
  `;
    document.head.appendChild(style);
}
