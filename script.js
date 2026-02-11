/* 파일명: script.js
   전체 통합본 — 모바일/PC 모두 대응, 기존 기능(브러시1-20, 컬러, 페인트통, 지우개, undo/redo,
   레이어 추가/삭제/이동/합체/밝기, 갤러리, 저장, 이미지 삽입(이동/핀치/휠 줌/회전)/확인/취소) 그대로 유지.
   요약 없음, 코드 전체 제공.
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

/* ===== 상태 ===== */
let layers = []; // { canvas, ctx, name, brightness, visible }
let activeLayer = null;
let history = [];
let redoStack = [];
let usingEraser = false;

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

/* ===== 레이아웃/컨테이너 크기 (모바일 우선) ===== */
function updateContainerSize() {
  const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
  const w = window.innerWidth;
  const h = Math.max(100, window.innerHeight - toolbarHeight);
  container.style.width = w + 'px';
  container.style.height = h + 'px';
}

/* ===== 브러시 옵션 초기화 (1~20) ===== */
for (let i = 1; i <= 20; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  brushSelect.appendChild(opt);
}
brushSelect.value = 5;

/* ===== 초기화 이벤트 ===== */
window.addEventListener('load', () => {
  updateContainerSize();
  if (!layers.length) createLayer('Layer 1');
  resizeAllCanvases();
  updateLayersPanel();
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => { updateContainerSize(); resizeAllCanvases(); }, 120);
});
window.addEventListener('resize', () => { updateContainerSize(); resizeAllCanvases(); });

/* ===== 캔버스 리사이즈 (내용 보존) ===== */
function resizeAllCanvases() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer => {
    // Preserve current content
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tmp.getContext('2d').drawImage(layer.canvas, 0, 0);
    // Resize and restore
    const ctx = setCanvasSizeForDisplay(layer.canvas, w, h);
    try {
      ctx.clearRect(0, 0, w, h);
      const ratio = window.devicePixelRatio || 1;
      ctx.drawImage(tmp, 0, 0, tmp.width / ratio, tmp.height / ratio, 0, 0, w, h);
    } catch (e) {
      ctx.clearRect(0, 0, w, h);
    }
  });
}

/* ===== 레이어 관련 ===== */
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

function drawLayers() {
  layers.forEach(layer => {
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    layer.canvas.style.filter = `brightness(${layer.brightness})`;
  });
}

/* ===== 레이어 패널 UI 업데이트 ===== */
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
    const visBtn = document.createElement('button');
    visBtn.textContent = layer.visible ? '👁' : '🚫';
    const upBtn = document.createElement('button');
    upBtn.textContent = '⬆️';
    const downBtn = document.createElement('button');
    downBtn.textContent = '⬇️';
    const delBtn = document.createElement('button');
    delBtn.textContent = '❌';
    controls.appendChild(visBtn);
    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(delBtn);

    item.appendChild(name);
    item.appendChild(range);
    item.appendChild(controls);

    item.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      activeLayer = layer;
      updateLayersPanel();
    });

    range.addEventListener('input', () => {
      layer.brightness = parseFloat(range.value);
      drawLayers();
    });

    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      visBtn.textContent = layer.visible ? '👁' : '🚫';
      drawLayers();
      saveHistory();
    });

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteLayer(layer);
    });

    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, +1); });
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(layer, -1); });

    layersPanel.appendChild(item);
  }
}

/* ===== 히스토리 저장/복원 ===== */
function saveHistory() {
  if (!activeLayer) return;
  try {
    const data = activeLayer.canvas.toDataURL('image/png');
    const idx = layers.indexOf(activeLayer);
    history.push({ layerIndex: idx, dataUrl: data });
    if (history.length > 200) history.shift();
    redoStack = [];
  } catch (e) {
    // ignore if toDataURL fails
  }
}

function restoreSnapshot(snapshot) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const layer = layers[snapshot.layerIndex];
      if (!layer) return resolve();
      layer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
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

/* ===== 도구: 페인트통, 지우개 ===== */
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

/* ===== 그리기 이벤트 (Pointer Events 통합) ===== */
function attachDrawingEvents(canvas) {
  let drawing = false;
  let pointerId = null;
  let last = { x: 0, y: 0 };

  function toCanvasPos(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function onPointerDown(e) {
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

  function onPointerMove(e) {
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

  function onPointerUp(e) {
    if (e.pointerId !== pointerId) return;
    canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId);
    pointerId = null;
    drawing = false;
    saveHistory();
  }

  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', (e) => { if (drawing && e.pointerId === pointerId) onPointerUp(e); });
}

/* ===== 저장 / 갤러리 ===== */
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
  addGalleryThumbnail(data);
});

function addGalleryThumbnail(dataUrl) {
  const img = document.createElement('img');
  img.src = dataUrl;
  img.className = 'gallery-item';
  img.title = '불러오기';
  img.addEventListener('click', () => {
    const image = new Image();
    image.onload = () => {
      if (!activeLayer) createLayer('Layer ' + (layers.length + 1));
      activeLayer.ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
      activeLayer.ctx.drawImage(image, 0, 0, container.clientWidth, container.clientHeight);
      saveHistory();
    };
    image.src = dataUrl;
  });
  galleryPanel.appendChild(img);
}

/* ===== UI 연결 ===== */
toggleLayersBtn.addEventListener('click', () => { layersPanel.classList.toggle('visible'); });
addLayerBtn.addEventListener('click', () => createLayer());
mergeLayerBtn.addEventListener('click', () => mergeActiveWithNeighbor());

/* ===== 이미지 삽입 (overlay) =====
   - wrapper appended to document.body with very high z-index so buttons always clickable
   - pointer events for pan/pinch/rotate, wheel zoom for desktop
   - action buttons: zoom in/out, rotate left/right, confirm, cancel
   - while overlay active, container pointer-events left intact but wrapper sits above UI
*/
imageInput.addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => openImageOverlay(img);
  img.src = URL.createObjectURL(f);
  imageInput.value = '';
});

function openImageOverlay(image) {
  // wrapper covers viewport to ensure buttons above panels & canvas
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = '100vw';
  wrapper.style.height = '100vh';
  wrapper.style.zIndex = '2147483000'; // very high
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.background = 'rgba(0,0,0,0.12)';
  wrapper.style.touchAction = 'none';
  document.body.appendChild(wrapper);

  // inner area matches container size for consistent coordinates
  const inner = document.createElement('div');
  inner.style.position = 'relative';
  inner.style.width = container.clientWidth + 'px';
  inner.style.height = container.clientHeight + 'px';
  inner.style.touchAction = 'none';
  wrapper.appendChild(inner);

  // overlay canvas inside inner
  const overlay = document.createElement('canvas');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.touchAction = 'none';
  inner.appendChild(overlay);
  const octx = setCanvasSizeForDisplay(overlay, inner.clientWidth, inner.clientHeight);

  // source canvas at image natural size
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

  // wheel zoom on desktop
  overlay.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.12 : 0.88;
    const oldScale = scale;
    scale = Math.max(0.05, Math.min(scale * factor, 20));
    pos.x = mx - ((mx - pos.x) * (scale / oldScale));
    pos.y = my - ((my - pos.y) * (scale / oldScale));
    redraw();
  }, { passive: false });

  // actions panel
  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  actions.style.position = 'absolute';
  actions.style.bottom = '16px';
  actions.style.left = '50%';
  actions.style.transform = 'translateX(-50%)';
  actions.style.zIndex = '2147483001';
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
    scale = Math.min(scale * 1.2, 20);
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
      overlay.removeEventListener('pointercancel', onPointerUp);
    } catch (e) { }
    if (wrapper.parentElement) document.body.removeChild(wrapper);
  }

  // ensure initial draw
  redraw();
}

/* ===== 단축키 ===== */
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoBtn.click(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redoBtn.click(); }
});

/* ===== 보장: 최소 1 레이어, 초기 UI 업데이트 ===== */
if (layers.length === 0) createLayer('Layer 1');
updateLayersPanel();
drawLayers();
