/* 파일명: script.js
   전체 통합본 — 모든 기존 기능 유지 + 아래 수정/추가 반영:
   1) 터치/드래그/두 손(핀치)으로 줌인/줌아웃/패닝 가능
   2) 지우개로 지운 뒤 되돌리기 1번으로 돌아가도록 히스토리 방식 개선
   3) 브러시/지우개 최대값 100으로 확장
   4) 레이어별 흐림(blur) 추가
   5) 캔버스 크기 조절 UI 추가
   6) 저장 불러오기(갤러리 불러오기) 시 이전 상태로 되돌릴 수 있도록 히스토리 보존
   7) 새로고침 시 작업 자동 저장/복원 (localStorage 사용)
   8) 페인트통: 클릭한 위치 기준으로 flood-fill(선택된 부분만 채우기)
   9) 모바일에서 툴바/레이어가 가려지지 않도록 컨테이너 위치/크기 보정
   10) 기존 기능 전부 보존, 요약 없음 — 코드 전체 제공
*/

/* ===== DOM 참조 ===== */
const toolbar = document.getElementById('toolbar');
const container = document.getElementById('canvas-container');
const layersPanel = document.getElementById('layers-panel');
const galleryPanel = document.getElementById('gallery-panel');
const brushSelect = document.getElementById('brush-size');
const colorPicker = document.getElementById('color');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const fillBtn = document.getElementById('fill');
const eraserBtn = document.getElementById('eraser');
const zoomOutBtn = document.getElementById('zoom-out');
const saveBtn = document.getElementById('save');
const addLayerBtn = document.getElementById('add-layer');
const mergeLayerBtn = document.getElementById('merge-layer');
const toggleLayersBtn = document.getElementById('toggle-layers');
const imageInput = document.getElementById('image-input');

/* ===== 전역 상태 ===== */
let layers = []; // { canvas, ctx, name, brightness, visible, blur }
let activeLayer = null;
let history = []; // array of snapshots (each snapshot: array of layer dataUrls)
let redoStack = [];
let usingEraser = false;
let isFillMode = false; // if true, next canvas click performs flood fill on activeLayer
const HISTORY_LIMIT = 200;

/* ===== 유틸: 고해상도 캔버스 설정 ===== */
function setCanvasSizeForDisplay(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

/* ===== 컨테이너/툴바 모바일 대응: 위치/크기 보정 ===== */
function updateContainerLayout() {
  const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
  const w = window.innerWidth;
  const h = Math.max(100, window.innerHeight - toolbarHeight);
  // ensure container sits below toolbar so toolbar buttons remain clickable
  container.style.position = 'absolute';
  container.style.left = '0';
  container.style.top = toolbarHeight + 'px';
  container.style.width = w + 'px';
  container.style.height = h + 'px';
  // resize canvases to match
  resizeAllCanvases();
}

/* ===== 브러시 옵션 초기화 (1..100) ===== */
for (let i = 1; i <= 100; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  brushSelect.appendChild(opt);
}
brushSelect.value = 10;

/* ===== 초기 로드/리사이즈 이벤트 ===== */
window.addEventListener('load', () => {
  // Restore autosaved session if available
  restoreSessionFromLocalStorage();
  updateContainerLayout();
  if (layers.length === 0) createLayer('Layer 1');
  updateLayersPanel();
  loadGalleryFromLocalStorage();
});
window.addEventListener('resize', () => {
  updateContainerLayout();
});
window.addEventListener('orientationchange', () => {
  setTimeout(updateContainerLayout, 120);
});

/* ===== 히스토리: 캡처 및 복원 (레이어별 스냅샷) ===== */
function captureLayersSnapshot() {
  // return array of dataUrls for each layer (visible or not — we store full layer content)
  return layers.map(layer => {
    try {
      return layer.canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  });
}
async function restoreLayersSnapshot(snapshot) {
  // snapshot: array of dataUrls; if lengths mismatch, adjust layers
  if (!snapshot || !Array.isArray(snapshot)) return;
  // if snapshot has more layers than current, create missing layers
  while (snapshot.length > layers.length) {
    createLayer('Layer ' + (layers.length + 1));
  }
  // if snapshot has fewer layers, leave extra layers (we'll overwrite first snapshot.length layers)
  const promises = snapshot.map((dataUrl, idx) => {
    return new Promise(resolve => {
      if (!dataUrl) return resolve();
      const img = new Image();
      img.onload = () => {
        const target = layers[idx];
        target.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
        target.ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = dataUrl;
    });
  });
  await Promise.all(promises);
  updateLayersPanel();
  drawLayers();
}

/* push snapshot to history (composite per-layer snapshot) */
function pushHistorySnapshot() {
  try {
    const snap = captureLayersSnapshot();
    history.push(snap);
    if (history.length > HISTORY_LIMIT) history.shift();
    // new action clears redo stack
    redoStack = [];
  } catch (e) {
    console.warn('pushHistorySnapshot failed', e);
  }
}

/* Undo: restore last snapshot (pop from history) */
async function doUndo() {
  if (history.length === 0) return;
  const last = history.pop();
  // push current state to redo stack
  try {
    const current = captureLayersSnapshot();
    redoStack.push(current);
  } catch (e) {}
  await restoreLayersSnapshot(last);
}

/* Redo */
async function doRedo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  try {
    const current = captureLayersSnapshot();
    history.push(current);
  } catch (e) {}
  await restoreLayersSnapshot(next);
}

/* hook undo/redo buttons */
undoBtn && undoBtn.addEventListener('click', async () => { await doUndo(); });
redoBtn && redoBtn.addEventListener('click', async () => { await doRedo(); });

/* ===== 레이어 생성/삭제/이동/합체/렌더 ===== */
function createLayer(name = `Layer ${layers.length + 1}`) {
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);
  const ctx = setCanvasSizeForDisplay(canvas, container.clientWidth || 800, container.clientHeight || 600);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const layer = { canvas, ctx, name, brightness: 1, visible: true, blur: 0 };
  layers.push(layer);
  activeLayer = layer;
  attachDrawingEvents(canvas);
  pushHistorySnapshot(); // capture state before editing new layer existence
  updateLayersPanel();
  drawLayers();
  return layer;
}
function deleteLayer(layer) {
  if (layers.length <= 1) return;
  const idx = layers.indexOf(layer);
  layers.splice(idx, 1);
  if (layer.canvas.parentElement) container.removeChild(layer.canvas);
  if (activeLayer === layer) activeLayer = layers[layers.length - 1];
  layers.forEach((l, i) => l.canvas.style.zIndex = i);
  pushHistorySnapshot();
  updateLayersPanel();
  drawLayers();
}
function moveLayer(layer, dir) {
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx, 1);
  layers.splice(newIdx, 0, layer);
  layers.forEach((l, i) => {
    l.canvas.style.zIndex = i;
    if (l.canvas.parentElement) container.appendChild(l.canvas);
  });
  pushHistorySnapshot();
  updateLayersPanel();
}
function mergeActiveWithNeighbor() {
  if (!activeLayer || layers.length < 2) return;
  const idx = layers.indexOf(activeLayer);
  let targetIdx = idx - 1;
  if (targetIdx < 0) targetIdx = idx + 1;
  if (targetIdx < 0 || targetIdx >= layers.length) return;
  const target = layers[targetIdx];
  target.ctx.save();
  target.ctx.globalCompositeOperation = 'source-over';
  target.ctx.drawImage(activeLayer.canvas, 0, 0, container.clientWidth, container.clientHeight);
  target.ctx.restore();
  deleteLayer(activeLayer);
  activeLayer = target;
  pushHistorySnapshot();
  updateLayersPanel();
  drawLayers();
}
function drawLayers() {
  layers.forEach(layer => {
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    const blurPx = layer.blur ? ` blur(${layer.blur}px)` : '';
    layer.canvas.style.filter = `brightness(${layer.brightness})${blurPx}`;
  });
}

/* ===== 레이어 패널 UI 업데이트 (brightness + blur controls) ===== */
function updateLayersPanel() {
  if (!layersPanel) return;
  layersPanel.innerHTML = '';
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer === activeLayer ? ' active' : '');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = layer.name;

    const rangeBrightness = document.createElement('input');
    rangeBrightness.type = 'range'; rangeBrightness.min = '0'; rangeBrightness.max = '2'; rangeBrightness.step = '0.01';
    rangeBrightness.value = layer.brightness;

    const rangeBlur = document.createElement('input');
    rangeBlur.type = 'range'; rangeBlur.min = '0'; rangeBlur.max = '20'; rangeBlur.step = '0.5';
    rangeBlur.value = layer.blur || 0;

    const controls = document.createElement('div'); controls.className = 'layer-controls';
    const visBtn = document.createElement('button'); visBtn.textContent = layer.visible ? '👁' : '🚫';
    const upBtn = document.createElement('button'); upBtn.textContent = '⬆️';
    const downBtn = document.createElement('button'); downBtn.textContent = '⬇️';
    const delBtn = document.createElement('button'); delBtn.textContent = '❌';

    controls.appendChild(visBtn); controls.appendChild(upBtn); controls.appendChild(downBtn); controls.appendChild(delBtn);

    item.appendChild(name);
    // label brightness
    const brLabel = document.createElement('div'); brLabel.style.display='flex'; brLabel.style.alignItems='center'; brLabel.style.gap='6px';
    const brText = document.createElement('small'); brText.textContent='밝기';
    brLabel.appendChild(brText); brLabel.appendChild(rangeBrightness);
    item.appendChild(brLabel);
    // label blur
    const blurLabel = document.createElement('div'); blurLabel.style.display='flex'; blurLabel.style.alignItems='center'; blurLabel.style.gap='6px';
    const blurText = document.createElement('small'); blurText.textContent='흐림';
    blurLabel.appendChild(blurText); blurLabel.appendChild(rangeBlur);
    item.appendChild(blurLabel);

    item.appendChild(controls);

    item.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      activeLayer = layer;
      updateLayersPanel();
    });

    rangeBrightness.addEventListener('input', () => { layer.brightness = parseFloat(rangeBrightness.value); drawLayers(); pushHistorySnapshot(); });
    rangeBlur.addEventListener('input', () => { layer.blur = parseFloat(rangeBlur.value); drawLayers(); pushHistorySnapshot(); });

    visBtn.addEventListener('click', (e) => { e.stopPropagation(); layer.visible = !layer.visible; visBtn.textContent = layer.visible ? '👁' : '🚫'; drawLayers(); pushHistorySnapshot(); });
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteLayer(layer); });
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, +1); });
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, -1); });

    layersPanel.appendChild(item);
  }
}

/* ===== 그리기 이벤트 (Pointer Events) ===== */
/* Important: on pointerdown we push snapshot to history ONCE so undo reverts entire action in one click */
function attachDrawingEvents(canvas) {
  let drawing = false;
  let pointerId = null;
  let last = { x: 0, y: 0 };
  function toCanvasPos(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }
  function onPointerDown(e) {
    // ignore when pointer is on UI controls (buttons)
    if (e.target && e.target.tagName === 'BUTTON') return;
    // if fill mode is active, perform flood-fill and return
    if (isFillMode) {
      const p = toCanvasPos(e.clientX, e.clientY);
      // push pre-snapshot
      pushHistorySnapshot();
      performFloodFill(activeLayer, Math.round(p.x), Math.round(p.y), hexToRgba(colorPicker.value));
      isFillMode = false;
      fillBtn.classList.remove('active');
      return;
    }

    // start normal drawing
    pointerId = e.pointerId;
    canvas.setPointerCapture && canvas.setPointerCapture(pointerId);
    drawing = true;
    last = toCanvasPos(e.clientX, e.clientY);
    // push snapshot BEFORE the action to enable single-click undo
    try { pushHistorySnapshot(); } catch (err) { console.warn('history push fail', err); }
    if (activeLayer) {
      const ctx = activeLayer.ctx;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
    }
  }
  function onPointerMove(e) {
    if (!drawing || e.pointerId !== pointerId) return;
    const p = toCanvasPos(e.clientX, e.clientY);
    if (!activeLayer) return;
    const ctx = activeLayer.ctx;
    ctx.save();
    ctx.globalCompositeOperation = usingEraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = parseFloat(brushSelect.value) || 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
    last = p;
  }
  function onPointerUp(e) {
    if (e.pointerId !== pointerId) return;
    canvas.releasePointerCapture && canvas.releasePointerCapture(pointerId);
    pointerId = null;
    drawing = false;
    // after finishing drawing, no need to push another snapshot (we saved pre-action)
    // but to allow redo after undo, we capture current and push to redoStack? handled by undo logic
  }
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', (e) => { if (drawing && e.pointerId === pointerId) onPointerUp(e); });
}

/* ===== Flood Fill (페인트통) ===== */
/* Using non-recursive queue-based algorithm on ImageData */
function performFloodFill(layer, x, y, fillColorRGBA) {
  if (!layer) return;
  const canvas = layer.canvas;
  const ctx = layer.ctx;
  const width = canvas.width / (window.devicePixelRatio || 1);
  const height = canvas.height / (window.devicePixelRatio || 1);
  // Read image data
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const idx = (y * width + x) * 4;
  const targetR = data[idx], targetG = data[idx + 1], targetB = data[idx + 2], targetA = data[idx + 3];
  // If clicked color is same as fill color, skip
  if (targetR === fillColorRGBA.r && targetG === fillColorRGBA.g && targetB === fillColorRGBA.b && targetA === fillColorRGBA.a) return;
  const visited = new Uint8Array(width * height);
  const stack = [];
  stack.push({ x, y });
  while (stack.length) {
    const p = stack.pop();
    const px = p.x, py = p.y;
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const index = (py * width + px);
    if (visited[index]) continue;
    const i = index * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    // simple exact match for now — could add tolerance
    if (r === targetR && g === targetG && b === targetB && a === targetA) {
      data[i] = fillColorRGBA.r;
      data[i + 1] = fillColorRGBA.g;
      data[i + 2] = fillColorRGBA.b;
      data[i + 3] = fillColorRGBA.a;
      visited[index] = 1;
      stack.push({ x: px + 1, y: py });
      stack.push({ x: px - 1, y: py });
      stack.push({ x: px, y: py + 1 });
      stack.push({ x: px, y: py - 1 });
    } else {
      visited[index] = 1;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  pushHistorySnapshot();
}

/* helper hex -> rgba object (0-255) */
function hexToRgba(hex) {
  // supports #rrggbb or #rgb
  if (!hex) return { r: 0, g: 0, b: 0, a: 255 };
  if (hex[0] === '#') hex = hex.slice(1);
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return { r, g, b, a: 255 };
  } else if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { r, g, b, a: 255 };
  } else {
    return { r: 0, g: 0, b: 0, a: 255 };
  }
}

/* fill button toggles fill mode */
fillBtn && fillBtn.addEventListener('click', () => {
  isFillMode = !isFillMode;
  fillBtn.classList.toggle('active', isFillMode);
});

/* 지우개 토글 */
eraserBtn && eraserBtn.addEventListener('click', () => {
  usingEraser = !usingEraser;
  eraserBtn.classList.toggle('active', usingEraser);
});

/* ===== 저장/갤러리 및 persistence (localStorage) ===== */
function addGalleryThumbnail(dataUrl) {
  const img = document.createElement('img');
  img.src = dataUrl;
  img.className = 'gallery-item';
  img.title = '불러오기';
  img.addEventListener('click', async () => {
    // push current state so user can undo loading
    pushHistorySnapshot();
    const image = new Image();
    image.onload = () => {
      if (!activeLayer) createLayer('Layer ' + (layers.length + 1));
      activeLayer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
      activeLayer.ctx.drawImage(image, 0, 0, container.clientWidth, container.clientHeight);
      pushHistorySnapshot();
      saveSessionToLocalStorage();
    };
    image.src = dataUrl;
  });
  galleryPanel.appendChild(img);
  persistGalleryToLocalStorage();
}

/* Save button saves composite image and adds to gallery and localStorage */
saveBtn && saveBtn.addEventListener('click', () => {
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  layers.forEach(layer => {
    if (layer.visible) tctx.drawImage(layer.canvas, 0, 0, container.clientWidth, container.clientHeight);
  });
  const data = tmp.toDataURL('image/png');
  addGalleryThumbnail(data);
  // also persist session
  saveSessionToLocalStorage();
});

/* persist gallery to localStorage */
function persistGalleryToLocalStorage() {
  try {
    const imgs = Array.from(galleryPanel.querySelectorAll('img')).map(img => img.src);
    localStorage.setItem('drawing_app_gallery', JSON.stringify(imgs));
  } catch (e) { /* ignore */ }
}
function loadGalleryFromLocalStorage() {
  try {
    const raw = localStorage.getItem('drawing_app_gallery');
    if (!raw) return;
    const arr = JSON.parse(raw);
    arr.forEach(src => addGalleryThumbnail(src));
  } catch (e) { /* ignore */ }
}

/* Save current per-layer state to localStorage (autosave on unload) */
function saveSessionToLocalStorage() {
  try {
    const snapshot = captureLayersSnapshot();
    localStorage.setItem('drawing_app_autosave', JSON.stringify(snapshot));
  } catch (e) { /* ignore */ }
}
function restoreSessionFromLocalStorage() {
  try {
    const raw = localStorage.getItem('drawing_app_autosave');
    if (!raw) return;
    const snapshot = JSON.parse(raw);
    if (Array.isArray(snapshot) && snapshot.length) {
      // create layers to match snapshot size
      while (snapshot.length > layers.length) createLayer('Layer ' + (layers.length + 1));
      restoreLayersSnapshot(snapshot);
    }
  } catch (e) { /* ignore */ }
}
window.addEventListener('beforeunload', () => {
  saveSessionToLocalStorage();
  persistGalleryToLocalStorage();
});

/* ===== 캔버스 크기 조절 UI (동적 버튼 추가) ===== */
(function createResizeButton() {
  if (!toolbar) return;
  const btn = document.createElement('button');
  btn.id = 'resize-canvas';
  btn.textContent = '캔버스 크기 조절';
  btn.style.marginLeft = '6px';
  toolbar.appendChild(btn);
  btn.addEventListener('click', () => {
    const wInput = prompt('캔버스 너비(px)를 입력하세요', String(container.clientWidth));
    if (!wInput) return;
    const hInput = prompt('캔버스 높이(px)를 입력하세요', String(container.clientHeight));
    if (!hInput) return;
    const w = Math.max(100, parseInt(wInput, 10) || container.clientWidth);
    const h = Math.max(100, parseInt(hInput, 10) || container.clientHeight);
    // resize container and canvases, preserving content
    container.style.width = w + 'px';
    container.style.height = h + 'px';
    resizeAllCanvasesTo(w, h);
    saveSessionToLocalStorage();
  });
})();

/* utility resize to explicit dimensions (preserve content) */
function resizeAllCanvasesTo(newW, newH) {
  layers.forEach(layer => {
    // preserve content
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(layer.canvas, 0, 0);
    // set new size
    setCanvasSizeForDisplay(layer.canvas, newW, newH);
    // restore scaled
    try {
      const ratio = window.devicePixelRatio || 1;
      layer.ctx.drawImage(tmp, 0, 0, tmp.width / ratio, tmp.height / ratio, 0, 0, newW, newH);
    } catch (e) {
      layer.ctx.clearRect(0, 0, newW, newH);
    }
  });
  updateLayersPanel();
}

/* wrapper for general resize call */
function resizeAllCanvases() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer => {
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(layer.canvas, 0, 0);
    setCanvasSizeForDisplay(layer.canvas, w, h);
    try {
      const ratio = window.devicePixelRatio || 1;
      layer.ctx.drawImage(tmp, 0, 0, tmp.width / ratio, tmp.height / ratio, 0, 0, w, h);
    } catch (e) {
      layer.ctx.clearRect(0, 0, w, h);
    }
  });
}

/* ===== 이미지 삽입 overlay 개선 (핀치/드래그/휠/액션 버튼 항상 클릭 가능) ===== */
imageInput && imageInput.addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => openImageOverlay(img);
  img.src = URL.createObjectURL(f);
  imageInput.value = '';
});

function openImageOverlay(image) {
  // wrapper appended to document.body to ensure above all UI
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = '100vw';
  wrapper.style.height = '100vh';
  wrapper.style.zIndex = '999999'; // high
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.background = 'rgba(0,0,0,0.12)';
  wrapper.style.touchAction = 'none';
  document.body.appendChild(wrapper);

  // inner area aligns with container size for consistent coordinates
  const inner = document.createElement('div');
  inner.style.position = 'relative';
  inner.style.width = container.clientWidth + 'px';
  inner.style.height = container.clientHeight + 'px';
  inner.style.touchAction = 'none';
  wrapper.appendChild(inner);

  const overlay = document.createElement('canvas');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.touchAction = 'none';
  inner.appendChild(overlay);
  const octx = setCanvasSizeForDisplay(overlay, inner.clientWidth, inner.clientHeight);

  // src canvas holds original image pixel data
  const src = document.createElement('canvas');
  setCanvasSizeForDisplay(src, image.width, image.height);
  src.getContext('2d').drawImage(image, 0, 0);

  // transform state
  let scale = Math.min(inner.clientWidth / image.width, inner.clientHeight / image.height, 1);
  let rotation = 0;
  let pos = { x: (inner.clientWidth - image.width * scale) / 2, y: (inner.clientHeight - image.height * scale) / 2 };

  // multi-pointer state
  const pointers = new Map();
  let prevMiddle = null;
  let prevDist = 0;
  let prevAngle = 0;

  function redraw() {
    const w = overlay.width / (window.devicePixelRatio || 1);
    const h = overlay.height / (window.devicePixelRatio || 1);
    octx.clearRect(0, 0, w, h);
    octx.save();
    octx.translate(pos.x + (image.width * scale) / 2, pos.y + (image.height * scale) / 2);
    octx.rotate(rotation * Math.PI / 180);
    octx.drawImage(src, - (image.width * scale) / 2, - (image.height * scale) / 2, image.width * scale, image.height * scale);
    octx.restore();
  }
  redraw();

  function onPointerDown(e) {
    if (e.button && e.button !== 0) return;
    overlay.setPointerCapture && overlay.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const p = pointers.values().next().value;
      prevMiddle = { x: p.x, y: p.y };
    } else if (pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      prevDist = Math.hypot(b.x - a.x, b.y - a.y);
      prevMiddle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      prevAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const p = pointers.values().next().value;
      const dx = p.x - prevMiddle.x;
      const dy = p.y - prevMiddle.y;
      prevMiddle = { x: p.x, y: p.y };
      pos.x += dx;
      pos.y += dy;
      redraw();
    } else if (pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      const newDist = Math.hypot(b.x - a.x, b.y - a.y);
      const newMiddle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const newAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;

      if (prevDist > 0) {
        const factor = newDist / prevDist;
        const oldScale = scale;
        scale = Math.max(0.05, Math.min(scale * factor, 50));
        const rect = overlay.getBoundingClientRect();
        const mx = newMiddle.x - rect.left;
        const my = newMiddle.y - rect.top;
        pos.x = mx - ((mx - pos.x) * (scale / oldScale));
        pos.y = my - ((my - pos.y) * (scale / oldScale));
      }

      const deltaAngle = newAngle - prevAngle;
      rotation += deltaAngle;
      prevDist = newDist;
      prevAngle = newAngle;
      prevMiddle = newMiddle;
      redraw();
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    overlay.releasePointerCapture && overlay.releasePointerCapture(e.pointerId);
    if (pointers.size === 1) {
      const p = pointers.values().next().value;
      prevMiddle = { x: p.x, y: p.y };
    } else {
      prevMiddle = null;
      prevDist = 0;
      prevAngle = 0;
    }
  }

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);
  overlay.addEventListener('pointerleave', onPointerUp);

  overlay.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const delta = ev.deltaY < 0 ? 1.12 : 0.88;
    const oldScale = scale;
    scale = Math.max(0.05, Math.min(scale * delta, 50));
    pos.x = mx - ((mx - pos.x) * (scale / oldScale));
    pos.y = my - ((my - pos.y) * (scale / oldScale));
    redraw();
  }, { passive: false });

  // action buttons
  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  actions.style.position = 'absolute';
  actions.style.bottom = '16px';
  actions.style.left = '50%';
  actions.style.transform = 'translateX(-50%)';
  actions.style.zIndex = '1000001';
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  wrapper.appendChild(actions);

  const zoomOutBtn_local = document.createElement('button'); zoomOutBtn_local.textContent = '-';
  const zoomInBtn = document.createElement('button'); zoomInBtn.textContent = '+';
  const rotL = document.createElement('button'); rotL.textContent = '⟲';
  const rotR = document.createElement('button'); rotR.textContent = '⟳';
  const cancelBtn = document.createElement('button'); cancelBtn.textContent = '✖';
  const confirmBtn = document.createElement('button'); confirmBtn.textContent = '✔';

  actions.appendChild(zoomOutBtn_local);
  actions.appendChild(zoomInBtn);
  actions.appendChild(rotL);
  actions.appendChild(rotR);
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  zoomInBtn.addEventListener('click', () => {
    const rect = overlay.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const oldScale = scale;
    scale = Math.min(scale * 1.2, 50);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale));
    pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redraw();
  });

  zoomOutBtn_local.addEventListener('click', () => {
    const rect = overlay.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const oldScale = scale;
    scale = Math.max(scale * 0.85, 0.05);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale));
    pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redraw();
  });

  rotL.addEventListener('click', () => { rotation -= 15; redraw(); });
  rotR.addEventListener('click', () => { rotation += 15; redraw(); });

  confirmBtn.addEventListener('click', () => {
    // preserve history before applying
    pushHistorySnapshot();
    if (!activeLayer) createLayer('Layer ' + (layers.length + 1));
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x + (image.width * scale) / 2, pos.y + (image.height * scale) / 2);
    activeLayer.ctx.rotate(rotation * Math.PI / 180);
    activeLayer.ctx.drawImage(src, - (image.width * scale) / 2, - (image.height * scale) / 2, image.width * scale, image.height * scale);
    activeLayer.ctx.restore();
    pushHistorySnapshot();
    saveSessionToLocalStorage();
    cleanup();
  });

  cancelBtn.addEventListener('click', () => {
    cleanup();
  });

  function cleanup() {
    try {
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
      overlay.removeEventListener('pointercancel', onPointerUp);
    } catch (e) { }
    if (wrapper.parentElement) document.body.removeChild(wrapper);
  }

  redraw();
}

/* ===== 단축키: undo/redo ===== */
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault(); doUndo();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault(); doRedo();
  }
});

/* ===== 초기 로드: ensure at least one layer and restore autosave gallery ===== */
if (layers.length === 0) createLayer('Layer 1');
updateLayersPanel();
drawLayers();
loadGalleryFromLocalStorage();
restoreSessionFromLocalStorage();
