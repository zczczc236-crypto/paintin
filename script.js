/* ====== 전역 DOM ====== */
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

/* ====== 고해상도 캔버스 지원 함수 ====== */
function setCanvasSizeForDisplay(canvas, width, height){
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return ctx;
}

/* ====== 브러시 옵션 초기화 ====== */
for(let i=1;i<=20;i++){
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  brushSelect.appendChild(opt);
}
brushSelect.value = 5;

/* ====== 초기화 이벤트 ====== */
window.addEventListener('load', () => {
  createLayer('Layer 1');
  resizeAllCanvases();
  updateLayersPanel();
});
window.addEventListener('resize', () => {
  resizeAllCanvases();
});

/* ====== 캔버스/레이어 유틸 ====== */
function resizeAllCanvases(){
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer => {
    // 보존
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(layer.canvas, 0, 0);
    // set new size
    setCanvasSizeForDisplay(layer.canvas, w, h);
    // restore stretched
    layer.ctx.drawImage(tmp, 0, 0, tmp.width / (window.devicePixelRatio||1), tmp.height / (window.devicePixelRatio||1), 0, 0, w, h);
  });
}

/* ====== 레이어 생성/조작 ====== */
function createLayer(name = `Layer ${layers.length + 1}`){
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 600;
  const ctx = setCanvasSizeForDisplay(canvas, w, h);
  canvas.style.zIndex = layers.length;
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);
  const layer = { canvas, ctx, name, brightness:1, visible:true };
  layers.push(layer);
  activeLayer = layer;
  attachDrawingEvents(canvas);
  drawLayers();
  saveHistory();
  updateLayersPanel();
  return layer;
}

function deleteLayer(layer){
  if(layers.length <= 1) return;
  const idx = layers.indexOf(layer);
  layers.splice(idx,1);
  if(layer.canvas.parentElement) container.removeChild(layer.canvas);
  if(activeLayer === layer) activeLayer = layers[layers.length - 1];
  layers.forEach((l,i)=> { l.canvas.style.zIndex = i; if(l.canvas.parentElement) container.appendChild(l.canvas); });
  updateLayersPanel();
  saveHistory();
}

function moveLayer(layer, dir){
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if(newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  layers.forEach((l,i)=> { l.canvas.style.zIndex = i; container.appendChild(l.canvas); });
  updateLayersPanel();
  saveHistory();
}

function mergeActiveWithNeighbor(){
  if(layers.length < 2) return;
  const idx = layers.indexOf(activeLayer);
  let targetIdx = idx - 1;
  if(targetIdx < 0) targetIdx = idx + 1;
  if(targetIdx < 0 || targetIdx >= layers.length) return;
  const target = layers[targetIdx];
  target.ctx.save();
  target.ctx.globalCompositeOperation = 'source-over';
  // draw active layer onto target (consider devicePixelRatio scaling already handled)
  target.ctx.drawImage(activeLayer.canvas, 0, 0, container.clientWidth, container.clientHeight);
  target.ctx.restore();
  deleteLayer(activeLayer);
  activeLayer = target;
  updateLayersPanel();
  saveHistory();
}

function drawLayers(){
  layers.forEach(layer => {
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    layer.canvas.style.filter = `brightness(${layer.brightness})`;
  });
}

function updateLayersPanel(){
  layersPanel.innerHTML = '';
  for(let i = layers.length - 1; i >= 0; i--){
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

    item.addEventListener('click', (e) => { if(e.target.tagName==='BUTTON' || e.target.tagName === 'INPUT') return; activeLayer = layer; updateLayersPanel(); });
    range.addEventListener('input', ()=>{ layer.brightness = parseFloat(range.value); drawLayers(); });
    visBtn.addEventListener('click', (e)=>{ e.stopPropagation(); layer.visible = !layer.visible; visBtn.textContent = layer.visible ? '👁' : '🚫'; drawLayers(); saveHistory(); });
    delBtn.addEventListener('click', (e)=>{ e.stopPropagation(); deleteLayer(layer); });
    upBtn.addEventListener('click', (e)=>{ e.stopPropagation(); moveLayer(layer, +1); });
    downBtn.addEventListener('click', (e)=>{ e.stopPropagation(); moveLayer(layer, -1); });

    layersPanel.appendChild(item);
  }
}

/* ====== 히스토리 (데이터URL 방식) ====== */
function saveHistory(){
  if(!activeLayer) return;
  try{
    const data = activeLayer.canvas.toDataURL('image/png');
    const idx = layers.indexOf(activeLayer);
    history.push({ layerIndex: idx, dataUrl: data });
    if(history.length > 200) history.shift();
    redoStack = [];
  }catch(e){ console.warn('saveHistory failed', e); }
}
async function restoreSnapshot(snapshot){
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const layer = layers[snapshot.layerIndex];
      if(!layer) return resolve();
      layer.ctx.clearRect(0,0, layer.canvas.width / (window.devicePixelRatio||1), layer.canvas.height / (window.devicePixelRatio||1));
      layer.ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
      resolve();
    };
    img.src = snapshot.dataUrl;
  });
}
undoBtn.addEventListener('click', async () => {
  if(history.length === 0) return;
  const last = history.pop();
  try {
    const current = layers[last.layerIndex].canvas.toDataURL('image/png');
    redoStack.push({ layerIndex: last.layerIndex, dataUrl: current });
  } catch(e){}
  await restoreSnapshot(last);
  updateLayersPanel();
});
redoBtn.addEventListener('click', async () => {
  if(redoStack.length === 0) return;
  const next = redoStack.pop();
  try {
    const current = layers[next.layerIndex].canvas.toDataURL('image/png');
    history.push({ layerIndex: next.layerIndex, dataUrl: current });
  } catch(e){}
  await restoreSnapshot(next);
  updateLayersPanel();
});

/* ====== 도구: 페인트통 / 지우개 ====== */
fillBtn.addEventListener('click', () => {
  if(!activeLayer) return;
  activeLayer.ctx.save();
  activeLayer.ctx.fillStyle = colorPicker.value;
  activeLayer.ctx.fillRect(0,0, container.clientWidth, container.clientHeight);
  activeLayer.ctx.restore();
  saveHistory();
});
eraserBtn.addEventListener('click', () => {
  usingEraser = !usingEraser;
  eraserBtn.style.background = usingEraser ? '#ddd' : '';
});

/* ====== 그리기: Pointer Events (모바일/마우스/펜 통합) ====== */
function attachDrawingEvents(canvas){
  let drawing = false;
  let pointerId = null;
  let last = {x:0,y:0};

  function toCanvasPos(clientX, clientY){
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }
  function onDown(e){
    if(e.target.tagName === 'BUTTON') return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    drawing = true;
    last = toCanvasPos(e.clientX, e.clientY);
    if(activeLayer){
      const ctx = activeLayer.ctx;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
    }
  }
  function onMove(e){
    if(!drawing || e.pointerId !== pointerId) return;
    const p = toCanvasPos(e.clientX, e.clientY);
    if(!activeLayer) return;
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
  function onUp(e){
    if(e.pointerId !== pointerId) return;
    canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId);
    pointerId = null;
    drawing = false;
    saveHistory();
  }

  canvas.addEventListener('pointerdown', onDown, { passive:false });
  window.addEventListener('pointermove', onMove, { passive:false });
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', (e)=>{ if(drawing && e.pointerId === pointerId) onUp(e); });
}

/* ====== 저장 / 갤러리 ====== */
saveBtn.addEventListener('click', ()=>{
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  layers.forEach(layer => { if(layer.visible) tctx.drawImage(layer.canvas, 0, 0, container.clientWidth, container.clientHeight); });
  const data = tmp.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = 'drawing.png';
  link.href = data;
  link.click();
  addGalleryImage(data);
});
function addGalleryImage(data){
  const img = document.createElement('img');
  img.src = data;
  img.className = 'gallery-item';
  img.addEventListener('click', ()=>{
    const image = new Image();
    image.onload = ()=>{ if(!activeLayer) createLayer(); activeLayer.ctx.clearRect(0,0, container.clientWidth, container.clientHeight); activeLayer.ctx.drawImage(image,0,0, container.clientWidth, container.clientHeight); saveHistory(); };
    image.src = data;
  });
  galleryPanel.appendChild(img);
}

/* ====== UI 버튼 연결 ====== */
toggleLayersBtn.addEventListener('click', ()=>{ layersPanel.classList.toggle('visible'); });
addLayerBtn.addEventListener('click', ()=> createLayer());
mergeLayerBtn.addEventListener('click', ()=> mergeActiveWithNeighbor());

/* ====== 이미지 삽입: overlay (pan + pinch zoom + wheel zoom + rotate) ====== */
imageInput.addEventListener('change', (e)=>{
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const img = new Image();
  img.onload = ()=> openImageOverlay(img);
  img.src = URL.createObjectURL(file);
  imageInput.value = '';
});

function openImageOverlay(image){
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  wrapper.style.zIndex = 6000;
  wrapper.style.pointerEvents = 'auto';
  container.appendChild(wrapper);

  const overlay = document.createElement('canvas');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.touchAction = 'none';
  wrapper.appendChild(overlay);
  const octx = setCanvasSizeForDisplay(overlay, container.clientWidth, container.clientHeight);

  // source canvas to draw image at natural pixels
  const src = document.createElement('canvas');
  setCanvasSizeForDisplay(src, image.width, image.height);
  const sctx = src.getContext('2d');
  sctx.drawImage(image, 0, 0, image.width, image.height);

  // transform state
  let scale = Math.min(container.clientWidth / image.width, container.clientHeight / image.height, 1);
  let rotation = 0; // degrees
  let pos = { x: (container.clientWidth - image.width * scale) / 2, y: (container.clientHeight - image.height * scale) / 2 };

  // multi-pointer state
  const pointers = new Map(); // id -> {x,y}
  let prevMiddle = null;
  let prevDist = 0;
  let prevAngle = 0;

  function redrawOverlay(){
    const w = overlay.width / (window.devicePixelRatio||1);
    const h = overlay.height / (window.devicePixelRatio||1);
    octx.clearRect(0,0, w, h);
    octx.save();
    octx.translate(pos.x + (image.width * scale) / 2, pos.y + (image.height * scale) / 2);
    octx.rotate(rotation * Math.PI / 180);
    octx.drawImage(src, - (image.width * scale) / 2, - (image.height * scale) / 2, image.width * scale, image.height * scale);
    octx.restore();
  }
  redrawOverlay();

  function getPointFromEvent(e){
    const rect = overlay.getBoundingClientRect();
    if(e.touches && e.touches.length > 0){
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // pointer-based multi-touch using pointer events
  function onPointerDown(e){
    if(e.button && e.button !== 0) return;
    overlay.setPointerCapture && overlay.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(pointers.size === 1){
      const p = pointers.values().next().value;
      prevMiddle = { x: p.x, y: p.y };
    } else if(pointers.size >= 2){
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      prevDist = Math.hypot(b.x - a.x, b.y - a.y);
      prevMiddle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      prevAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    }
  }
  function onPointerMove(e){
    if(!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(pointers.size === 1){
      // pan
      const p = pointers.values().next().value;
      const dx = p.x - prevMiddle.x;
      const dy = p.y - prevMiddle.y;
      prevMiddle = { x: p.x, y: p.y };
      pos.x += dx;
      pos.y += dy;
      redrawOverlay();
    } else if(pointers.size >= 2){
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      const newDist = Math.hypot(b.x - a.x, b.y - a.y);
      const newMiddle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const newAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;

      // compute scale change
      if(prevDist > 0){
        const factor = newDist / prevDist;
        const oldScale = scale;
        scale = Math.max(0.05, Math.min(scale * factor, 10));

        // zoom towards midpoint: adjust pos so midpoint stays at same screen position
        const rect = overlay.getBoundingClientRect();
        const mx = newMiddle.x - rect.left;
        const my = newMiddle.y - rect.top;
        pos.x = mx - ((mx - pos.x) * (scale / oldScale));
        pos.y = my - ((my - pos.y) * (scale / oldScale));
      }

      // rotation delta
      const deltaAngle = newAngle - prevAngle;
      rotation += deltaAngle;
      prevDist = newDist;
      prevAngle = newAngle;
      prevMiddle = newMiddle;
      redrawOverlay();
    }
  }
  function onPointerUp(e){
    pointers.delete(e.pointerId);
    overlay.releasePointerCapture && overlay.releasePointerCapture(e.pointerId);
    if(pointers.size === 1){
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
  overlay.addEventListener('pointerout', onPointerUp);
  overlay.addEventListener('pointerleave', onPointerUp);

  // wheel zoom towards mouse pointer
  overlay.addEventListener('wheel', (ev)=>{
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
  }, { passive:false });

  // overlay action buttons (confirm/cancel + +/- zoom buttons)
  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  actions.style.position = 'absolute';
  actions.style.bottom = '12px';
  actions.style.left = '50%';
  actions.style.transform = 'translateX(-50%)';
  actions.style.zIndex = '6100';
  wrapper.appendChild(actions);

  const zoomInBtn = document.createElement('button'); zoomInBtn.textContent = '+';
  const zoomOutBtn_local = document.createElement('button'); zoomOutBtn_local.textContent = '-';
  const rotL = document.createElement('button'); rotL.textContent = '⟲';
  const rotR = document.createElement('button'); rotR.textContent = '⟳';
  const confirmBtn = document.createElement('button'); confirmBtn.textContent = '✔';
  const cancelBtn = document.createElement('button'); cancelBtn.textContent = '✖';

  actions.appendChild(zoomOutBtn_local);
  actions.appendChild(zoomInBtn);
  actions.appendChild(rotL);
  actions.appendChild(rotR);
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  zoomInBtn.addEventListener('click', ()=>{
    const rect = overlay.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    const oldScale = scale;
    scale = Math.min(scale * 1.2, 20);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale));
    pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redrawOverlay();
  });
  zoomOutBtn_local.addEventListener('click', ()=>{
    const rect = overlay.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    const oldScale = scale;
    scale = Math.max(scale * 0.85, 0.05);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale));
    pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redrawOverlay();
  });
  rotL.addEventListener('click', ()=>{ rotation -= 15; redrawOverlay(); });
  rotR.addEventListener('click', ()=>{ rotation += 15; redrawOverlay(); });

  confirmBtn.addEventListener('click', ()=>{
    if(!activeLayer) createLayer();
    activeLayer.ctx.save();
    // draw overlay image onto active layer with same transform (note: activeLayer.ctx uses devicePixelRatio transform)
    // Use container coords to draw into existing layer coordinate system
    activeLayer.ctx.translate(pos.x + (image.width * scale) / 2, pos.y + (image.height * scale) / 2);
    activeLayer.ctx.rotate(rotation * Math.PI / 180);
    activeLayer.ctx.drawImage(src, - (image.width * scale) / 2, - (image.height * scale) / 2, image.width * scale, image.height * scale);
    activeLayer.ctx.restore();
    saveHistory();
    cleanup();
  });

  cancelBtn.addEventListener('click', cleanup);

  function cleanup(){
    try {
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
    } catch(e){}
    if(wrapper.parentElement) container.removeChild(wrapper);
  }

  // ensure overlay draws at start
  redrawOverlay();
}

/* ====== 단축키 ====== */
window.addEventListener('keydown',(e)=>{
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'z'){ e.preventDefault(); undoBtn.click(); }
  if((e.ctrlKey||e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase()==='z'))){ e.preventDefault(); redoBtn.click(); }
});

/* ====== 보장: 하나의 레이어 ====== */
if(layers.length === 0) createLayer('Layer 1');
updateLayersPanel();
drawLayers();
