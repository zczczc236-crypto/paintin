/* 파일명: script.js
   통합 개선판 — 요청된 9개 항목 포함 수정
   - 캔버스 뷰포트 핀치/드래그 줌(전체 캔버스) 지원
   - 히스토리: 전체 레이어 스냅샷 방식으로 변경 (이제 undo 1번으로 지우개 등 복원)
   - 브러시/지우개 최대 100으로 확장
   - 레이어별 흐림(blur) 지원(레이어 패널에 슬라이더 추가)
   - 캔버스 크기 조절 기능(zoom 버튼 더블클릭으로 입력)
   - 갤러리 불러오기 시 이전 상태로 되돌릴 수 있도록 히스토리 저장
   - 새로고침 시 로컬스토리지 자동저장/복원 (로그인 미구현: 로컬스토리지 사용)
   - 페인트통: 선택한 지점 기준 영역 채우기(버킷; tolerance 0)
   - 모바일에서 툴바/레이어 버튼이 캔버스를 가리지 않도록 z-index 조정
   기존 기능(레이어 추가/삭제/합체/명도/토글, 저장, 이미지 삽입/이동/확대/축소/회전 등) 유지
*/

/* ======= DOM 참조 ======= */
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

/* ======= 상태 ======= */
let layers = []; // {canvas, ctx, name, brightness, visible, blur}
let activeLayer = null;
let history = []; // snapshots of all layers
let redoStack = [];
let usingEraser = false;
let fillMode = false; // when true, next canvas click will perform flood fill

/* ======= 뷰포트 (전체 캔버스에 적용되는 transform) ======= */
const viewport = { scale: 1, tx: 0, ty: 0 };
function applyViewportTransform() {
  // transform origin top-left
  container.style.transformOrigin = '0 0';
  container.style.transform = `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`;
}
applyViewportTransform();

/* ======= 고해상도 캔버스 유틸 ======= */
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

/* ======= UI z-index 안전값(툴바/패널이 캔버스 위에 있게) ======= */
if (toolbar) toolbar.style.zIndex = 2147483002;
if (layersPanel) layersPanel.style.zIndex = 2147483002;
if (galleryPanel) galleryPanel.style.zIndex = 2147483002;

/* ======= 브러시 옵션 초기화 (1~100) ======= */
brushSelect.innerHTML = '';
for (let i = 1; i <= 100; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  brushSelect.appendChild(opt);
}
brushSelect.value = 10;

/* ======= 컨테이너 크기 관리 (모바일 우선) ======= */
function updateContainerSize() {
  const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
  const width = window.innerWidth;
  const height = Math.max(120, window.innerHeight - toolbarHeight);
  container.style.width = width + 'px';
  container.style.height = height + 'px';
}
window.addEventListener('resize', () => {
  updateContainerSize();
  resizeAllCanvases();
});

/* ======= 초기 로드: 로컬스토리지 복원 또는 초기 레이어 생성 ======= */
window.addEventListener('load', () => {
  updateContainerSize();
  restoreFromLocalStorage();
  if (layers.length === 0) {
    createLayer('Layer 1');
    saveHistory(); // initial snapshot
  }
  resizeAllCanvases();
  updateLayersPanel();
  applyViewportTransform();
});

/* ======= 리사이즈 모든 캔버스 (내용 보존) ======= */
function resizeAllCanvases() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer => {
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tmp.getContext('2d').drawImage(layer.canvas, 0, 0);
    setCanvasSizeForDisplay(layer.canvas, w, h);
    try {
      const ratio = window.devicePixelRatio || 1;
      layer.ctx.clearRect(0, 0, w, h);
      layer.ctx.drawImage(tmp, 0, 0, tmp.width / ratio, tmp.height / ratio, 0, 0, w, h);
    } catch (e) {
      layer.ctx.clearRect(0, 0, w, h);
    }
  });
}

/* ======= 레이어 생성/삭제/이동/합체 ======= */
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
  drawLayers();
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
  layers.forEach((l, i) => { l.canvas.style.zIndex = i; });
  updateLayersPanel();
  saveHistory();
}

function moveLayer(layer, dir) {
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx, 1);
  layers.splice(newIdx, 0, layer);
  layers.forEach((l, i) => { l.canvas.style.zIndex = i; container.appendChild(l.canvas); });
  updateLayersPanel();
  saveHistory();
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
  saveHistory();
}

/* ======= 레이어 패널 업데이트 (명도 + 흐림 슬라이더 추가) ======= */
function updateLayersPanel() {
  if (!layersPanel) return;
  layersPanel.innerHTML = '';
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer === activeLayer ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = layer.name;

    const rangeBright = document.createElement('input');
    rangeBright.type = 'range';
    rangeBright.min = '0';
    rangeBright.max = '2';
    rangeBright.step = '0.01';
    rangeBright.value = layer.brightness;

    const rangeBlur = document.createElement('input');
    rangeBlur.type = 'range';
    rangeBlur.min = '0';
    rangeBlur.max = '20';
    rangeBlur.step = '0.5';
    rangeBlur.value = layer.blur;

    const controls = document.createElement('div');
    controls.className = 'layer-controls';
    const visBtn = document.createElement('button'); visBtn.textContent = layer.visible ? '👁' : '🚫';
    const upBtn = document.createElement('button'); upBtn.textContent = '⬆️';
    const downBtn = document.createElement('button'); downBtn.textContent = '⬇️';
    const delBtn = document.createElement('button'); delBtn.textContent = '❌';
    controls.appendChild(visBtn); controls.appendChild(upBtn); controls.appendChild(downBtn); controls.appendChild(delBtn);

    item.appendChild(name);
    // show brightness & blur sliders stacked
    const wrapSliders = document.createElement('div');
    wrapSliders.style.display = 'flex';
    wrapSliders.style.flexDirection = 'column';
    wrapSliders.style.gap = '4px';
    const lblB = document.createElement('div'); lblB.textContent = '명도';
    const lblBl = document.createElement('div'); lblBl.textContent = '흐림';
    wrapSliders.appendChild(lblB); wrapSliders.appendChild(rangeBright); wrapSliders.appendChild(lblBl); wrapSliders.appendChild(rangeBlur);
    item.appendChild(wrapSliders);

    item.appendChild(controls);

    item.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return; activeLayer = layer; updateLayersPanel(); });
    rangeBright.addEventListener('input', () => { layer.brightness = parseFloat(rangeBright.value); drawLayers(); });
    rangeBlur.addEventListener('input', () => { layer.blur = parseFloat(rangeBlur.value); drawLayers(); saveHistory(); });

    visBtn.addEventListener('click', (e) => { e.stopPropagation(); layer.visible = !layer.visible; visBtn.textContent = layer.visible ? '👁' : '🚫'; drawLayers(); saveHistory(); });
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteLayer(layer); });
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, 1); });
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, -1); });

    layersPanel.appendChild(item);
  }
}

/* ======= drawLayers: apply visibility, brightness, blur via CSS filters ======= */
function drawLayers() {
  layers.forEach(layer => {
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    // use both brightness and blur
    layer.canvas.style.filter = `brightness(${layer.brightness}) blur(${layer.blur}px)`;
  });
}

/* ======= 히스토리: 전체 레이어 스냅샷 방식 ======= */
function saveHistory() {
  try {
    const snapshot = { layers: layers.map(l => l.canvas.toDataURL()), activeIndex: layers.indexOf(activeLayer), viewport: { ...viewport }, timestamp: Date.now() };
    history.push(snapshot);
    if (history.length > 200) history.shift();
    redoStack = [];
    // also autosave to localStorage (debounced)
    scheduleLocalSave();
  } catch (e) {
    console.warn('saveHistory failed', e);
  }
}

async function restoreSnapshot(snapshot) {
  return new Promise((resolve) => {
    const dataArr = snapshot.layers || [];
    const promises = [];
    // if layer counts differ, try to adjust
    while (layers.length < dataArr.length) createLayer(`Layer ${layers.length + 1}`);
    while (layers.length > dataArr.length) deleteLayer(layers[layers.length - 1]);
    dataArr.forEach((dataUrl, idx) => {
      promises.push(new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          const layer = layers[idx];
          layer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
          layer.ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
          res();
        };
        img.onerror = () => res();
        img.src = dataUrl;
      }));
    });
    Promise.all(promises).then(() => {
      if (snapshot.activeIndex !== undefined && layers[snapshot.activeIndex]) activeLayer = layers[snapshot.activeIndex];
      if (snapshot.viewport) { viewport.scale = snapshot.viewport.scale || 1; viewport.tx = snapshot.viewport.tx || 0; viewport.ty = snapshot.viewport.ty || 0; applyViewportTransform(); }
      drawLayers();
      resolve();
    });
  });
}

undoBtn.addEventListener('click', async () => {
  if (history.length === 0) return;
  const last = history.pop();
  try {
    // push current state into redo
    const currentSnap = { layers: layers.map(l => l.canvas.toDataURL()), activeIndex: layers.indexOf(activeLayer), viewport: { ...viewport } };
    redoStack.push(currentSnap);
  } catch (e) { /* ignore */ }
  await restoreSnapshot(last);
  updateLayersPanel();
});

redoBtn.addEventListener('click', async () => {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  try {
    const current = { layers: layers.map(l => l.canvas.toDataURL()), activeIndex: layers.indexOf(activeLayer), viewport: { ...viewport } };
    history.push(current);
  } catch (e) { }
  await restoreSnapshot(next);
  updateLayersPanel();
});

/* ======= 도구: 페인트통(영역 채우기) ======= */
/* fillMode: 클릭하면 해당 지점 영역을 채움 (tolerance 0) */
fillBtn.addEventListener('click', () => {
  fillMode = true;
  // indicate to user maybe by toggling button highlight
  fillBtn.style.background = '#ddd';
});

function performFloodFill(layer, x, y, fillColor) {
  try {
    const ctx = layer.ctx;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    // convert point to integer coords
    const px = Math.floor(x);
    const py = Math.floor(y);
    const idx = (py * w + px) * 4;
    const targetR = data[idx], targetG = data[idx + 1], targetB = data[idx + 2], targetA = data[idx + 3];
    const [fr, fg, fb, fa] = fillColor;
    // tolerance 0 => exact match
    if (targetR === fr && targetG === fg && targetB === fb && targetA === fa) return false;
    const stack = [[px, py]];
    const visited = new Uint8Array(w * h);
    const inBounds = (nx, ny) => nx >= 0 && ny >= 0 && nx < w && ny < h;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const cidx = (cy * w + cx);
      if (visited[cidx]) continue;
      visited[cidx] = 1;
      const di = cidx * 4;
      if (data[di] === targetR && data[di + 1] === targetG && data[di + 2] === targetB && data[di + 3] === targetA) {
        data[di] = fr; data[di + 1] = fg; data[di + 2] = fb; data[di + 3] = fa;
        // push neighbors
        if (inBounds(cx + 1, cy)) stack.push([cx + 1, cy]);
        if (inBounds(cx - 1, cy)) stack.push([cx - 1, cy]);
        if (inBounds(cx, cy + 1)) stack.push([cx, cy + 1]);
        if (inBounds(cx, cy - 1)) stack.push([cx, cy - 1]);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return true;
  } catch (e) {
    console.warn('flood fill failed', e);
    return false;
  }
}

/* 유틸: CSS color (#rrggbb or #rgb) -> rgba array */
function hexToRgba(hex) {
  if (!hex) return [0, 0, 0, 255];
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return [r, g, b, 255];
}

/* ======= 그리기 이벤트 (Pointer Events 통합) ======= */
/* toCanvasPos accounts for viewport transform: inverse transform */
function toCanvasPosTransformed(clientX, clientY) {
  const rect = container.getBoundingClientRect();
  // convert client to container local coords (CSS pixels)
  const lx = clientX - rect.left;
  const ly = clientY - rect.top;
  // inverse viewport transform: (lx - tx)/scale
  const x = (lx - viewport.tx) / viewport.scale;
  const y = (ly - viewport.ty) / viewport.scale;
  return { x, y };
}

function attachDrawingEvents(canvas) {
  let drawing = false;
  let pointerId = null;
  let last = { x: 0, y: 0 };

  function onDown(e) {
    // fill mode check
    if (fillMode && activeLayer) {
      const p = toCanvasPosTransformed(e.clientX, e.clientY);
      const rgba = hexToRgba(colorPicker.value);
      // save history before fill so undo works
      saveHistory();
      const filled = performFloodFill(activeLayer, Math.round(p.x), Math.round(p.y), rgba);
      fillMode = false;
      fillBtn.style.background = '';
      if (filled) saveHistory(); // push after fill
      return;
    }
    if (e.target && e.target.tagName === 'BUTTON') return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    drawing = true;
    last = toCanvasPosTransformed(e.clientX, e.clientY);
    if (activeLayer) {
      const ctx = activeLayer.ctx;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
    }
  }

  function onMove(e) {
    if (!drawing || e.pointerId !== pointerId) return;
    const p = toCanvasPosTransformed(e.clientX, e.clientY);
    if (!activeLayer) return;
    const ctx = activeLayer.ctx;
    ctx.save();
    ctx.globalCompositeOperation = usingEraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = Math.max(1, parseFloat(brushSelect.value) || 5);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
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
    saveHistory(); // one history entry per stroke (works for eraser too)
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', (e) => { if (drawing && e.pointerId === pointerId) onUp(e); });
}

/* ======= 저장 / 갤러리 (갤러리에서 불러올 때 히스토리 보장) ======= */
saveBtn.addEventListener('click', () => {
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  layers.forEach(l => { if (l.visible) tctx.drawImage(l.canvas, 0, 0, container.clientWidth, container.clientHeight); });
  const data = tmp.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = 'drawing.png';
  link.href = data;
  link.click();
  addGalleryThumbnail(data);
  // persist to localStorage as saved image too
  try { localStorage.setItem('drawing_saved_png', data); } catch (e) { }
});

function addGalleryThumbnail(srcDataUrl) {
  const img = document.createElement('img');
  img.src = srcDataUrl;
  img.className = 'gallery-item';
  img.title = '불러오기';
  img.addEventListener('click', () => {
    // push history before loading so user can undo
    saveHistory();
    const image = new Image();
    image.onload = () => {
      if (!activeLayer) createLayer();
      activeLayer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
      activeLayer.ctx.drawImage(image, 0, 0, container.clientWidth, container.clientHeight);
      saveHistory();
    };
    image.src = srcDataUrl;
  });
  galleryPanel.appendChild(img);
}

/* ======= UI 연결 및 추가 기능 ======= */
toggleLayersBtn.addEventListener('click', () => { if (layersPanel) layersPanel.classList.toggle('visible'); });
addLayerBtn.addEventListener('click', () => createLayer());
mergeLayerBtn.addEventListener('click', () => mergeActiveWithNeighbor());
eraserBtn.addEventListener('click', () => { usingEraser = !usingEraser; eraserBtn.style.background = usingEraser ? '#ddd' : ''; });

/* zoomOutBtn double-click => 캔버스 리사이즈 입력 */
zoomOutBtn.addEventListener('dblclick', () => {
  const val = prompt('새 캔버스 크기 입력 (가로,세로) 예: 1024,768', `${container.clientWidth},${container.clientHeight}`);
  if (!val) return;
  const parts = val.split(',').map(s => parseInt(s.trim()));
  if (parts.length === 2 && parts[0] > 10 && parts[1] > 10) resizeCanvas(parts[0], parts[1]);
});

/* resizeCanvas: 보존하고 새 크기로 변경 */
function resizeCanvas(newW, newH) {
  layers.forEach(layer => {
    const tmp = document.createElement('canvas');
    const tr = tmp.getContext('2d');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tr.drawImage(layer.canvas, 0, 0);
    setCanvasSizeForDisplay(layer.canvas, newW, newH);
    try {
      const ratio = window.devicePixelRatio || 1;
      layer.ctx.drawImage(tmp, 0, 0, tmp.width / ratio, tmp.height / ratio, 0, 0, newW, newH);
    } catch (e) { layer.ctx.clearRect(0, 0, newW, newH); }
  });
  container.style.width = newW + 'px';
  container.style.height = newH + 'px';
  saveHistory();
}

/* ======= 이미지 삽입 overlay (기존대로 유지) ======= */
imageInput.addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => openImageOverlay(img);
  img.src = URL.createObjectURL(f);
  imageInput.value = '';
});

/* overlay code simplified but same features; uses very high z-index so buttons clickable */
function openImageOverlay(image) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = '100vw';
  wrapper.style.height = '100vh';
  wrapper.style.zIndex = '2147483005';
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.background = 'rgba(0,0,0,0.12)';
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
  let prevMiddle = null, prevDist = 0, prevAngle = 0;

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
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
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
  actions.style.zIndex = '2147483006';
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  wrapper.appendChild(actions);

  const zoomOutBtn_local = document.createElement('button'); zoomOutBtn_local.textContent = '-';
  const zoomInBtn = document.createElement('button'); zoomInBtn.textContent = '+';
  const rotL = document.createElement('button'); rotL.textContent = '⟲';
  const rotR = document.createElement('button'); rotR.textContent = '⟳';
  const cancelBtn = document.createElement('button'); cancelBtn.textContent = '✖';
  const confirmBtn = document.createElement('button'); confirmBtn.textContent = '✔';
  actions.appendChild(zoomOutBtn_local); actions.appendChild(zoomInBtn); actions.appendChild(rotL); actions.appendChild(rotR); actions.appendChild(cancelBtn); actions.appendChild(confirmBtn);

  zoomInBtn.addEventListener('click', () => { const rect = overlay.getBoundingClientRect(); const cx = rect.width / 2, cy = rect.height / 2; const oldScale = scale; scale = Math.min(scale * 1.2, 20); pos.x = cx - ((cx - pos.x) * (scale / oldScale)); pos.y = cy - ((cy - pos.y) * (scale / oldScale)); redraw(); });
  zoomOutBtn_local.addEventListener('click', () => { const rect = overlay.getBoundingClientRect(); const cx = rect.width / 2, cy = rect.height / 2; const oldScale = scale; scale = Math.max(scale * 0.85, 0.05); pos.x = cx - ((cx - pos.x) * (scale / oldScale)); pos.y = cy - ((cy - pos.y) * (scale / oldScale)); redraw(); });
  rotL.addEventListener('click', () => { rotation -= 15; redraw(); }); rotR.addEventListener('click', () => { rotation += 15; redraw(); });

  confirmBtn.addEventListener('click', () => {
    if (!activeLayer) createLayer();
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x + (image.width * scale) / 2, pos.y + (image.height * scale) / 2);
    activeLayer.ctx.rotate(rotation * Math.PI / 180);
    activeLayer.ctx.drawImage(src, - (image.width * scale) / 2, - (image.height * scale) / 2, image.width * scale, image.height * scale);
    activeLayer.ctx.restore();
    saveHistory();
    cleanup();
  });
  cancelBtn.addEventListener('click', cleanup);

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

/* ======= 뷰포트 핀치/드래그 (캔버스 전체 줌/팬) ======= */
/* 적용: container에 pointer handlers when overlay not active */
(function initViewportGestures() {
  let pointers = new Map();
  let prevMiddle = null;
  let prevDist = 0;
  let isPanning = false;

  function onDown(e) {
    // ignore if UI element (toolbar/panel) clicked: ensure target is container or its canvas children
    if (!container.contains(e.target) && e.target !== container) return;
    container.setPointerCapture && container.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const p = pointers.values().next().value;
      prevMiddle = { x: p.x, y: p.y };
      isPanning = true;
    } else {
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      prevDist = Math.hypot(b.x - a.x, b.y - a.y);
      prevMiddle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      isPanning = false;
    }
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1 && isPanning) {
      const p = pointers.values().next().value;
      const dx = p.x - prevMiddle.x;
      const dy = p.y - prevMiddle.y;
      prevMiddle = { x: p.x, y: p.y };
      viewport.tx += dx;
      viewport.ty += dy;
      applyViewportTransform();
    } else if (pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      const newDist = Math.hypot(b.x - a.x, b.y - a.y);
      const newMiddle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const newAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (prevDist > 0) {
        const factor = newDist / prevDist;
        const oldScale = viewport.scale;
        viewport.scale = Math.max(0.1, Math.min(viewport.scale * factor, 8));
        const rect = container.getBoundingClientRect();
        const mx = newMiddle.x - rect.left;
        const my = newMiddle.y - rect.top;
        viewport.tx = mx - ((mx - viewport.tx) * (viewport.scale / oldScale));
        viewport.ty = my - ((my - viewport.ty) * (viewport.scale / oldScale));
        applyViewportTransform();
      }
      prevDist = newDist;
      prevMiddle = newMiddle;
    }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    container.releasePointerCapture && container.releasePointerCapture(e.pointerId);
    if (pointers.size === 0) {
      isPanning = false;
      prevMiddle = null; prevDist = 0;
    } else if (pointers.size === 1) {
      const p = pointers.values().next().value;
      prevMiddle = { x: p.x, y: p.y };
      isPanning = true;
    }
  }

  container.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
})();

/* ======= 로컬 저장소 자동 저장/복원 ======= */
let localSaveTimeout = null;
function scheduleLocalSave() {
  if (localSaveTimeout) clearTimeout(localSaveTimeout);
  localSaveTimeout = setTimeout(() => {
    try {
      const payload = {
        layers: layers.map(l => ({ name: l.name, dataUrl: l.canvas.toDataURL(), brightness: l.brightness, visible: l.visible, blur: l.blur })),
        viewport: { ...viewport },
        timestamp: Date.now()
      };
      localStorage.setItem('drawing_autosave', JSON.stringify(payload));
    } catch (e) { console.warn('autosave failed', e); }
  }, 800);
}
window.addEventListener('beforeunload', () => {
  scheduleLocalSave();
});

/* restoreFromLocalStorage */
function restoreFromLocalStorage() {
  try {
    const raw = localStorage.getItem('drawing_autosave');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed.layers || parsed.layers.length === 0) return;
    // clear existing canvases
    layers.forEach(l => { if (l.canvas.parentElement) container.removeChild(l.canvas); });
    layers = [];
    // recreate layers and load data
    parsed.layers.forEach((li, idx) => {
      const canvas = document.createElement('canvas');
      canvas.className = 'layer-canvas';
      canvas.style.position = 'absolute';
      canvas.style.left = '0'; canvas.style.top = '0';
      container.appendChild(canvas);
      const ctx = setCanvasSizeForDisplay(canvas, container.clientWidth || 800, container.clientHeight || 600);
      const layer = { canvas, ctx, name: li.name || `Layer ${idx + 1}`, brightness: li.brightness ?? 1, visible: li.visible ?? true, blur: li.blur ?? 0 };
      layers.push(layer);
      // draw image
      if (li.dataUrl) {
        const img = new Image();
        img.onload = () => {
          layer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
          layer.ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
          drawLayers();
        };
        img.src = li.dataUrl;
      }
    });
    activeLayer = layers[parsed.layers.length - 1] || layers[0];
    if (parsed.viewport) { viewport.scale = parsed.viewport.scale || 1; viewport.tx = parsed.viewport.tx || 0; viewport.ty = parsed.viewport.ty || 0; applyViewportTransform(); }
  } catch (e) {
    console.warn('restoreFromLocalStorage failed', e);
  }
}

/* ======= 단축키 ======= */
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoBtn.click(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redoBtn.click(); }
});

/* ======= 초기 보장 ======= */
if (layers.length === 0) createLayer('Layer 1');
updateLayersPanel();
drawLayers();
applyViewportTransform();
