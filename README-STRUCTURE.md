# 遊戲專案結構說明

## 目錄結構

```
vite-test/
├── src/
│   ├── main.js                    # 主程式入口，處理遊戲導航
│   ├── style.css                  # 全域樣式
│   ├── counter.js                 # (舊檔案，可刪除)
│   ├── game.js                    # (舊檔案，已移至 games/charades/)
│   ├── assets/                    # 共用資源
│   │   └── img/                   # (舊圖片，已複製至遊戲目錄)
│   └── games/                     # 遊戲目錄
│       └── charades/              # 比手畫腳遊戲
│           ├── charades.js        # 遊戲主程式
│           └── assets/
│               └── img/           # 遊戲專用圖片
│                   ├── img1.png
│                   ├── img2.png
│                   ├── img3.png
│                   ├── img4.jpg
│                   ├── img5.jpg
│                   ├── img6.jpg
│                   └── img7.jpg
├── public/
│   └── vite.svg
├── index.html
└── package.json
```

## 主要改進

### 1. 圖片載入優化
使用 Vite 的 `import.meta.glob` 動態載入圖片：
```javascript
const images = import.meta.glob('./assets/img/*.{png,jpg,jpeg}', { eager: true });
const targetImages = Object.values(images).map(module => module.default);
```

**優點：**
- 不需要手動 import 每張圖片
- 新增圖片時自動包含
- 支援多種圖片格式（png, jpg, jpeg）

### 2. 模組化架構
- 每個遊戲獨立目錄
- 遊戲資源獨立管理
- 便於新增更多遊戲

### 3. 主程式簡化
- `main.js` 只負責導航
- 各遊戲獨立初始化
- 使用 CustomEvent 處理頁面切換

## 如何新增遊戲

1. 在 `src/games/` 下創建新遊戲目錄，例如：
   ```
   src/games/my-new-game/
   ├── my-new-game.js
   └── assets/
   ```

2. 在新遊戲的 js 檔案中 export 初始化函數：
   ```javascript
   export async function initMyNewGame(container) {
     // 遊戲初始化邏輯
   }
   ```

3. 在 `main.js` 中導入並添加按鈕：
   ```javascript
   import { initMyNewGame } from './games/my-new-game/my-new-game.js'
   
   // 在 renderHome() 中添加按鈕
   <button id="new-game-btn" class="game-btn">新遊戲</button>
   
   // 添加事件監聽
   document.getElementById('new-game-btn').addEventListener('click', () => {
     initMyNewGame(app);
   });
   ```

## 關於 MediaPipe URL

程式碼中使用的 CDN URL 是正常的：
```javascript
// WASM 檔案來源
"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"

// 模型檔案來源
"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
```

這些是 Google MediaPipe 官方提供的資源，需要網路連線才能使用。

## 可刪除的舊檔案

整理完成後，以下檔案可以刪除：
- `src/game.js` (已移至 `src/games/charades/charades.js`)
- `src/counter.js` (如果不使用)
- `src/assets/img/*` (已複製到遊戲目錄)

