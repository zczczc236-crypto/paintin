/* 파일명: script.js */
/* 전체 통합본 (모바일 대응 개선판) */
/* 기존 기능 그대로 유지: 브러시(1-20), 색상, 페인트통, 지우개, undo/redo, 레이어(추가/삭제/이동/합체/명도/토글), 갤러리, 저장, 이미지 삽입(이동/확대/축소/회전/확정/취소) */
/* 모바일 레이아웃/터치 문제 해결: 컨테이너 사이즈 고정, 캔버스 DPI 처리, overlay 버튼 우선노출, pointer-events 처리, pinch/rotate 개선 */

/* ====== DOM 요소 참조 ====== */
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

/* ====== 상태 ====== */
let layers = []; // {canvas, ctx, name, brightness, visible}
let activeLayer = null;
let history = [];
let redoStack = [];
let usingEraser = false;

/* ====== 유틸: 캔버스 고해상도 설정 ====== */
function setCanvasSizeForDisplay(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

/* ====== 레이아웃: 모바일에 맞춘 컨테이너 크기 적용 ====== */
function updateContainerSize() {
  // Prefer toolbar height if exists; otherwise fallback
  const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
  const width = window.innerWidth;
  const height = Math.max(100, window.innerHeight - toolbarHeight);
  // ensure container element occupies available area
  container.style.width = width + 'px';
  container.style.height = height + 'px';
  // for safety, also set canvas-container client size will update on resizeAllCanvases
}

/* ====== 브러시 초기화 (1~20) ====== */
for (let i = 1; i <= 20; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  brushSelect.appendChild(opt);
}
brushSelect.value = 5;

/* ====== 초기화 이벤트 ====== */
window.addEventListener('load', () => {
  updateContainerSize();
  createLayer('Layer 1');
  resizeAllCanvases();
  updateLayersPanel();
});
window.addEventListener('resize', () => {
  updateContainerSize();
  // small debounce to avoid thrash
  clearTimeout(window.__resize_timeout);
  window.__resize_timeout = setTimeout(() => {
    resizeAllCanvases();
  }, 80);
});

/* ====== 캔버스 리사이즈 (내용 보존) ====== */
function resizeAllCanvases() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer => {
    // preserve current content into temp
    const tmp = document.createElement('canvas');
    const tmpCtx = tmp.getContext('2d');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tmpCtx.drawImage(layer.canvas, 0, 0);
    // reset canvas for new display size
    const ctx = setCanvasSizeForDisplay(layer.canvas, w, h);
    // draw preserved content scaled to new logical size
    const ratio = window.devicePixelRatio || 1;
    try {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(tmp, 0, 0, tmp.width / ratio, tmp.height / ratio, 0, 0, w, h);
    } catch (e) {
      // fallback: just clear
      ctx.clearRect(0, 0, w, h);
    }
  });
}

/* ====== 레이어 생성/삭제/이동/합체 ====== */
function createLayer(name = `Layer ${layers.length + 1}`) {
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  const w = container.clientWidth || Math.max(800, window.innerWidth);
  const h = container.clientHeight || Math.max(600, window.innerHeight - (toolbar ? toolbar.clientHeight : 48));
  const ctx = setCanvasSizeForDisplay(canvas, w, h);
  canvas.style.zIndex = layers.length;
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);
  const layer = { canvas, ctx, name, brightness: 1, visible: true };
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
  layers.forEach((l, i) => { l.canvas.style.zIndex = i; if (l.canvas.parentElement) container.appendChild(l.canvas); });
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

/* ====== 레이어 렌더링 ====== */
function drawLayers() {
  layers.forEach(layer => {
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    layer.canvas.style.filter = `brightness(${layer.brightness})`;
  });
}

/* ====== 레이어 패널 UI 업데이트 ====== */
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
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '2';
    range.step = '0.01';
    range.value = layer.brightness;
    const controls = document.createElement('div');
    controls.className = 'layer-controls';
    const visBtn = document.createElement('button'); visBtn.textContent = layer.visible ? '👁' : '🚫';
    const upBtn = document.createElement('button'); upBtn.textContent = '⬆️';
    const downBtn = document.createElement('button'); downBtn.textContent = '⬇️';
    const delBtn = document.createElement('button'); delBtn.textContent = '❌';
    controls.appendChild(visBtn); controls.appendChild(upBtn); controls.appendChild(downBtn); controls.appendChild(delBtn);

    item.appendChild(name);
    item.appendChild(range);
    item.appendChild(controls);

    item.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return; activeLayer = layer; updateLayersPanel(); });
    range.addEventListener('input', () => { layer.brightness = parseFloat(range.value); drawLayers(); });
    visBtn.addEventListener('click', (e) => { e.stopPropagation(); layer.visible = !layer.visible; visBtn.textContent = layer.visible ? '👁' : '🚫'; drawLayers(); saveHistory(); });
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteLayer(layer); });
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, +1); });
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, -1); });

    layersPanel.appendChild(item);
  }
}

/* ====== 히스토리 저장/복원 ====== */
function saveHistory() {
  if (!activeLayer) return;
  try {
    const data = activeLayer.canvas.toDataURL('image/png');
    const idx = layers.indexOf(activeLayer);
    history.push({ layerIndex: idx, dataUrl: data });
    if (history.length > 200) history.shift();
    redoStack = [];
  } catch (e) { /* ignore */ }
}
async function restoreSnapshot(snapshot) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const layer = layers[snapshot.layerIndex];
      if (!layer) return resolve();
      layer.ctx.clearRect(0, 0, layer.canvas.width / (window.devicePixelRatio || 1), layer.canvas.height / (window.devicePixelRatio || 1));
      layer.ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
      resolve();
    };
    img.src = snapshot.dataUrl;
  });
}
undoBtn.addEventListener('click', async () => {
  if (history.length === 0) return;
  const last = history.pop();
  try {
    const current = layers[last.layerIndex].canvas.toDataURL('image/png');
    redoStack.push({ layerIndex: last.layerIndex, dataUrl: current });
  } catch (e) { }
  await restoreSnapshot(last);
  updateLayersPanel();
});
redoBtn.addEventListener('click', async () => {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  try {
    const current = layers[next.layerIndex].canvas.toDataURL('image/png');
    history.push({ layerIndex: next.layerIndex, dataUrl: current });
  } catch (e) { }
  await restoreSnapshot(next);
  updateLayersPanel();
});

/* ====== 도구: 페인트통, 지우개 ====== */
fillBtn.addEventListener('click', () => {
  if (!activeLayer) return;
  activeLayer.ctx.save();
  activeLayer.ctx.fillStyle = colorPicker.value;
  activeLayer.ctx.fillRect(0, 0, container.clientWidth, container.clientHeight);
  activeLayer.ctx.restore();
  saveHistory();
});
eraserBtn.addEventListener('click', () => {
  usingEraser = !usingEraser;
  eraserBtn.style.background = usingEraser ? '#ddd' : '';
});

/* ====== 그리기 이벤트: Pointer Events 통합 (모바일/펜/마우스) ====== */
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
    ctx.lineWidth = parseFloat(brushSelect.value) || 5;
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
    saveHistory();
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', (e) => { if (drawing && e.pointerId === pointerId) onUp(e); });
}

/* ====== 저장 / 갤러리 ====== */
saveBtn.addEventListener('click', () => {
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  layers.forEach(layer => { if (layer.visible) tctx.drawImage(layer.canvas, 0, 0, container.clientWidth, container.clientHeight); });
  const data = tmp.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = 'drawing.png';
  link.href = data;
  link.click();
  addGalleryImage(data);
});
function addGalleryImage(data) {
  const img = document.createElement('img');
  img.src = data;
  img.className = 'gallery-item';
  img.addEventListener('click', () => {
    const image = new Image();
    image.onload = () => {
      if (!activeLayer) createLayer();
      activeLayer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
      activeLayer.ctx.drawImage(image, 0, 0, container.clientWidth, container.clientHeight);
      saveHistory();
    };
    image.src = data;
  });
  galleryPanel.appendChild(img);
}

/* ====== UI 연결 ====== */
toggleLayersBtn.addEventListener('click', () => { layersPanel.classList.toggle('visible'); });
addLayerBtn.addEventListener('click', () => createLayer());
mergeLayerBtn.addEventListener('click', () => mergeActiveWithNeighbor());

/* ====== 이미지 삽입: overlay (pan/pinch/wheel/rotate) - 모바일 우선 개선 ====== */
imageInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => openImageOverlay(img);
  img.src = URL.createObjectURL(file);
  imageInput.value = '';
});

function openImageOverlay(image) {
  // wrapper above everything
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = '100vw';
  wrapper.style.height = '100vh';
  wrapper.style.zIndex = '100000'; // ensure above panels
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'stretch';
  wrapper.style.justifyContent = 'center';
  wrapper.style.pointerEvents = 'auto';
  // background to slightly darken - but keep pointer events for buttons
  wrapper.style.background = 'rgba(0,0,0,0.12)';
  document.body.appendChild(wrapper);

  // content container inside wrapper sized same as drawing container
  const inner = document.createElement('div');
  inner.style.position = 'relative';
  inner.style.width = container.clientWidth + 'px';
  inner.style.height = container.clientHeight + 'px';
  inner.style.marginTop = (toolbar ? toolbar.getBoundingClientRect().height : 0) + 'px';
  inner.style.touchAction = 'none';
  inner.style.display = 'flex';
  inner.style.alignItems = 'center';
  inner.style.justifyContent = 'center';
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

  // source canvas holds original image pixels
  const src = document.createElement('canvas');
  setCanvasSizeForDisplay(src, image.width, image.height);
  src.getContext('2d').drawImage(image, 0, 0);

  // transform state
  let scale = Math.min(inner.clientWidth / image.width, inner.clientHeight / image.height, 1);
  let rotation = 0; // degrees
  let pos = { x: (inner.clientWidth - image.width * scale) / 2, y: (inner.clientHeight - image.height * scale) / 2 };

  // pointer multi-touch state
  const pointers = new Map();
  let prevMiddle = null;
  let prevDist = 0;
  let prevAngle = 0;

  function redrawOverlay() {
    const w = overlay.width / (window.devicePixelRatio || 1);
    const h = overlay.height / (window.devicePixelRatio || 1);
    octx.clearRect(0, 0, w, h);
    octx.save();
    octx.translate(pos.x + (image.width * scale) / 2, pos.y + (image.height * scale) / 2);
    octx.rotate(rotation * Math.PI / 180);
    octx.drawImage(src, - (image.width * scale) / 2, - (image.height * scale) / 2, image.width * scale, image.height * scale);
    octx.restore();
  }
  redrawOverlay();

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
      redrawOverlay();
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
      redrawOverlay();
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

  // wheel zoom (desktop)
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
    redrawOverlay();
  }, { passive: false });

  // actions panel (always above layersPanel)
  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  actions.style.position = 'absolute';
  actions.style.bottom = '16px';
  actions.style.left = '50%';
  actions.style.transform = 'translateX(-50%)';
  actions.style.zIndex = '100001';
  actions.style.pointerEvents = 'auto';
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
    scale = Math.min(scale * 1.2, 20);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale));
    pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redrawOverlay();
  });
  zoomOutBtn_local.addEventListener('click', () => {
    const rect = overlay.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const oldScale = scale;
    scale = Math.max(scale * 0.85, 0.05);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale));
    pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redrawOverlay();
  });
  rotL.addEventListener('click', () => { rotation -= 15; redrawOverlay(); });
  rotR.addEventListener('click', () => { rotation += 15; redrawOverlay(); });

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

  // ensure overlay initially drawn and centered
  redrawOverlay();
}

/* ====== 단축키 ====== */
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoBtn.click(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redoBtn.click(); }
});

/* ====== 초기 레이어 보장 및 초기 UI 업데이트 ====== */
if (layers.length === 0) createLayer('Layer 1');
updateLayersPanel();
drawLayers();
