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
    circles: [],
    playerY: 0,
    playerX: 0.5,
    landmarks: {} // Store key landmarks
};

const CIRCLE_MIN_RADIUS = 20;
const CIRCLE_MAX_RADIUS = 50;
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
        circles: [],
        playerY: 0,
        playerX: 0.5,
        landmarks: {}
    };

    updateScore();
    updateTimer();

    document.getElementById('start-btn').style.display = 'none';
    document.getElementById('stop-btn').style.display = 'inline-block';
    document.getElementById('game-status').style.display = 'none';

    await startCamera();
    gameLoop();
    startTimer();
    startCircleGeneration();
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

    drawCircles();
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

            // Store key landmarks for collision detection
            // 15: Left Wrist, 16: Right Wrist, 27: Left Ankle, 28: Right Ankle
            gameState.landmarks = {
                leftWrist: landmarks[15],
                rightWrist: landmarks[16],
                leftAnkle: landmarks[27],
                rightAnkle: landmarks[28]
            };
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

function drawCircles() {
    gameState.circles.forEach(circle => {
        if (circle.active) {
            canvasCtx.beginPath();
            canvasCtx.arc(circle.x, circle.y, circle.radius, 0, 2 * Math.PI);
            canvasCtx.fillStyle = circle.color;
            canvasCtx.fill();

            canvasCtx.strokeStyle = '#fff';
            canvasCtx.lineWidth = 3;
            canvasCtx.stroke();
        }
    });
}

function checkCollisions() {
    if (!gameState.landmarks.leftWrist) return; // Wait for landmarks

    const limbs = [
        gameState.landmarks.leftWrist,
        gameState.landmarks.rightWrist,
        gameState.landmarks.leftAnkle,
        gameState.landmarks.rightAnkle
    ];

    gameState.circles.forEach(circle => {
        if (!circle.active) return;

        let touched = false;

        for (const limb of limbs) {
            if (!limb) continue;

            const limbX = (1 - limb.x) * canvas.width;
            const limbY = limb.y * canvas.height;

            const dx = limbX - circle.x;
            const dy = limbY - circle.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Check if limb is inside circle (with some tolerance)
            if (distance < circle.radius + 20) {
                touched = true;
                break;
            }
        }

        if (touched) {
            console.log("✅ 觸碰到圓圈！得分！");
            circle.active = false;
            gameState.score += 10;
            updateScore();

            showScorePopup(circle.x, circle.y);
        }
    });

    gameState.circles = gameState.circles.filter(circle => circle.active);
}

function showScorePopup(x, y) {
    canvasCtx.fillStyle = '#FFD700';
    canvasCtx.font = 'bold 30px Arial';
    canvasCtx.fillText('+10', x, y);
}

function startCircleGeneration() {
    if (!gameState.isPlaying) return;

    const interval = setInterval(() => {
        if (!gameState.isPlaying) {
            clearInterval(interval);
            return;
        }

        generateCircle();
    }, 1500); // Generate every 1.5 seconds
}

function generateCircle() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7D794', '#CF6A87'];

    const radius = Math.floor(Math.random() * (CIRCLE_MAX_RADIUS - CIRCLE_MIN_RADIUS + 1)) + CIRCLE_MIN_RADIUS;

    // Ensure circle is within canvas bounds
    const x = Math.random() * (canvas.width - 2 * radius) + radius;
    const y = Math.random() * (canvas.height - 2 * radius) + radius;

    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    gameState.circles.push({
        x: x,
        y: y,
        radius: radius,
        color: randomColor,
        active: true,
        createdAt: Date.now()
    });

    if (gameState.circles.length > 5) {
        gameState.circles.shift();
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
