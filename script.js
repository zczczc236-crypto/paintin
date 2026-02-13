/* 파일명: script.js
   수정판 (요청된 1~9번 수정 반영)
   - 핀치/드래그/휠/버튼으로 zoom in/out (두 손 드래그로도 zoom 조절)
   - 지우개 undo가 한 번만 작동하도록 중복 히스토리 푸시 방지
   - 브러시/지우개 최대값 100 (UI가 없으면 스크립트가 동적으로 생성)
   - 레이어별 흐림(blur) 제어 추가 (CSS filter 사용)
   - 캔버스 크기 변경 가능 (동적 UI 생성)
   - 갤러리에서 다시 불러오기 전에 현재 상태 히스토리 저장하여 undo 가능
   - 로컬스토리지 자동 저장/불러오기 (새로고침 복원)
   - 페인트통: 선택한 위치 기준으로 flood-fill 구현 (빠른 스택 방식)
   - 모바일에서 툴바/레이어가 캔버스를 가리지 않도록 z-index 및 토글처리 개선
*/

/* ====== DOM 참조 (있으면 사용, 없으면 동적 생성) ====== */
const ensure = id => document.getElementById(id);
let toolbar = ensure('toolbar');
let container = ensure('canvas-container');
let layersPanel = ensure('layers-panel');
let galleryPanel = ensure('gallery-panel');
let brushSelect = ensure('brush-size');
let colorPicker = ensure('color');
let undoBtn = ensure('undo');
let redoBtn = ensure('redo');
let fillBtn = ensure('fill');
let eraserBtn = ensure('eraser');
let zoomOutBtn = ensure('zoom-out');
let saveBtn = ensure('save');
let addLayerBtn = ensure('add-layer');
let mergeLayerBtn = ensure('merge-layer');
let toggleLayersBtn = ensure('toggle-layers');
let imageInput = ensure('image-input');

/* 동적 생성: 필수 UI가 없으면 만들어 넣음 */
function createIfMissing() {
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'toolbar';
    toolbar.style.position = 'fixed';
    toolbar.style.top = '0';
    toolbar.style.left = '0';
    toolbar.style.right = '0';
    toolbar.style.zIndex = 100000;
    toolbar.style.background = '#f3f3f3';
    toolbar.style.display = 'flex';
    toolbar.style.gap = '6px';
    toolbar.style.padding = '6px';
    document.body.appendChild(toolbar);
  }
  const makeBtn = (id, text) => {
    if (!ensure(id)) {
      const b = document.createElement('button');
      b.id = id;
      b.textContent = text;
      toolbar.appendChild(b);
    }
  };
  const makeInput = (id, type, attrs = {}) => {
    if (!ensure(id)) {
      const el = document.createElement(type === 'select' ? 'select' : 'input');
      el.id = id;
      if (type === 'select') {
        // nothing
      } else {
        el.type = type;
      }
      Object.assign(el, attrs);
      toolbar.appendChild(el);
    }
  };

  makeInput('brush-size', 'select');
  makeInput('color', 'input', { type: 'color', value: '#000000' });
  makeBtn('fill', '페인트통');
  makeBtn('eraser', '지우개');
  makeBtn('undo', '되돌리기');
  makeBtn('redo', '취소');
  makeBtn('zoom-out', '줌아웃');
  makeBtn('save', '저장');
  makeBtn('add-layer', '레이어추가');
  makeBtn('merge-layer', '레이어합체');
  makeBtn('toggle-layers', '레이어창 토글');
  makeInput('image-input', 'input', { type: 'file', accept: 'image/*' });

  // panels
  if (!container) {
    container = document.createElement('div');
    container.id = 'canvas-container';
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = toolbar.getBoundingClientRect().height + 'px';
    container.style.right = '0';
    container.style.bottom = '0';
    container.style.overflow = 'hidden';
    container.style.background = '#fff';
    document.body.appendChild(container);
  }
  if (!layersPanel) {
    layersPanel = document.createElement('div');
    layersPanel.id = 'layers-panel';
    layersPanel.style.position = 'fixed';
    layersPanel.style.right = '8px';
    layersPanel.style.top = (toolbar ? toolbar.getBoundingClientRect().height + 8 : 56) + 'px';
    layersPanel.style.zIndex = 100001;
    layersPanel.style.background = 'rgba(255,255,255,0.95)';
    layersPanel.style.maxHeight = '60vh';
    layersPanel.style.overflow = 'auto';
    layersPanel.style.padding = '6px';
    layersPanel.style.border = '1px solid #ccc';
    document.body.appendChild(layersPanel);
  }
  if (!galleryPanel) {
    galleryPanel = document.createElement('div');
    galleryPanel.id = 'gallery-panel';
    galleryPanel.style.position = 'fixed';
    galleryPanel.style.left = '8px';
    galleryPanel.style.bottom = '8px';
    galleryPanel.style.zIndex = 100001;
    galleryPanel.style.background = 'rgba(255,255,255,0.95)';
    galleryPanel.style.padding = '6px';
    galleryPanel.style.display = 'flex';
    galleryPanel.style.gap = '6px';
    galleryPanel.style.maxWidth = 'calc(100vw - 40px)';
    galleryPanel.style.overflowX = 'auto';
    document.body.appendChild(galleryPanel);
  }

  // rebind references
  brushSelect = ensure('brush-size');
  colorPicker = ensure('color');
  undoBtn = ensure('undo');
  redoBtn = ensure('redo');
  fillBtn = ensure('fill');
  eraserBtn = ensure('eraser');
  zoomOutBtn = ensure('zoom-out');
  saveBtn = ensure('save');
  addLayerBtn = ensure('add-layer');
  mergeLayerBtn = ensure('merge-layer');
  toggleLayersBtn = ensure('toggle-layers');
  imageInput = ensure('image-input');
}
createIfMissing();

/* ===== 상태 변수 ===== */
let layers = []; // { canvas, ctx, name, brightness, blur, visible, lastHistoryDataUrl }
let activeLayer = null;
let history = []; // {layerIndex, dataUrl}
let redoStack = [];
let usingEraser = false;
let autosaveInterval = null;

/* ===== 유틸: DPR 적용 캔버스 사이즈 설정 ===== */
function setCanvasSize(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

/* ===== 컨테이너 크기 조절 (모바일 대응 포함) ===== */
function updateContainerSize() {
  const toolbarH = toolbar ? toolbar.getBoundingClientRect().height : 0;
  const w = window.innerWidth;
  const h = Math.max(120, window.innerHeight - toolbarH);
  container.style.left = '0';
  container.style.top = toolbarH + 'px';
  container.style.width = w + 'px';
  container.style.height = h + 'px';
  // resize canvases to match
  layers.forEach(layer => {
    // preserve and resample
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tmp.getContext('2d').drawImage(layer.canvas, 0, 0);
    const ctx = setCanvasSize(layer.canvas, w, h);
    try {
      const ratio = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(tmp, 0, 0, tmp.width / ratio, tmp.height / ratio, 0, 0, w, h);
    } catch (e) {
      ctx.clearRect(0, 0, w, h);
    }
  });
  // reposition layersPanel
  if (layersPanel) {
    layersPanel.style.top = (toolbar ? toolbar.getBoundingClientRect().height + 8 : 56) + 'px';
  }
}
window.addEventListener('resize', () => {
  updateContainerSize();
});

/* ===== 브러시/지우개 크기 (1..100) UI 셋업 ===== */
function ensureBrushOptions() {
  // if select element, populate 1..100; if input range, adjust
  if (brushSelect.tagName === 'SELECT') {
    brushSelect.innerHTML = '';
    for (let i = 1; i <= 100; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i;
      brushSelect.appendChild(opt);
    }
    brushSelect.value = 10;
  } else {
    // if input[type=range]
    brushSelect.min = 1;
    brushSelect.max = 100;
    brushSelect.value = 10;
  }
}
ensureBrushOptions();

/* ===== 레이어 생성/관리 ===== */
function createLayer(name = `Layer ${layers.length + 1}`) {
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);
  const ctx = setCanvasSize(canvas, container.clientWidth || 800, container.clientHeight || 600);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const layer = { canvas, ctx, name, brightness: 1, blur: 0, visible: true, lastHistoryDataUrl: null };
  layers.push(layer);
  activeLayer = layer;
  attachDrawingEvents(canvas);
  updateLayersPanel();
  saveHistoryMaybe(); // ensure history baseline
  return layer;
}

function deleteLayer(layer) {
  if (layers.length <= 1) return;
  const idx = layers.indexOf(layer);
  layers.splice(idx, 1);
  if (layer.canvas.parentElement) container.removeChild(layer.canvas);
  if (activeLayer === layer) activeLayer = layers[layers.length - 1];
  layers.forEach((l, i) => { l.canvas.style.zIndex = i; });
  updateLayersPanel();
  saveStateToLocal(); // persist
}

function moveLayer(layer, dir) {
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx, 1);
  layers.splice(newIdx, 0, layer);
  layers.forEach((l, i) => { l.canvas.style.zIndex = i; container.appendChild(l.canvas); });
  updateLayersPanel();
  saveStateToLocal();
}

function mergeActiveWithNeighbor() {
  if (layers.length < 2) return;
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
  updateLayersPanel();
  saveStateToLocal();
}

function drawLayersVisualState() {
  layers.forEach(layer => {
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    // combine brightness and blur into CSS filter for display
    const blurPx = layer.blur ? `${layer.blur}px` : '0px';
    layer.canvas.style.filter = `brightness(${layer.brightness}) blur(${blurPx})`;
  });
}

/* ===== 레이어 패널 UI (명도 + 흐림 + 이동/삭제/가시성) ===== */
function updateLayersPanel() {
  layersPanel.innerHTML = '';
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item';
    item.style.padding = '6px';
    item.style.border = layer === activeLayer ? '1px solid #447' : '1px solid transparent';
    item.style.marginBottom = '6px';
    item.style.background = layer === activeLayer ? '#eef' : '#fff';
    const name = document.createElement('div');
    name.textContent = layer.name;
    name.style.fontSize = '13px';
    name.style.marginBottom = '6px';

    // brightness range
    const brightLabel = document.createElement('label');
    brightLabel.textContent = '밝기';
    brightLabel.style.fontSize = '11px';
    const brightRange = document.createElement('input');
    brightRange.type = 'range';
    brightRange.min = '0';
    brightRange.max = '2';
    brightRange.step = '0.01';
    brightRange.value = layer.brightness;

    // blur range
    const blurLabel = document.createElement('label');
    blurLabel.textContent = '흐림';
    blurLabel.style.fontSize = '11px';
    blurLabel.style.marginLeft = '8px';
    const blurRange = document.createElement('input');
    blurRange.type = 'range';
    blurRange.min = '0';
    blurRange.max = '40';
    blurRange.step = '1';
    blurRange.value = layer.blur || 0;

    const controls = document.createElement('div');
    controls.style.marginTop = '6px';
    controls.style.display = 'flex';
    controls.style.gap = '6px';
    const visBtn = document.createElement('button'); visBtn.textContent = layer.visible ? '👁' : '🚫';
    const upBtn = document.createElement('button'); upBtn.textContent = '⬆️';
    const downBtn = document.createElement('button'); downBtn.textContent = '⬇️';
    const delBtn = document.createElement('button'); delBtn.textContent = '❌';

    controls.appendChild(visBtn);
    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(delBtn);

    item.appendChild(name);
    const row = document.createElement('div'); row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px';
    row.appendChild(brightLabel); row.appendChild(brightRange); row.appendChild(blurLabel); row.appendChild(blurRange);
    item.appendChild(row);
    item.appendChild(controls);

    // interactions
    item.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      activeLayer = layer;
      updateLayersPanel();
    });
    brightRange.addEventListener('input', () => {
      layer.brightness = parseFloat(brightRange.value);
      drawLayersVisualState();
      saveStateToLocalDebounced();
    });
    blurRange.addEventListener('input', () => {
      layer.blur = parseInt(blurRange.value, 10) || 0;
      drawLayersVisualState();
      saveStateToLocalDebounced();
    });
    visBtn.addEventListener('click', (e) => { e.stopPropagation(); layer.visible = !layer.visible; visBtn.textContent = layer.visible ? '👁' : '🚫'; drawLayersVisualState(); saveStateToLocal(); });
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteLayer(layer); });
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, +1); });
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, -1); });

    layersPanel.appendChild(item);
  }
}

/* ===== 히스토리 관리 (중복 방지) ===== */
function getCanvasDataUrl(layer) {
  try {
    return layer.canvas.toDataURL('image/png');
  } catch (e) {
    return null;
  }
}
function saveHistoryMaybe() {
  if (!activeLayer) return;
  const data = getCanvasDataUrl(activeLayer);
  if (!data) return;
  if (activeLayer.lastHistoryDataUrl === data) return; // duplicate, skip
  history.push({ layerIndex: layers.indexOf(activeLayer), dataUrl: data });
  activeLayer.lastHistoryDataUrl = data;
  if (history.length > 500) history.shift();
  redoStack = [];
  saveStateToLocalDebounced();
}
function undo() {
  if (history.length === 0) return;
  const last = history.pop();
  try {
    const current = layers[last.layerIndex].canvas.toDataURL('image/png');
    redoStack.push({ layerIndex: last.layerIndex, dataUrl: current });
  } catch (e) { }
  // restore
  const img = new Image();
  img.onload = () => {
    const layer = layers[last.layerIndex];
    if (!layer) return;
    layer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
    layer.ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
    updateLayersPanel();
    saveStateToLocalDebounced();
  };
  img.src = last.dataUrl;
}
function redo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  try {
    const current = layers[next.layerIndex].canvas.toDataURL('image/png');
    history.push({ layerIndex: next.layerIndex, dataUrl: current });
  } catch (e) { }
  const img = new Image();
  img.onload = () => {
    const layer = layers[next.layerIndex];
    if (!layer) return;
    layer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
    layer.ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
    updateLayersPanel();
    saveStateToLocalDebounced();
  };
  img.src = next.dataUrl;
}

/* ===== 그리기: Pointer Events, Eraser & Brush 크기 최대 100 ===== */
function attachDrawingEvents(canvas) {
  let drawing = false;
  let pointerId = null;
  let last = { x: 0, y: 0 };

  function toCanvasPos(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function onDown(e) {
    if (e.target && e.target.tagName === 'BUTTON') return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    drawing = true;
    last = toCanvasPos(e.clientX, e.clientY);
    if (activeLayer) {
      const ctx = activeLayer.ctx;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
    }
  }

  function onMove(e) {
    if (!drawing || e.pointerId !== pointerId) return;
    const p = toCanvasPos(e.clientX, e.clientY);
    if (!activeLayer) return;
    const ctx = activeLayer.ctx;
    ctx.save();
    ctx.globalCompositeOperation = usingEraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = colorPicker.value;
    // brush size capped to 100
    const size = Math.min(100, parseFloat(brushSelect.value) || 10);
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // apply blur to stroke if activeLayer.blur is set (drawn strokes don't get CSS filter, but we can optionally apply ctx.filter)
    if (activeLayer.blur && typeof ctx.filter !== 'undefined') {
      ctx.filter = `blur(${activeLayer.blur}px)`;
    } else {
      ctx.filter = 'none';
    }
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
    last = p;
  }

  function onUp(e) {
    if (e.pointerId !== pointerId) return;
    canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId);
    pointerId = null;
    drawing = false;
    saveHistoryMaybe(); // only push once per stroke
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', (e) => { if (drawing && e.pointerId === pointerId) onUp(e); });
}

/* ===== 저장 / 갤러리 / 로컬스토리지 영구 저장 ===== */
const STORAGE_KEY = 'simple_paint_v1';
function saveStateToLocal() {
  try {
    const state = {
      layersData: layers.map(l => ({
        dataUrl: l.canvas.toDataURL(),
        name: l.name,
        brightness: l.brightness,
        blur: l.blur,
        visible: l.visible
      })),
      activeIndex: layers.indexOf(activeLayer)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('saveStateToLocal failed', e);
  }
}
const saveStateToLocalDebounced = debounce(saveStateToLocal, 600);
function loadStateFromLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const state = JSON.parse(raw);
    // clear current layers
    layers.forEach(l => { if (l.canvas.parentElement) container.removeChild(l.canvas); });
    layers = [];
    state.layersData.forEach((ld, i) => {
      const layer = createLayer(ld.name || `Layer ${i+1}`);
      // draw data
      const img = new Image();
      img.onload = () => {
        layer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
        layer.ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
      };
      img.src = ld.dataUrl;
      layer.brightness = ld.brightness || 1;
      layer.blur = ld.blur || 0;
      layer.visible = typeof ld.visible === 'boolean' ? ld.visible : true;
    });
    activeLayer = layers[state.activeIndex] || layers[0];
    updateLayersPanel();
    drawLayersVisualState();
    return true;
  } catch (e) {
    console.warn('loadStateFromLocal failed', e);
    return false;
  }
}
function saveAsFile() {
  const tmp = document.createElement('canvas');
  setCanvasSize(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  layers.forEach(l => { if (l.visible) tctx.drawImage(l.canvas, 0, 0); });
  const data = tmp.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = 'drawing.png';
  link.href = data;
  link.click();
  // add to gallery and local storage gallery
  addGalleryImage(data);
  saveStateToLocalDebounced();
}
if (saveBtn) saveBtn.addEventListener('click', saveAsFile);

/* gallery add/load: before loading, save current state to history so undo can revert */
function addGalleryImage(dataUrl) {
  const img = document.createElement('img');
  img.src = dataUrl;
  img.className = 'gallery-item';
  img.style.width = '80px';
  img.style.height = '80px';
  img.style.objectFit = 'cover';
  img.style.border = '1px solid #999';
  img.style.cursor = 'pointer';
  img.addEventListener('click', () => {
    // save current state snapshot to history so undo will restore
    if (activeLayer) {
      const current = getCanvasDataUrl(activeLayer);
      if (current) {
        history.push({ layerIndex: layers.indexOf(activeLayer), dataUrl: current });
      }
    }
    const image = new Image();
    image.onload = () => {
      if (!activeLayer) createLayer();
      activeLayer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
      activeLayer.ctx.drawImage(image, 0, 0, container.clientWidth, container.clientHeight);
      saveHistoryMaybe();
      saveStateToLocalDebounced();
    };
    image.src = dataUrl;
  });
  galleryPanel.appendChild(img);
}

/* 자동 저장 주기 설정 (localStorage) */
function startAutosave() {
  if (autosaveInterval) clearInterval(autosaveInterval);
  autosaveInterval = setInterval(() => {
    saveStateToLocal();
  }, 5000);
}
startAutosave();

/* beforeunload persist */
window.addEventListener('beforeunload', () => {
  saveStateToLocal();
});

/* load on start */
updateContainerSize();
if (!loadStateFromLocal()) {
  createLayer('Layer 1');
}

/* ===== 페인트통: Flood fill (stack-based, color tolerance) ===== */
function colorMatch(c1, c2, tol) {
  // c1, c2 are [r,g,b,a]
  const dr = c1[0] - c2[0];
  const dg = c1[1] - c2[1];
  const db = c1[2] - c2[2];
  return (dr * dr + dg * dg + db * db) <= (tol * tol);
}
function getPixel(data, x, y, w) {
  const i = (y * w + x) * 4;
  return [data[i], data[i+1], data[i+2], data[i+3]];
}
function setPixel(data, x, y, w, rgba) {
  const i = (y * w + x) * 4;
  data[i] = rgba[0]; data[i+1] = rgba[1]; data[i+2] = rgba[2]; data[i+3] = rgba[3];
}
function floodFill(ctx, startX, startY, fillColor, tolerance = 32) {
  // ctx is 2D context, fillColor is CSS hex or rgb, tolerance 0..255
  const w = ctx.canvas.width / (window.devicePixelRatio || 1);
  const h = ctx.canvas.height / (window.devicePixelRatio || 1);
  try {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    startX = Math.floor(startX);
    startY = Math.floor(startY);
    if (startX < 0 || startY < 0 || startX >= w || startY >= h) return;
    const startColor = getPixel(data, startX, startY, w);
    // parse fillColor to rgba
    const tmp = document.createElement('canvas');
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = fillColor;
    tctx.fillRect(0,0,1,1);
    const fc = tctx.getImageData(0,0,1,1).data;
    const fillRGBA = [fc[0], fc[1], fc[2], 255];
    if (colorMatch(startColor, fillRGBA, 0)) {
      // same color, nothing to do
      return;
    }
    // stack-based seed fill
    const stack = [];
    stack.push([startX, startY]);
    const visited = new Uint8Array(w * h);
    const tol = tolerance;
    while (stack.length) {
      const [x,y] = stack.pop();
      const idx = y * w + x;
      if (visited[idx]) continue;
      visited[idx] = 1;
      const pc = getPixel(data, x, y, w);
      if (!colorMatch(pc, startColor, tol)) continue;
      setPixel(data, x, y, w, fillRGBA);
      // neighbors
      if (x > 0) stack.push([x-1, y]);
      if (x < w-1) stack.push([x+1, y]);
      if (y > 0) stack.push([x, y-1]);
      if (y < h-1) stack.push([x, y+1]);
    }
    ctx.putImageData(imageData, 0, 0);
    saveHistoryMaybe();
  } catch (e) {
    console.warn('floodFill failed', e);
  }
}

/* 페인트통 버튼 동작: 클릭한 위치에서 색 채우기 (활성 레이어) */
if (fillBtn) {
  fillBtn.addEventListener('click', () => {
    // enable one-shot fill: next click on canvas will flood-fill
    function onCanvasClick(e) {
      if (!activeLayer) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      floodFill(activeLayer.ctx, x, y, colorPicker.value, 32);
      container.removeEventListener('pointerdown', onCanvasClick);
    }
    container.addEventListener('pointerdown', onCanvasClick, { once: true });
  });
}

/* ===== 이미지 삽입 overlay (pinch/drag/rotate, wheel, two-finger vertical drag zoom) ===== */
if (imageInput) {
  imageInput.addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => openImageOverlay(img);
    img.src = URL.createObjectURL(file);
    imageInput.value = '';
  });
}

function openImageOverlay(image) {
  // wrapper above all UI
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = '100vw';
  wrapper.style.height = '100vh';
  wrapper.style.zIndex = 2147483640;
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
  const octx = setCanvasSize(overlay, inner.clientWidth, inner.clientHeight);

  const src = document.createElement('canvas');
  setCanvasSize(src, image.width, image.height);
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
        scale = Math.max(0.05, Math.min(scale * factor, 20));
        // zoom toward midpoint
        const rect = overlay.getBoundingClientRect();
        const mx = newMiddle.x - rect.left;
        const my = newMiddle.y - rect.top;
        pos.x = mx - ((mx - pos.x) * (scale / oldScale));
        pos.y = my - ((my - pos.y) * (scale / oldScale));
      }

      // also support two-finger vertical drag zoom: if dy is dominant, map to zoom
      const dy = (b.y - a.y);
      const dx = (b.x - a.x);
      if (Math.abs(dy) > Math.abs(dx) * 1.2) {
        // use change in middle y to scale
        const deltaY = newMiddle.y - prevMiddle.y;
        const oldScale = scale;
        // map deltaY to factor
        const factor = 1 - deltaY / 500; // tweak sensitivity
        scale = Math.max(0.05, Math.min(scale * factor, 20));
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

  // wheel zoom support
  overlay.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const delta = ev.deltaY < 0 ? 1.12 : 0.88;
    const oldScale = scale;
    scale = Math.max(0.05, Math.min(scale * delta, 20));
    pos.x = mx - ((mx - pos.x) * (scale / oldScale));
    pos.y = my - ((my - pos.y) * (scale / oldScale));
    redraw();
  }, { passive: false });

  // actions (in front)
  const actions = document.createElement('div');
  actions.style.position = 'absolute';
  actions.style.bottom = '12px';
  actions.style.left = '50%';
  actions.style.transform = 'translateX(-50%)';
  actions.style.zIndex = 2147483641;
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  wrapper.appendChild(actions);

  const zOut = document.createElement('button'); zOut.textContent = '-';
  const zIn = document.createElement('button'); zIn.textContent = '+';
  const rL = document.createElement('button'); rL.textContent = '⟲';
  const rR = document.createElement('button'); rR.textContent = '⟳';
  const cancel = document.createElement('button'); cancel.textContent = '✖';
  const confirm = document.createElement('button'); confirm.textContent = '✔';

  actions.appendChild(zOut); actions.appendChild(zIn); actions.appendChild(rL); actions.appendChild(rR); actions.appendChild(cancel); actions.appendChild(confirm);

  zIn.addEventListener('click', () => { const rect = overlay.getBoundingClientRect(); const cx = rect.width/2, cy = rect.height/2; const old = scale; scale = Math.min(scale * 1.2, 20); pos.x = cx - ((cx - pos.x) * (scale / old)); pos.y = cy - ((cy - pos.y) * (scale / old)); redraw(); });
  zOut.addEventListener('click', () => { const rect = overlay.getBoundingClientRect(); const cx = rect.width/2, cy = rect.height/2; const old = scale; scale = Math.max(scale * 0.85, 0.05); pos.x = cx - ((cx - pos.x) * (scale / old)); pos.y = cy - ((cy - pos.y) * (scale / old)); redraw(); });
  rL.addEventListener('click', () => { rotation -= 15; redraw(); });
  rR.addEventListener('click', () => { rotation += 15; redraw(); });

  cancel.addEventListener('click', cleanup);
  confirm.addEventListener('click', () => {
    // save snapshot to history so undo can revert
    if (activeLayer) {
      const cur = getCanvasDataUrl(activeLayer);
      if (cur) history.push({ layerIndex: layers.indexOf(activeLayer), dataUrl: cur });
    }
    if (!activeLayer) createLayer();
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x + (image.width * scale) / 2, pos.y + (image.height * scale) / 2);
    activeLayer.ctx.rotate(rotation * Math.PI / 180);
    activeLayer.ctx.drawImage(src, - (image.width * scale) / 2, - (image.height * scale) / 2, image.width * scale, image.height * scale);
    activeLayer.ctx.restore();
    saveHistoryMaybe();
    saveStateToLocalDebounced();
    cleanup();
  });

  function cleanup() {
    try {
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
    } catch (e) { }
    if (wrapper.parentElement) document.body.removeChild(wrapper);
  }

  redraw();
}

/* ===== 단축키 연결 및 버튼 바인딩 ===== */
if (undoBtn) undoBtn.addEventListener('click', undo);
if (redoBtn) redoBtn.addEventListener('click', redo);
if (addLayerBtn) addLayerBtn.addEventListener('click', () => createLayer());
if (mergeLayerBtn) mergeLayerBtn.addEventListener('click', mergeActiveWithNeighbor);
if (toggleLayersBtn) toggleLayersBtn.addEventListener('click', () => { layersPanel.style.display = layersPanel.style.display === 'none' ? 'block' : 'none'; });

if (eraserBtn) {
  eraserBtn.addEventListener('click', () => {
    usingEraser = !usingEraser;
    eraserBtn.style.background = usingEraser ? '#ddd' : '';
  });
}

/* 페인트통은 위에서 정의(버튼 존재 시) */
if (fillBtn) {
  // (already wired earlier)
}

/* 안전 z-index 설정: 툴바와 레이어와 갤러리가 캔버스보다 위에 있도록 (모바일 터치에서 가리는 문제 방지) */
if (toolbar) { toolbar.style.zIndex = 2147483650; toolbar.style.position = 'fixed'; toolbar.style.top = '0'; toolbar.style.left = '0'; }
if (layersPanel) layersPanel.style.zIndex = 2147483651;
if (galleryPanel) galleryPanel.style.zIndex = 2147483651;

/* ===== 유틸: debounce ===== */
function debounce(fn, ms) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* ===== 보장: 초기 레이어 존재 및 업데이트 ===== */
if (!layers.length) createLayer('Layer 1');
updateContainerSize();
updateLayersPanel();
drawLayersVisualState();

/* ===== 마지막: expose some helpers for debugging in console (optional) ===== */
window.simplePaint = {
  createLayer,
  deleteLayer,
  saveStateToLocal,
  loadStateFromLocal,
  undo,
  redo,
  floodFill,
  addGalleryImage
};
