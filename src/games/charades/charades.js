import {
    HandLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

// 動態導入圖片
const images = import.meta.glob('./assets/img/*.{png,jpg,jpeg}', { eager: true });
const targetImages = Object.values(images).map(module => module.default);

let currentImageIndex = 0;

let handLandmarker = undefined;
let runningMode = "IMAGE";
let webcamRunning = false;
let isProcessingTarget = false;
let video = null;
let canvasElement = null;
let canvasCtx = null;
let targetHands = []; // changed from single targetLandmarks to array of hands

// Load the target image and extract landmarks
async function loadTargetImage() {
    const img = document.getElementById("target-image");
    if (!img) return;

    // Update image source based on current index
    img.src = targetImages[currentImageIndex];

    if (!handLandmarker) {
        console.log("Wait for handLandmarker to load before clicking!");
        return;
    }

    // Prevent webcam predictions while processing target image
    isProcessingTarget = true;

    // If currently in VIDEO mode, switch to IMAGE mode for target detection
    if (runningMode === "VIDEO") {
        runningMode = "IMAGE";
        await handLandmarker.setOptions({ runningMode: "IMAGE" });
        console.log("Switched to IMAGE mode for target detection");
    }

    try {
        // ensure image is loaded
        if (!img.complete) {
            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = (err) => reject(err);
            });
        }

        console.log("Target image natural size:", img.naturalWidth, img.naturalHeight);

        // Draw to an offscreen canvas to give the detector raw pixel data
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = img.naturalWidth || img.width || 640;
        tmpCanvas.height = img.naturalHeight || img.height || 480;
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.drawImage(img, 0, 0, tmpCanvas.width, tmpCanvas.height);

        // detect if canvas is tainted (cross-origin) by attempting to read dataURL
        let canvasTainted = false;
        try {
            tmpCanvas.toDataURL();
        } catch (taintErr) {
            console.error('Canvas appears to be tainted (cross-origin).', taintErr);
            canvasTainted = true;
        }

        if (canvasTainted) {
            // Give a helpful error message to the user
            console.error('Target image could not be read due to cross-origin restrictions. Ensure the image is served from the same origin or remove the crossorigin attribute.');
            const scoreEl = document.getElementById("similarity-score");
            if (scoreEl) {
                scoreEl.innerText = "Error: Image cross-origin blocked";
                scoreEl.style.color = "#ff0000";
            }
            targetHands = [];
            return;
        }

        // Use createImageBitmap for a reliable input to the detector when available
        let inputForDetect = tmpCanvas;
        if (typeof createImageBitmap === 'function') {
            try {
                inputForDetect = await createImageBitmap(tmpCanvas);
            } catch (bmErr) {
                console.warn('createImageBitmap failed, falling back to canvas:', bmErr);
            }
        }

        // pass the image/bitmap/canvas to the detector
        const result = await handLandmarker.detect(inputForDetect);
        console.log('HandLandmarker.detect result (initial):', result);

        // If no landmarks found, try several fallbacks for robustness
        let finalResult = result;
        if (!result || !result.landmarks || result.landmarks.length === 0) {
            console.warn('Initial detect returned no landmarks; attempting fallbacks...');

            try {
                // 1) Try passing the original <img> element
                const r2 = await handLandmarker.detect(img);
                console.log('Fallback detect(img) result:', r2);
                if (r2 && r2.landmarks && r2.landmarks.length > 0) finalResult = r2;
            } catch (e2) {
                console.warn('Fallback detect(img) failed:', e2);
            }

            if ((!finalResult || !finalResult.landmarks || finalResult.landmarks.length === 0) && typeof createImageBitmap === 'function') {
                try {
                    // 2) Try creating an ImageBitmap directly from the image
                    const bm = await createImageBitmap(img);
                    const r3 = await handLandmarker.detect(bm);
                    console.log('Fallback detect(createImageBitmap(img)) result:', r3);
                    if (r3 && r3.landmarks && r3.landmarks.length > 0) finalResult = r3;
                } catch (e3) {
                    console.warn('Fallback detect(createImageBitmap(img)) failed:', e3);
                }
            }

            if ((!finalResult || !finalResult.landmarks || finalResult.landmarks.length === 0)) {
                try {
                    // 3) Try upscaling the canvas (sometimes small images fail)
                    const upW = Math.max(tmpCanvas.width * 2, 800);
                    const upH = Math.max(tmpCanvas.height * 2, 800);
                    const upCanvas = document.createElement('canvas');
                    upCanvas.width = upW;
                    upCanvas.height = upH;
                    const upCtx = upCanvas.getContext('2d');
                    upCtx.drawImage(tmpCanvas, 0, 0, upW, upH);
                    const r4 = await handLandmarker.detect(upCanvas);
                    console.log('Fallback detect(upscaled canvas) result:', r4);
                    if (r4 && r4.landmarks && r4.landmarks.length > 0) finalResult = r4;
                } catch (e4) {
                    console.warn('Fallback detect(upscaled canvas) failed:', e4);
                }
            }
        }

        // Use finalResult for decision
        const useResult = finalResult || { landmarks: [], worldLandmarks: [], handednesses: [] };
        console.log('Using detection result:', useResult);

        if (useResult && useResult.landmarks && useResult.landmarks.length > 0) {
            // Extract all detected hands, not just the first
            targetHands = extractHandsFromDetectResult(useResult);
            console.log("Target hands loaded:", targetHands);
            const scoreEl = document.getElementById("similarity-score");
            if (scoreEl) {
                scoreEl.innerText = "Ready (" + targetHands.length + " hand(s))";
                scoreEl.style.color = "#000000";
            }
        } else {
            console.error("No hand detected in target image after fallbacks.");
            targetHands = []; // clear any previous target
            const scoreEl = document.getElementById("similarity-score");
            if (scoreEl) {
                scoreEl.innerText = "Error: No hand in target";
                scoreEl.style.color = "#ff0000";
            }
        }
    } catch (e) {
        console.error("Error detecting target:", e);
        targetHands = [];
        const scoreEl = document.getElementById("similarity-score");
        if (scoreEl) {
            scoreEl.innerText = "Error: " + (e && e.message ? e.message : String(e));
            scoreEl.style.color = "#ff0000";
        }
    } finally {
        // Allow webcam predictions to resume
        isProcessingTarget = false;
    }
}

export async function initCharadesGame(container) {
    // Reset state to ensure clean initialization
    runningMode = "IMAGE";
    webcamRunning = false;
    isProcessingTarget = false;

    container.innerHTML = `
    <div class="game-container">
      <div class="header">
        <button id="back-btn" class="game-btn small">Back</button>
        <h2 class="score-display">Similarity: <span id="similarity-score">0%</span></h2>
      </div>
      
      <div class="content-area">
        <div class="target-area">
          <h3>Target</h3>
          <img id="target-image" src="${targetImages[currentImageIndex]}" alt="Target Hand Gesture" />
          <div class="carousel-controls" style="margin-top: 10px; display: flex; justify-content: center; gap: 20px;">
            <button id="prev-target-btn" class="game-btn small" style="font-size: 1.5rem; padding: 5px 20px;">&lt;</button>
            <button id="next-target-btn" class="game-btn small" style="font-size: 1.5rem; padding: 5px 20px;">&gt;</button>
          </div>
        </div>
        
        <div class="webcam-area">
          <h3>You</h3>
          <div style="position: relative;">
            <video id="webcam" autoplay playsinline></video>
            <canvas id="output_canvas"></canvas>
          </div>
          <button id="webcamButton" class="game-btn">ENABLE WEBCAM</button>
        </div>
      </div>
    </div>
  `;

    video = document.getElementById("webcam");
    canvasElement = document.getElementById("output_canvas");
    canvasCtx = canvasElement.getContext("2d");
    const webcamButton = document.getElementById("webcamButton");
    const backBtn = document.getElementById("back-btn");

    backBtn.addEventListener("click", () => {
        stopWebcam();
        document.dispatchEvent(new CustomEvent("navigate-home"));
    });

    document.getElementById("prev-target-btn").addEventListener("click", () => {
        currentImageIndex = (currentImageIndex - 1 + targetImages.length) % targetImages.length;
        loadTargetImage();
    });

    document.getElementById("next-target-btn").addEventListener("click", () => {
        currentImageIndex = (currentImageIndex + 1) % targetImages.length;
        loadTargetImage();
    });

    if (hasGetUserMedia()) {
        webcamButton.addEventListener("click", enableCam);
    } else {
        console.warn("getUserMedia() is not supported by your browser");
    }

    await createHandLandmarker();

    // Try to load target landmarks once image is loaded
    const img = document.getElementById("target-image");
    if (img.complete) {
        loadTargetImage();
    } else {
        img.onload = loadTargetImage;
    }
}

function hasGetUserMedia() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

async function createHandLandmarker() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );

    const baseOptions = {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
    };

    // Try GPU delegate first, fallback to CPU (no delegate) if it fails
    try {
        console.log('Creating HandLandmarker with GPU delegate...');
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { ...baseOptions, delegate: "GPU" },
            runningMode: runningMode,
            numHands: 2,
            minHandDetectionConfidence: 0.1, // Lower threshold for target image
            minHandPresenceConfidence: 0.1,
            minTrackingConfidence: 0.1
        });
        console.log("HandLandmarker loaded (GPU)");
    } catch (gpuErr) {
        console.warn('GPU delegate failed, retrying without delegate...', gpuErr);
        try {
            handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions,
                runningMode: runningMode,
                numHands: 2,
                minHandDetectionConfidence: 0.1,
                minHandPresenceConfidence: 0.1,
                minTrackingConfidence: 0.1
            });
            console.log("HandLandmarker loaded (CPU)");
        } catch (cpuErr) {
            console.error('Failed to create HandLandmarker with both GPU and CPU options:', cpuErr);
            throw cpuErr;
        }
    }
}

function enableCam(event) {
    if (!handLandmarker) {
        console.log("Wait! handLandmarker not loaded yet.");
        return;
    }

    if (webcamRunning === true) {
        webcamRunning = false;
        event.target.innerText = "ENABLE WEBCAM";
        stopWebcam();
    } else {
        webcamRunning = true;
        event.target.innerText = "DISABLE WEBCAM";

        const constraints = {
            video: true
        };

        navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
            video.srcObject = stream;
            video.addEventListener("loadeddata", predictWebcam);
        });
    }
}

function stopWebcam() {
    if (video && video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        video.srcObject = null;
    }
    webcamRunning = false;
}

async function predictWebcam() {
    // Skip if processing target image to avoid mode conflicts
    if (isProcessingTarget) {
        if (webcamRunning === true) {
            window.requestAnimationFrame(predictWebcam);
        }
        return;
    }

    // Ensure video dimensions are valid
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        if (webcamRunning === true) {
            window.requestAnimationFrame(predictWebcam);
        }
        return;
    }

    canvasElement.style.width = video.videoWidth;
    canvasElement.style.height = video.videoHeight;
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;

    if (runningMode === "IMAGE") {
        runningMode = "VIDEO";
        await handLandmarker.setOptions({ runningMode: "VIDEO" });
    }

    let startTimeMs = performance.now();
    if (video.currentTime !== video.lastVideoTime) {
        video.lastVideoTime = video.currentTime;
        const results = handLandmarker.detectForVideo(video, startTimeMs);

        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        if (results && results.landmarks) {
            // build current hands array
            const currentHands = extractHandsFromDetectResult(results);

            // draw all hands
            for (let i = 0; i < results.landmarks.length; i++) {
                const landmarks = results.landmarks[i];
                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
                    color: "#00FF00",
                    lineWidth: 5
                });
                drawLandmarks(canvasCtx, landmarks, { color: "#FF0000", lineWidth: 2 });
            }

            // If we have a target, match & score
            if (targetHands && targetHands.length > 0) {
                const combined = matchAndScoreHands(targetHands, currentHands);
                // combined is { perTargetScores: [...], totalScore }
                updateScore(combined.totalScore);
                // optional: log details for debugging
                // console.log('Per-target scores:', combined.perTargetScores);
            } else {
                // no target loaded
                const scoreEl = document.getElementById("similarity-score");
                if (scoreEl) scoreEl.innerText = "No target";
            }
        } else {
            // no hands in current frame
            const scoreEl = document.getElementById("similarity-score");
            if (scoreEl) scoreEl.innerText = "Waiting for hands...";
        }
        canvasCtx.restore();
    }

    if (webcamRunning === true) {
        window.requestAnimationFrame(predictWebcam);
    }
}

// New helper: extract hands (landmarks + optional handedness label) from detection result
function extractHandsFromDetectResult(result) {
    const hands = [];
    if (!result) return hands;
    const lm = result.landmarks || [];
    const hd = result.handednesses || [];
    for (let i = 0; i < lm.length; i++) {
        const label = (hd[i] && (hd[i].label || hd[i].score || hd[i].categoryName)) ? (hd[i].label || hd[i].categoryName) : null;
        hands.push({ landmarks: lm[i], handedness: label });
    }
    return hands;
}

// Match target hands to current hands and compute per-target scores
function matchAndScoreHands(targetHandsArr, currentHandsArr) {
    const perTargetScores = new Array(targetHandsArr.length).fill(0);
    const usedCurrent = new Set();

    // For each target hand, find best matching current hand (greedy)
    for (let ti = 0; ti < targetHandsArr.length; ti++) {
        let bestScore = 0;
        let bestCi = -1;
        for (let ci = 0; ci < currentHandsArr.length; ci++) {
            if (usedCurrent.has(ci)) continue;
            const score = calculateSimilarity(targetHandsArr[ti].landmarks, currentHandsArr[ci].landmarks);
            if (score > bestScore) {
                bestScore = score;
                bestCi = ci;
            }
        }
        if (bestCi >= 0) usedCurrent.add(bestCi);
        perTargetScores[ti] = bestScore;
    }

    // If target has fewer hands than current, we ignore extras; if more, those remain 0
    // Combine scores: average across target hands (so single-target uses that score directly)
    const totalScore = perTargetScores.length > 0 ? Math.round(perTargetScores.reduce((a, b) => a + b, 0) / perTargetScores.length) : 0;

    return { perTargetScores, totalScore };
}

// Improved similarity calculation: normalize, compare direct & mirrored, return 0-100
function calculateSimilarity(target, current) {
    if (!Array.isArray(target) || !Array.isArray(current) || target.length === 0 || current.length === 0) {
        return 0;
    }

    // Normalize both sets
    const normTarget = normalizeLandmarks(target);
    const normCurrent = normalizeLandmarks(current);
    const normCurrentMirrored = normCurrent.map(p => ({ x: -p.x, y: p.y, z: p.z })); // mirror horizontally

    const scoreDirect = compareNormalizedSets(normTarget, normCurrent);
    const scoreMirrored = compareNormalizedSets(normTarget, normCurrentMirrored);

    const score = Math.max(scoreDirect, scoreMirrored);
    return Math.round(score);
}

function compareNormalizedSets(a, b) {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;
    let totalDist = 0;
    for (let i = 0; i < len; i++) {
        const dx = a[i].x - b[i].x;
        const dy = a[i].y - b[i].y;
        totalDist += Math.sqrt(dx * dx + dy * dy);
    }
    const avgDist = totalDist / len;
    // Convert distance to similarity score (0-100)
    const maxDist = 0.5;
    const score = Math.max(0, (1 - (avgDist / maxDist)) * 100);
    return score;
}

function normalizeLandmarks(landmarks) {
    const wrist = landmarks[0] || { x: 0, y: 0 };
    // Translate to wrist
    const centered = landmarks.map(l => ({
        x: (l.x - wrist.x) || 0,
        y: (l.y - wrist.y) || 0,
        z: 0 // Ignore Z for now
    }));

    // Scale: find max distance from wrist
    let maxDist = 0;
    for (const l of centered) {
        const d = Math.sqrt(l.x * l.x + l.y * l.y);
        if (d > maxDist) maxDist = d;
    }

    if (maxDist === 0) return centered;

    return centered.map(l => ({ x: l.x / maxDist, y: l.y / maxDist, z: 0 }));
}

function updateScore(score) {
    const scoreEl = document.getElementById("similarity-score");
    if (scoreEl) {
        if (typeof score === 'number' && !isNaN(score)) {
            scoreEl.innerText = score + "%";
            // Visual feedback color
            if (score > 80) scoreEl.style.color = "#00ff00";
            else if (score > 50) scoreEl.style.color = "#ffff00";
            else scoreEl.style.color = "#ff0000";
        } else {
            // For error or status strings (e.g. "Ready" / "Error: ...")
            scoreEl.innerText = String(score);
            scoreEl.style.color = "#ff0000";
        }
    }
}

// Drawing utilities (simplified version of @mediapipe/drawing_utils)
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17]
];

function drawConnectors(ctx, landmarks, connections, style) {
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.lineWidth;
    for (const [start, end] of connections) {
        const p1 = landmarks[start];
        const p2 = landmarks[end];
        ctx.beginPath();
        ctx.moveTo(p1.x * ctx.canvas.width, p1.y * ctx.canvas.height);
        ctx.lineTo(p2.x * ctx.canvas.width, p2.y * ctx.canvas.height);
        ctx.stroke();
    }
    ctx.restore();
}

function drawLandmarks(ctx, landmarks, style) {
    ctx.save();
    ctx.fillStyle = style.color;
    for (const landmark of landmarks) {
        ctx.beginPath();
        ctx.arc(landmark.x * ctx.canvas.width, landmark.y * ctx.canvas.height, style.lineWidth, 0, 2 * Math.PI);
        ctx.fill();
    }
    ctx.restore();
}

