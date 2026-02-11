/* 파일명: script.js
   전체 통합본 — 요청받은 모든 기능 반영 (모바일 개선, 줌/팬/핀치, flood-fill 페인트통,
   블러/투명도 레이어 제어, 캔버스 리사이즈, 갤러리 로컬저장, 히스토리(전체 레이어 스냅샷),
   브러시/지우개 최대 100, 지우개 undo 에서 한 번만 되도록 수정 등)
   ※ 요약 없음 — 코드 전체 제공

   참고(알고리즘/웹API 관련 구현 근거):
   - Flood fill (stack-based/iterative) 참조 및 구현 아이디어. :contentReference[oaicite:0]{index=0}
   - Pointer Events / Pinch zoom gestures (multi-pointer handling). :contentReference[oaicite:1]{index=1}
   - Canvas filter / blur usage and alternatives. :contentReference[oaicite:2]{index=2}
   - Saving canvas to dataURL and localStorage basics. :contentReference[oaicite:3]{index=3}
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

/* ===== 상태 및 설정 ===== */
let layers = []; // { canvas, ctx, name, brightness, visible, blur, opacity }
let activeLayer = null;
let history = []; // stores snapshots of all layers
let redoStack = [];
let usingEraser = false;
let lastActionRecorded = false; // to ensure single history entry per tool action
const MAX_HISTORY = 300;

/* ===== 유틸: 고해상도 캔버스 설정 (devicePixelRatio 적용) ===== */
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

/* ===== 컨테이너/레이아웃 초기화 (모바일 우선) ===== */
function updateContainerSize() {
  const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
  const w = window.innerWidth;
  const h = Math.max(120, window.innerHeight - toolbarHeight);
  container.style.width = w + 'px';
  container.style.height = h + 'px';
}
window.addEventListener('load', () => {
  updateContainerSize();
});
window.addEventListener('resize', () => {
  updateContainerSize();
  clearTimeout(window.__resize_timeout);
  window.__resize_timeout = setTimeout(() => {
    resizeAllCanvases();
  }, 80);
});

/* ===== 브러시/지우개 컨트롤: 1..100 ===== */
brushSelect.innerHTML = '';
for (let i = 1; i <= 100; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  brushSelect.appendChild(opt);
}
brushSelect.value = 20;

/* ===== 히스토리: 전체 레이어 스냅샷 방식으로 변경 ===== */
function snapshotAllLayers() {
  // Save small snapshot: array of dataURLs + active index + per-layer meta (brightness, visible, blur, opacity)
  const snap = {
    timestamp: Date.now(),
    activeIndex: layers.indexOf(activeLayer),
    layers: layers.map(l => ({
      dataUrl: l.canvas.toDataURL('image/png'),
      name: l.name,
      brightness: l.brightness,
      visible: l.visible,
      blur: l.blur || 0,
      opacity: (l.opacity === undefined ? 1 : l.opacity)
    }))
  };
  history.push(snap);
  if (history.length > MAX_HISTORY) history.shift();
  // clear redo
  redoStack = [];
}
function restoreAllLayersSnapshot(snap) {
  // Remove existing canvases and rebuild to match snap
  // Clear existing canvases from DOM
  while (container.firstChild) container.removeChild(container.firstChild);
  layers = [];
  // Create layers from snapshot data (top to bottom)
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || Math.max(400, window.innerHeight - (toolbar ? toolbar.clientHeight : 48));
  for (let i = 0; i < snap.layers.length; i++) {
    const meta = snap.layers[i];
    const canvas = document.createElement('canvas');
    canvas.className = 'layer-canvas';
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    container.appendChild(canvas);
    const ctx = setCanvasSizeForDisplay(canvas, container.clientWidth, container.clientHeight);
    const layer = { canvas, ctx, name: meta.name || `Layer ${i+1}`, brightness: meta.brightness, visible: meta.visible, blur: meta.blur || 0, opacity: meta.opacity || 1 };
    layers.push(layer);
    const img = new Image();
    // Closure to capture layer
    ((layer, dataUrl) => {
      img.onload = () => {
        layer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
        layer.ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
        applyLayerStyles(layer);
        updateLayersPanel();
      };
    })(layer, meta.dataUrl);
    img.src = meta.dataUrl;
  }
  activeLayer = layers[Math.min(snap.activeIndex || 0, layers.length - 1)] || layers[0];
  // reattach drawing events
  layers.forEach(l => attachDrawingEvents(l.canvas));
}

/* ===== saveHistory / undo / redo using entire snapshot ===== */
function saveHistory() {
  snapshotAllLayers();
}
function undo() {
  if (history.length === 0) return;
  const last = history.pop();
  // push current state to redo
  const currentSnap = {
    timestamp: Date.now(),
    activeIndex: layers.indexOf(activeLayer),
    layers: layers.map(l => ({
      dataUrl: l.canvas.toDataURL('image/png'),
      name: l.name,
      brightness: l.brightness,
      visible: l.visible,
      blur: l.blur || 0,
      opacity: (l.opacity === undefined ? 1 : l.opacity)
    }))
  };
  redoStack.push(currentSnap);
  // restore last
  restoreAllLayersSnapshot(last);
}
function redo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  // push current to history
  const currentSnap = {
    timestamp: Date.now(),
    activeIndex: layers.indexOf(activeLayer),
    layers: layers.map(l => ({
      dataUrl: l.canvas.toDataURL('image/png'),
      name: l.name,
      brightness: l.brightness,
      visible: l.visible,
      blur: l.blur || 0,
      opacity: (l.opacity === undefined ? 1 : l.opacity)
    }))
  };
  history.push(currentSnap);
  restoreAllLayersSnapshot(next);
}
undoBtn.addEventListener('click', () => undo());
redoBtn.addEventListener('click', () => redo());

/* ===== 레이어 유틸 및 UI ===== */
function applyLayerStyles(layer) {
  // apply css filters and opacity and brightness
  const blurPx = (layer.blur || 0);
  const brightness = (layer.brightness === undefined ? 1 : layer.brightness);
  const opacity = (layer.opacity === undefined ? 1 : layer.opacity);
  // combine brightness, blur, and optional other filters
  layer.canvas.style.filter = `brightness(${brightness}) blur(${blurPx}px)`;
  layer.canvas.style.opacity = `${opacity}`;
}
function drawLayers() {
  layers.forEach(applyLayerStyles);
}
function updateLayersPanel() {
  if (!layersPanel) return;
  layersPanel.innerHTML = '';
  // layer items (top-most first to show intuitive order)
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer === activeLayer ? ' active' : '');
    item.style.display = 'flex';
    item.style.flexDirection = 'column';
    item.style.marginBottom = '6px';
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = layer.name;
    name.style.flex = '1';
    const visBtn = document.createElement('button');
    visBtn.textContent = layer.visible ? '👁' : '🚫';
    const upBtn = document.createElement('button'); upBtn.textContent = '⬆️';
    const downBtn = document.createElement('button'); downBtn.textContent = '⬇️';
    const delBtn = document.createElement('button'); delBtn.textContent = '❌';
    row.appendChild(name);
    row.appendChild(visBtn);
    row.appendChild(upBtn);
    row.appendChild(downBtn);
    row.appendChild(delBtn);
    // controls row: brightness, blur, opacity, select button
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '6px';
    controls.style.alignItems = 'center';
    const brightLabel = document.createElement('label'); brightLabel.textContent = '명도';
    const brightRange = document.createElement('input');
    brightRange.type = 'range'; brightRange.min = '0'; brightRange.max = '2'; brightRange.step = '0.01'; brightRange.value = layer.brightness ?? 1;
    const blurLabel = document.createElement('label'); blurLabel.textContent = '흐림';
    const blurRange = document.createElement('input');
    blurRange.type = 'range'; blurRange.min = '0'; blurRange.max = '50'; blurRange.step = '1'; blurRange.value = layer.blur || 0;
    const opLabel = document.createElement('label'); opLabel.textContent = '투명도';
    const opRange = document.createElement('input');
    opRange.type = 'range'; opRange.min = '0'; opRange.max = '1'; opRange.step = '0.01'; opRange.value = (layer.opacity === undefined ? 1 : layer.opacity);

    controls.appendChild(brightLabel); controls.appendChild(brightRange);
    controls.appendChild(blurLabel); controls.appendChild(blurRange);
    controls.appendChild(opLabel); controls.appendChild(opRange);

    item.appendChild(row);
    item.appendChild(controls);

    // click behaviors
    item.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      activeLayer = layer;
      updateLayersPanel();
    });
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      visBtn.textContent = layer.visible ? '👁' : '🚫';
      applyLayerStyles(layer);
      saveHistory();
    });
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteLayer(layer); });
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, +1); });
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, -1); });

    brightRange.addEventListener('input', (e) => { layer.brightness = parseFloat(brightRange.value); applyLayerStyles(layer); saveHistory(); });
    blurRange.addEventListener('input', (e) => { layer.blur = parseFloat(blurRange.value); applyLayerStyles(layer); saveHistory(); });
    opRange.addEventListener('input', (e) => { layer.opacity = parseFloat(opRange.value); applyLayerStyles(layer); saveHistory(); });

    layersPanel.appendChild(item);
  }
}

/* ===== 레이어 생성/삭제/이동/합체 (기본 유지) ===== */
function createLayer(name = `Layer ${layers.length + 1}`) {
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);
  const ctx = setCanvasSizeForDisplay(canvas, container.clientWidth || window.innerWidth, container.clientHeight || Math.max(400, window.innerHeight - (toolbar ? toolbar.clientHeight : 48)));
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const layer = { canvas, ctx, name, brightness: 1, visible: true, blur: 0, opacity: 1 };
  layers.push(layer);
  activeLayer = layer;
  attachDrawingEvents(canvas);
  applyLayerStyles(layer);
  saveHistory();
  updateLayersPanel();
  return layer;
}
function deleteLayer(layer) {
  if (layers.length <= 1) return;
  const idx = layers.indexOf(layer);
  layers.splice(idx, 1);
  if (layer.canvas.parentElement) container.removeChild(layer.canvas);
  if (activeLayer === layer) activeLayer = layers[layers.length - 1];
  layers.forEach((l, i) => l.canvas.style.zIndex = i);
  saveHistory();
  updateLayersPanel();
}
function moveLayer(layer, dir) {
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx, 1);
  layers.splice(newIdx, 0, layer);
  layers.forEach((l, i) => { l.canvas.style.zIndex = i; container.appendChild(l.canvas); });
  saveHistory(); updateLayersPanel();
}
function mergeActiveWithNeighbor() {
  if (layers.length < 2) return;
  const idx = layers.indexOf(activeLayer);
  let neighbor = idx - 1;
  if (neighbor < 0) neighbor = idx + 1;
  if (neighbor < 0 || neighbor >= layers.length) return;
  const target = layers[neighbor];
  target.ctx.save();
  target.ctx.globalCompositeOperation = 'source-over';
  target.ctx.drawImage(activeLayer.canvas, 0, 0, container.clientWidth, container.clientHeight);
  target.ctx.restore();
  deleteLayer(activeLayer);
  activeLayer = target;
  updateLayersPanel();
  saveHistory();
}

/* ===== 그리기: Pointer Events 통합 (모바일/마우스/펜) ===== */
/* 변경: drawing 동작 당 한 번만 history 저장 (undo 단일 클릭 문제 해결) */
function attachDrawingEvents(canvas) {
  let drawing = false;
  let pointerId = null;
  let last = { x: 0, y: 0 };
  let hasDrawnThisStroke = false;

  // helper: get pos relative to container
  function toCanvasPos(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startStroke() {
    hasDrawnThisStroke = false;
    lastActionRecorded = false;
  }

  function endStroke() {
    if (hasDrawnThisStroke && !lastActionRecorded) {
      // record a single history entry for this stroke
      snapshotAllLayers();
      lastActionRecorded = true;
    }
    hasDrawnThisStroke = false;
  }

  function onPointerDown(e) {
    if (e.target && e.target.tagName === 'BUTTON') return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    drawing = true;
    last = toCanvasPos(e.clientX, e.clientY);
    startStroke();
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
    ctx.lineWidth = Math.max(1, parseFloat(brushSelect.value) || 1); // up to 100
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
    last = p;
    hasDrawnThisStroke = true;
  }

  function onPointerUp(e) {
    if (e.pointerId !== pointerId) return;
    canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId);
    pointerId = null;
    drawing = false;
    endStroke();
  }

  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', (e) => { if (drawing && e.pointerId === pointerId) onPointerUp(e); });
}

/* ===== Flood Fill (페인트통) 구현 — iterative stack-based (빠른 픽셀 접근) ===== */
/* References: Stack-based iterative algorithms & optimizations. :contentReference[oaicite:4]{index=4} */
function colorToRgbaArray(hexOrRgb) {
  // Accept hex like #rrggbb or #rgb or rgb(...) or #rrggbbaa
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = hexOrRgb;
  const computed = ctx.fillStyle; // normalized
  // draw 1px and get rgba
  ctx.canvas.width = 1; ctx.canvas.height = 1;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}
function getPixel32(data, x, y, w) {
  // return 32-bit int from Uint8ClampedArray starting point
  const idx = (y * w + x) * 4;
  return (data[idx] << 24) | (data[idx+1] << 16) | (data[idx+2] << 8) | (data[idx+3]);
}
function setPixel32(data, x, y, w, r, g, b, a) {
  const idx = (y * w + x) * 4;
  data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = a;
}
function floodFill(layer, startX, startY, fillColor) {
  // layer: {canvas, ctx}
  const ctx = layer.ctx;
  const w = layer.canvas.width / (window.devicePixelRatio || 1);
  const h = layer.canvas.height / (window.devicePixelRatio || 1);
  try {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const targetIdx = (Math.floor(startY) * w + Math.floor(startX)) * 4;
    const sr = data[targetIdx], sg = data[targetIdx+1], sb = data[targetIdx+2], sa = data[targetIdx+3];
    const [fr, fg, fb, fa] = colorToRgbaArray(fillColor);
    // if same color, return
    if (sr === fr && sg === fg && sb === fb && sa === fa) return;
    const visited = new Uint8Array(w * h);
    const stack = [];
    stack.push({ x: Math.floor(startX), y: Math.floor(startY) });
    while (stack.length) {
      const p = stack.pop();
      const x = p.x, y = p.y;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const idx = y * w + x;
      if (visited[idx]) continue;
      const o = idx * 4;
      const r = data[o], g = data[o+1], b = data[o+2], a = data[o+3];
      // simple equality test; could use tolerance
      if (r === sr && g === sg && b === sb && a === sa) {
        // set pixel to fill color (immediately to avoid re-check)
        data[o] = fr; data[o+1] = fg; data[o+2] = fb; data[o+3] = fa;
        visited[idx] = 1;
        // push neighbors
        stack.push({ x: x+1, y: y });
        stack.push({ x: x-1, y: y });
        stack.push({ x: x, y: y+1 });
        stack.push({ x: x, y: y-1 });
      }
    }
    ctx.putImageData(imageData, 0, 0);
  } catch (e) {
    // getImageData may throw for tainted canvas; ignore
    console.warn('floodFill failed', e);
  }
}
/* paint bucket click handler */
fillBtn.addEventListener('click', () => {
  // Switch to paint-bucket mode for next click
  canvasSetMode('bucket');
});
let canvasMode = 'draw'; // 'draw' or 'bucket' or 'pan'
function canvasSetMode(m) {
  canvasMode = m;
  // provide visual cue maybe via toolbar style
  if (m === 'bucket') {
    fillBtn.style.background = '#ddd';
  } else {
    fillBtn.style.background = '';
  }
}

/* Use a top-level pointer handler to capture bucket click */
container.addEventListener('pointerdown', (ev) => {
  if (canvasMode === 'bucket') {
    ev.preventDefault();
    const rect = container.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    if (activeLayer) {
      // record before change for undo
      snapshotAllLayers();
      floodFill(activeLayer, x, y, colorPicker.value);
      // revert to draw mode
      canvasSetMode('draw');
      fillBtn.style.background = '';
    }
  }
});

/* ===== 지우개 / 브러시 크기/동작 개선 ===== */
/* usingEraser toggled by eraserBtn; brushSelect gives size 1..100 already */
/* ensure eraser uses globalCompositeOperation destination-out which is already handled in drawing loop */
eraserBtn.addEventListener('click', () => {
  usingEraser = !usingEraser;
  eraserBtn.style.background = usingEraser ? '#ddd' : '';
});

/* ===== Blur & opacity already added to layer controls above (updateLayersPanel) ===== */

/* ===== Canvas 크기 조절 UI (동적으로 툴바에 버튼 추가) ===== */
(function createCanvasResizeControls(){
  if(!toolbar) return;
  const resizeLabel = document.createElement('label');
  resizeLabel.style.marginLeft = '8px';
  resizeLabel.textContent = '캔버스:';
  const wInput = document.createElement('input'); wInput.type='number'; wInput.min='100'; wInput.style.width='80px'; wInput.placeholder='width';
  const hInput = document.createElement('input'); hInput.type='number'; hInput.min='100'; hInput.style.width='80px'; hInput.placeholder='height';
  const applyBtn = document.createElement('button'); applyBtn.textContent = '적용';
  applyBtn.addEventListener('click', ()=>{
    const w = parseInt(wInput.value) || container.clientWidth;
    const h = parseInt(hInput.value) || container.clientHeight;
    // resize container and canvases; preserve content scaled
    container.style.width = w + 'px';
    container.style.height = h + 'px';
    resizeAllCanvases();
  });
  toolbar.appendChild(resizeLabel);
  toolbar.appendChild(wInput);
  toolbar.appendChild(hInput);
  toolbar.appendChild(applyBtn);
})();

/* ===== Resize All Canvases with content preservation ===== */
function resizeAllCanvases() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer => {
    // preserve
    const tmp = document.createElement('canvas');
    const tr = setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
    // draw original scaled down/up from old canvas
    try {
      // old canvas logical size
      const oldW = layer.canvas.width / (window.devicePixelRatio || 1);
      const oldH = layer.canvas.height / (window.devicePixelRatio || 1);
      // copy old pixels
      const oldDataUrl = layer.canvas.toDataURL();
      const img = new Image();
      img.onload = () => {
        // set new size on layer.canvas
        const ctx = setCanvasSizeForDisplay(layer.canvas, w, h);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, oldW, oldH, 0, 0, w, h);
        applyLayerStyles(layer);
      };
      img.src = oldDataUrl;
    } catch (e) {
      // fallback: set new size blank
      setCanvasSizeForDisplay(layer.canvas, w, h);
      applyLayerStyles(layer);
    }
  });
}

/* ===== 저장/갤러리: localStorage에 저장 (새로고침 후 갤러리 유지), 캔버스 내용은 자동 복원하지 않음 (요청사항) ===== */
const GALLERY_KEY = 'simple_canvas_gallery_v1';
function loadGalleryFromStorage() {
  try {
    const raw = localStorage.getItem(GALLERY_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    arr.forEach(dataUrl => addGalleryImageElement(dataUrl, false));
  } catch (e) { console.warn('loadGalleryFromStorage failed', e); }
}
function saveGalleryToStorage() {
  try {
    const thumbs = Array.from(galleryPanel.querySelectorAll('img.gallery-item')).map(img => img.src);
    localStorage.setItem(GALLERY_KEY, JSON.stringify(thumbs));
  } catch (e) { console.warn('saveGalleryToStorage failed', e); }
}
function addGalleryImage(dataUrl) {
  addGalleryImageElement(dataUrl, true);
}
function addGalleryImageElement(dataUrl, persist) {
  const img = document.createElement('img');
  img.className = 'gallery-item';
  img.src = dataUrl;
  img.addEventListener('click', () => {
    // when reloading a saved image into active layer, record history so user can undo back to previous canvas
    saveHistory();
    const image = new Image();
    image.onload = () => {
      if (!activeLayer) createLayer();
      activeLayer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
      activeLayer.ctx.drawImage(image, 0, 0, container.clientWidth, container.clientHeight);
      applyLayerStyles(activeLayer);
      // record the load as an action (so undo reverts)
      snapshotAllLayers();
    };
    image.src = dataUrl;
  });
  galleryPanel.appendChild(img);
  if (persist) saveGalleryToStorage();
}

/* load gallery on start */
loadGalleryFromStorage();

/* save button behavior: save current flattened image to file and gallery (persisted) */
saveBtn.addEventListener('click', () => {
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  // draw layers bottom-to-top
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!l.visible) continue;
    tctx.save();
    // apply layer opacity locally when drawing
    tctx.globalAlpha = (l.opacity === undefined ? 1 : l.opacity);
    // we can draw the canvas directly scaled
    tctx.drawImage(l.canvas, 0, 0, container.clientWidth, container.clientHeight);
    tctx.restore();
  }
  const data = tmp.toDataURL('image/png');
  // trigger download
  const link = document.createElement('a');
  link.download = 'drawing.png';
  link.href = data;
  link.click();
  // add to gallery and persist
  addGalleryImage(data);
  saveGalleryToStorage();
});

/* ===== 이미지 삽입 overlay (pan/pinch/wheel/rotate) — 개선된 모바일 대응 ===== */
/* Keep actions above UI so buttons clickable even when layers panel visible */
imageInput.addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => openImageOverlay(img);
  img.src = URL.createObjectURL(f);
  imageInput.value = '';
});

function openImageOverlay(image) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = '100vw';
  wrapper.style.height = '100vh';
  wrapper.style.zIndex = '2147483640';
  wrapper.style.background = 'rgba(0,0,0,0.12)';
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.touchAction = 'none';
  document.body.appendChild(wrapper);

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

  const src = document.createElement('canvas');
  setCanvasSizeForDisplay(src, image.width, image.height);
  src.getContext('2d').drawImage(image, 0, 0);

  let scale = Math.min(inner.clientWidth / image.width, inner.clientHeight / image.height, 1);
  let rotation = 0;
  let pos = { x: (inner.clientWidth - image.width * scale) / 2, y: (inner.clientHeight - image.height * scale) / 2 };

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
      pos.x += dx; pos.y += dy;
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
        scale = Math.max(0.05, Math.min(scale * factor, 20));
        const rect = overlay.getBoundingClientRect();
        const mx = newMiddle.x - rect.left;
        const my = newMiddle.y - rect.top;
        pos.x = mx - ((mx - pos.x) * (scale / oldScale));
        pos.y = my - ((my - pos.y) * (scale / oldScale));
      }
      const deltaAngle = newAngle - prevAngle;
      rotation += deltaAngle;
      prevDist = newDist; prevAngle = newAngle; prevMiddle = newMiddle;
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
      prevMiddle = null; prevDist = 0; prevAngle = 0;
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
    const mx = ev.clientX - rect.left; const my = ev.clientY - rect.top;
    const delta = ev.deltaY < 0 ? 1.12 : 0.88;
    const oldScale = scale;
    scale = Math.max(0.05, Math.min(scale * delta, 20));
    pos.x = mx - ((mx - pos.x) * (scale / oldScale));
    pos.y = my - ((my - pos.y) * (scale / oldScale));
    redraw();
  }, { passive: false });

  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  actions.style.position = 'absolute';
  actions.style.bottom = '16px';
  actions.style.left = '50%';
  actions.style.transform = 'translateX(-50%)';
  actions.style.zIndex = '2147483641';
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
    const oldScale = scale; scale = Math.min(scale * 1.2, 20);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale)); pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redraw();
  });
  zoomOutBtn_local.addEventListener('click', () => {
    const rect = overlay.getBoundingClientRect(); const cx = rect.width / 2, cy = rect.height / 2;
    const oldScale = scale; scale = Math.max(scale * 0.85, 0.05);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale)); pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redraw();
  });
  rotL.addEventListener('click', () => { rotation -= 15; redraw(); });
  rotR.addEventListener('click', () => { rotation += 15; redraw(); });

  confirmBtn.addEventListener('click', () => {
    // save current canvas state for undo BEFORE applying image
    snapshotAllLayers();
    if (!activeLayer) createLayer();
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x + (image.width * scale) / 2, pos.y + (image.height * scale) / 2);
    activeLayer.ctx.rotate(rotation * Math.PI / 180);
    activeLayer.ctx.drawImage(src, - (image.width * scale) / 2, - (image.height * scale) / 2, image.width * scale, image.height * scale);
    activeLayer.ctx.restore();
    applyLayerStyles(activeLayer);
    saveHistory();
    cleanup();
  });

  cancelBtn.addEventListener('click', cleanup);

  function cleanup() {
    try {
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
    } catch (e) {}
    if (wrapper.parentElement) document.body.removeChild(wrapper);
  }

  redraw();
}

/* ===== 기타: 초기 레build and load gallery from storage (persist thumbnails) ===== */
(function init() {
  updateContainerSize();
  if (!layers.length) createLayer('Layer 1');
  resizeAllCanvases();
  loadGalleryFromStorage();
  updateLayersPanel();
  drawLayers();
})();

/* ===== 저장된 갤러리 로드 관련 함수 (위에서 사용) ===== */
function loadGalleryFromStorage() {
  try {
    const raw = localStorage.getItem('simple_canvas_gallery_v1');
    if (!raw) return;
    const arr = JSON.parse(raw);
    arr.forEach(url => addGalleryImageElement(url));
  } catch (e) { console.warn('gallery load failed', e); }
}
function saveGalleryToStorage() {
  try {
    const thumbs = Array.from(galleryPanel.querySelectorAll('img.gallery-item')).map(i => i.src);
    localStorage.setItem('simple_canvas_gallery_v1', JSON.stringify(thumbs));
  } catch (e) { console.warn('gallery save failed', e); }
}
function addGalleryImageElement(dataUrl) {
  const img = document.createElement('img');
  img.className = 'gallery-item';
  img.src = dataUrl;
  img.addEventListener('click', () => {
    // allow undo back to pre-load: snapshot before applying
    snapshotAllLayers();
    const image = new Image();
    image.onload = () => {
      if (!activeLayer) createLayer();
      activeLayer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
      activeLayer.ctx.drawImage(image, 0, 0, container.clientWidth, container.clientHeight);
      applyLayerStyles(activeLayer);
      snapshotAllLayers();
    };
    image.src = dataUrl;
  });
  galleryPanel.appendChild(img);
}

/* wrapper to add gallery saving whenever addGalleryImage used above */
function addGalleryImage(dataUrl) {
  addGalleryImageElement(dataUrl);
  saveGalleryToStorage();
}

/* ===== 키보드 단축 ===== */
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
});
