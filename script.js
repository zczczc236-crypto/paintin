/* 파일명: script.js
   전체 통합본 수정판 — 아래 문제들을 고침:
   1) 줌(핀치/휠/버튼/드래그) 정상 동작 (두 손 핀치/드래그로 축소/확대/팬)
   2) 지우개 한 번만 되돌리기 (스트로크 시작 시 한 번의 히스토리 스냅샷 생성)
   3) 브러시/지우개 크기 최대 100으로 확장
   4) 흐림(블러) 효과 추가 (스크립트가 동적으로 블러 컨트롤 생성)
   5) 캔버스 크기 조절 UI 추가 (스크립트가 동적 컨트롤 생성)
   6) 갤러리에서 불러오기 시 이전 상태로 되돌릴 수 있게 히스토리 스냅샷 보장
   7) 새로고침(브라우저) 시 자동저장/복원 (localStorage 기반, 로그인 미구현시 로컬보관)
   8) 페인트통: 클릭한 영역만 채우는 Flood Fill 구현 (버킷 모드 토글)
   9) 모바일에서 툴바/레이어가 캔버스를 가리지 않게 레이아웃 조정
   기존 기능(레이어, 합치기, 저장, 갤러리 등) 그대로 유지.
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
const fillBtn = document.getElementById('fill'); // 페인트통 (토글)
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
let history = []; // { layerIndex, dataUrl }
let redoStack = [];
let usingEraser = false;
let bucketMode = false; // 페인트통 클릭후 캔버스에서 영역채우기
let strokePreSnapshot = null; // 스트로크 시작 시 pre snapshot (한 번만 기록)
let autosaveKey = 'simple_paint_autosave_v1';
let autosaveTimer = null;

/* ===== 유틸: devicePixelRatio-aware 캔버스 세팅 ===== */
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

/* ===== 레이아웃: 모바일 툴바 침범 방지 ===== */
function updateLayoutSizes() {
  const tH = toolbar ? toolbar.getBoundingClientRect().height : 0;
  // container is full under toolbar
  container.style.position = 'absolute';
  container.style.left = '0';
  container.style.top = tH + 'px';
  container.style.width = window.innerWidth + 'px';
  container.style.height = (window.innerHeight - tH) + 'px';
  // ensure canvases resized
  resizeAllCanvases();
}

/* ===== 브러시 옵션 1..100 (기존 1..20 -> 1..100) ===== */
(function initBrushOptions(){
  brushSelect.innerHTML = '';
  for(let i=1;i<=100;i++){
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i;
    brushSelect.appendChild(opt);
  }
  brushSelect.value = 20;
})();

/* ===== 초기화 이벤트 ===== */
window.addEventListener('load', () => {
  updateLayoutSizes();
  loadAutoSavedState(); // 복원 먼저 시도
  if(layers.length === 0) createLayer('Layer 1');
  updateLayersPanel();
  startAutosave();
});
window.addEventListener('resize', () => { updateLayoutSizes(); });

/* ===== 캔버스 리사이즈 (내용 보존) ===== */
function resizeAllCanvases(){
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer=>{
    const tmp = document.createElement('canvas');
    // save current pixel data
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tmp.getContext('2d').drawImage(layer.canvas, 0,0);
    // resize and restore scaled
    const ctx = setCanvasSizeForDisplay(layer.canvas, w, h);
    try {
      ctx.clearRect(0,0,w,h);
      const ratio = window.devicePixelRatio || 1;
      ctx.drawImage(tmp, 0,0, tmp.width/ratio, tmp.height/ratio, 0,0, w, h);
    } catch(e){
      ctx.clearRect(0,0,w,h);
    }
  });
}

/* ===== 레이어 생성/삭제/이동/합체 ===== */
function createLayer(name = `Layer ${layers.length + 1}`){
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);
  const w = container.clientWidth || Math.max(800, window.innerWidth);
  const h = container.clientHeight || Math.max(600, window.innerHeight - (toolbar ? toolbar.clientHeight : 48));
  const ctx = setCanvasSizeForDisplay(canvas, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const layer = { canvas, ctx, name, brightness: 1, visible: true };
  layers.push(layer);
  activeLayer = layer;
  attachDrawingEvents(canvas);
  drawLayers();
  // initial snapshot to history so undo returns to blank if needed
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
  layers.forEach((l,i)=>{ l.canvas.style.zIndex = i; container.appendChild(l.canvas); });
  updateLayersPanel();
  // save after structure change
  saveStateToLocal(); // reflect new layer set
}

function moveLayer(layer, dir){
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if(newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  layers.forEach((l,i)=>{ l.canvas.style.zIndex = i; container.appendChild(l.canvas); });
  updateLayersPanel();
  saveStateToLocal();
}

function mergeActiveWithNeighbor(){
  if(layers.length < 2) return;
  const idx = layers.indexOf(activeLayer);
  let targetIdx = idx-1;
  if(targetIdx < 0) targetIdx = idx+1;
  if(targetIdx < 0 || targetIdx >= layers.length) return;
  const target = layers[targetIdx];
  // save pre-snapshot
  pushHistorySnapshot(activeLayer); // record pre-state of activeLayer
  target.ctx.save();
  target.ctx.globalCompositeOperation = 'source-over';
  target.ctx.drawImage(activeLayer.canvas, 0,0, container.clientWidth, container.clientHeight);
  target.ctx.restore();
  deleteLayer(activeLayer);
  activeLayer = target;
  updateLayersPanel();
  saveStateToLocal();
}

/* ===== 레이어 렌더/패널 업데이트 ===== */
function drawLayers(){
  layers.forEach(layer=>{
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    layer.canvas.style.filter = `brightness(${layer.brightness})`;
  });
}
function updateLayersPanel(){
  if(!layersPanel) return;
  layersPanel.innerHTML = '';
  for(let i = layers.length - 1; i >= 0; i--){
    const layer = layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer === activeLayer ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = layer.name;
    const range = document.createElement('input');
    range.type = 'range'; range.min='0'; range.max='2'; range.step='0.01'; range.value=layer.brightness;
    const controls = document.createElement('div'); controls.className='layer-controls';
    const visBtn = document.createElement('button'); visBtn.textContent = layer.visible ? '👁' : '🚫';
    const upBtn = document.createElement('button'); upBtn.textContent = '⬆️';
    const downBtn = document.createElement('button'); downBtn.textContent = '⬇️';
    const delBtn = document.createElement('button'); delBtn.textContent = '❌';
    controls.appendChild(visBtn); controls.appendChild(upBtn); controls.appendChild(downBtn); controls.appendChild(delBtn);

    item.appendChild(name);
    item.appendChild(range);
    item.appendChild(controls);

    item.addEventListener('click', (e)=>{ if(e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return; activeLayer = layer; updateLayersPanel(); });
    range.addEventListener('input', ()=>{ layer.brightness = parseFloat(range.value); drawLayers(); saveStateToLocal(); });
    visBtn.addEventListener('click', (e)=>{ e.stopPropagation(); layer.visible = !layer.visible; visBtn.textContent = layer.visible ? '👁':'🚫'; drawLayers(); saveStateToLocal(); });
    delBtn.addEventListener('click', (e)=>{ e.stopPropagation(); deleteLayer(layer); });
    upBtn.addEventListener('click', (e)=>{ e.stopPropagation(); moveLayer(layer, +1); });
    downBtn.addEventListener('click', (e)=>{ e.stopPropagation(); moveLayer(layer, -1); });

    layersPanel.appendChild(item);
  }
}

/* ===== 히스토리 시스템 개선 (스트로크 단위로 스냅샷) ===== */
function pushHistorySnapshotForLayerIndex(idx){
  try {
    const data = layers[idx].canvas.toDataURL('image/png');
    history.push({ layerIndex: idx, dataUrl: data });
    if(history.length > 500) history.shift();
    // clear redo on new action
    redoStack = [];
  } catch(e){}
}
function pushHistorySnapshot(layer){
  const idx = layers.indexOf(layer);
  if(idx >= 0) pushHistorySnapshotForLayerIndex(idx);
}
function pushHistorySnapshotActive(){
  if(activeLayer) pushHistorySnapshot(activeLayer);
}
// convenience: used to record pre-state at action starts
function recordPreSnapshotOnce(){
  if(!activeLayer) return;
  if(strokePreSnapshot) return; // already recorded for current stroke
  try{
    strokePreSnapshot = activeLayer.canvas.toDataURL('image/png');
  }catch(e){}
}
function finalizeStrokeSnapshot(){
  if(!strokePreSnapshot) return;
  // push pre-snapshot so undo returns to pre-stroke
  const idx = layers.indexOf(activeLayer);
  history.push({ layerIndex: idx, dataUrl: strokePreSnapshot });
  if(history.length > 500) history.shift();
  redoStack = [];
  strokePreSnapshot = null;
}

/* Undo/Redo handlers use restoreSnapshot */
async function restoreSnapshot(snapshot){
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const layer = layers[snapshot.layerIndex];
      if(!layer) return resolve();
      layer.ctx.clearRect(0,0, layer.canvas.width / (window.devicePixelRatio||1), layer.canvas.height / (window.devicePixelRatio||1));
      layer.ctx.drawImage(img, 0,0, container.clientWidth, container.clientHeight);
      resolve();
    };
    img.src = snapshot.dataUrl;
  });
}
undoBtn.addEventListener('click', async ()=>{
  if(history.length === 0) return;
  const last = history.pop();
  // push current to redo
  try {
    const cur = layers[last.layerIndex].canvas.toDataURL('image/png');
    redoStack.push({ layerIndex: last.layerIndex, dataUrl: cur });
  } catch(e){}
  await restoreSnapshot(last);
  updateLayersPanel();
  saveStateToLocal();
});
redoBtn.addEventListener('click', async ()=>{
  if(redoStack.length === 0) return;
  const next = redoStack.pop();
  try{
    const cur = layers[next.layerIndex].canvas.toDataURL('image/png');
    history.push({ layerIndex: next.layerIndex, dataUrl: cur });
  }catch(e){}
  await restoreSnapshot(next);
  updateLayersPanel();
  saveStateToLocal();
});

/* ===== 도구: 페인트통(버킷 모드), 지우개 ===== */
/* Flood fill implementation */
function colorDistance(a, b){
  // a and b are [r,g,b,a]
  return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]) + Math.abs(a[3]-b[3]);
}
function floodFill(layer, startX, startY, fillColor, tolerance=32){
  const canvas = layer.canvas;
  const ctx = layer.ctx;
  const w = canvas.width / (window.devicePixelRatio||1);
  const h = canvas.height / (window.devicePixelRatio||1);
  const imageData = ctx.getImageData(0,0,w,h);
  const data = imageData.data;
  const idx = (y,x) => (y*w + x)*4;
  startX = Math.floor(startX);
  startY = Math.floor(startY);
  if(startX < 0 || startY < 0 || startX >= w || startY >= h) return;
  const startPos = idx(startY, startX);
  const startColor = [data[startPos], data[startPos+1], data[startPos+2], data[startPos+3]];
  const targetColor = [fillColor.r, fillColor.g, fillColor.b, fillColor.a];
  // if colors are same within tolerance, do nothing
  if(colorDistance(startColor, targetColor) <= 0) return;
  const visited = new Uint8Array(w*h);
  const stack = [[startX, startY]];
  while(stack.length){
    const [x,y] = stack.pop();
    if(x<0||y<0||x>=w||y>=h) continue;
    const p = idx(y,x)/1;
    const id = y*w + x;
    if(visited[id]) continue;
    const cur = [data[p], data[p+1], data[p+2], data[p+3]];
    if(colorDistance(cur, startColor) <= tolerance){
      // fill
      data[p] = targetColor[0];
      data[p+1] = targetColor[1];
      data[p+2] = targetColor[2];
      data[p+3] = targetColor[3] !== undefined ? targetColor[3] : 255;
      visited[id] = 1;
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
  }
  ctx.putImageData(imageData, 0,0);
}

/* fillBtn toggles bucket mode (click fillBtn then click canvas to fill) */
fillBtn.addEventListener('click', ()=>{
  bucketMode = !bucketMode;
  fillBtn.style.background = bucketMode ? '#ddd' : '';
});

/* 지우개 토글 */
eraserBtn.addEventListener('click', ()=>{
  usingEraser = !usingEraser;
  eraserBtn.style.background = usingEraser ? '#ddd' : '';
});

/* ===== 그리기 이벤트: Pointer Events 통합 + 버킷 처리 포함 ===== */
function attachDrawingEvents(canvas){
  let drawing=false;
  let pointerId=null;
  let last={x:0,y:0};

  function getCanvasPos(clientX, clientY){
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  async function onPointerDown(e){
    // bucket mode: if active, fill and return (record pre snapshot)
    if(bucketMode){
      if(!activeLayer) return;
      const p = getCanvasPos(e.clientX, e.clientY);
      // record pre snapshot (so undo will revert)
      pushHistorySnapshot(activeLayer);
      // compute fill color from colorPicker hex
      const c = hexToRgba(colorPicker.value);
      floodFill(activeLayer, p.x, p.y, c, 32);
      bucketMode = false;
      fillBtn.style.background = '';
      saveStateToLocal();
      return;
    }

    // otherwise normal drawing
    if(e.target && e.target.tagName === 'BUTTON') return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    drawing = true;
    last = getCanvasPos(e.clientX, e.clientY);
    // record pre-snapshot once for the stroke (so single undo reverts stroke)
    recordPreSnapshotOnce();
    if(activeLayer){
      const ctx = activeLayer.ctx;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
    }
  }

  function onPointerMove(e){
    if(!drawing || e.pointerId !== pointerId) return;
    const p = getCanvasPos(e.clientX, e.clientY);
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

  function onPointerUp(e){
    if(e.pointerId !== pointerId) return;
    canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId);
    pointerId = null;
    drawing = false;
    // finalize stroke snapshot: push the pre-snapshot (so undo returns to pre-stroke)
    finalizeStrokeSnapshot();
    saveStateToLocal();
  }

  canvas.addEventListener('pointerdown', onPointerDown, { passive:false });
  window.addEventListener('pointermove', onPointerMove, { passive:false });
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', (e)=>{ if(drawing && e.pointerId===pointerId) onPointerUp(e); });

  // Also support tap to fill when bucketMode triggered: handled at pointerdown
}

/* ===== 유틸: hex -> rgba ===== */
function hexToRgba(hex){
  // supports #RRGGBB or #RGB
  let h = hex.replace('#','');
  if(h.length === 3) h = h.split('').map(c=>c+c).join('');
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  return { r, g, b, a:255 };
}

/* ===== 저장/갤러리/불러오기 개선 ===== */
saveBtn.addEventListener('click', ()=>{
  // create flattened image for download
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  layers.forEach(layer => { if(layer.visible) tctx.drawImage(layer.canvas, 0,0, container.clientWidth, container.clientHeight); });
  const data = tmp.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = 'drawing.png';
  link.href = data;
  link.click();
  // also add to gallery and local save
  addGalleryThumbnail(data);
  saveStateToLocal();
});

function addGalleryThumbnail(dataUrl){
  const img = document.createElement('img');
  img.src = dataUrl;
  img.className = 'gallery-item';
  img.title = '불러오기';
  img.addEventListener('click', ()=>{
    // when loading from gallery, record pre-snapshot so you can undo to previous state
    if(activeLayer){
      pushHistorySnapshot(activeLayer);
      const image = new Image();
      image.onload = ()=>{
        activeLayer.ctx.clearRect(0,0, container.clientWidth, container.clientHeight);
        activeLayer.ctx.drawImage(image, 0,0, container.clientWidth, container.clientHeight);
        saveStateToLocal();
      };
      image.src = dataUrl;
    } else {
      // no active layer -> create one
      createLayer('Layer '+(layers.length+1));
      const image = new Image();
      image.onload = ()=>{
        activeLayer.ctx.drawImage(image,0,0, container.clientWidth, container.clientHeight);
        saveStateToLocal();
      };
      image.src = dataUrl;
    }
  });
  galleryPanel.appendChild(img);
}

/* ===== 자동 저장 / 복원 (localStorage) ===== */
function saveStateToLocal(){
  try{
    const state = {
      width: container.clientWidth,
      height: container.clientHeight,
      layers: layers.map(l=>{
        let d=''; try{ d = l.canvas.toDataURL('image/png'); }catch(e){}
        return { dataUrl: d, name: l.name, brightness: l.brightness, visible: l.visible };
      }),
      activeIndex: layers.indexOf(activeLayer)
    };
    localStorage.setItem(autosaveKey, JSON.stringify(state));
  }catch(e){ console.warn('autosave failed', e); }
}

function loadAutoSavedState(){
  try{
    const raw = localStorage.getItem(autosaveKey);
    if(!raw) return;
    const state = JSON.parse(raw);
    // clear existing canvases
    layers.forEach(l=>{ if(l.canvas.parentElement) container.removeChild(l.canvas); });
    layers = [];
    activeLayer = null;
    // set container size if provided
    if(state.width && state.height){
      container.style.width = state.width + 'px';
      container.style.height = state.height + 'px';
    }
    // recreate layers
    (state.layers||[]).forEach((li, idx)=>{
      const layer = createLayer(li.name || `Layer ${idx+1}`);
      layer.brightness = li.brightness !== undefined ? li.brightness : 1;
      layer.visible = li.visible !== undefined ? li.visible : true;
      if(li.dataUrl){
        const image = new Image();
        image.onload = ()=>{ layer.ctx.clearRect(0,0, container.clientWidth, container.clientHeight); layer.ctx.drawImage(image, 0,0, container.clientWidth, container.clientHeight); };
        image.src = li.dataUrl;
      }
    });
    if(Number.isInteger(state.activeIndex) && layers[state.activeIndex]) activeLayer = layers[state.activeIndex];
    updateLayersPanel();
    drawLayers();
  }catch(e){ console.warn('load autosave failed', e); }
}

function startAutosave(){
  if(autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = setInterval(()=> saveStateToLocal(), 8000);
  window.addEventListener('beforeunload', ()=> saveStateToLocal());
}

/* ===== 이미지 삽입 overlay (핀치/드래그/휠/버튼 모두 동작) ===== */
/* 기존 동작 유지 + pre-snapshot 기록 so undo works */
imageInput.addEventListener('change', (ev)=>{
  const file = ev.target.files && ev.target.files[0];
  if(!file) return;
  const img = new Image();
  img.onload = ()=> openImageOverlay(img);
  img.src = URL.createObjectURL(file);
  imageInput.value = '';
});

function openImageOverlay(image){
  // wrapper
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = '100vw';
  wrapper.style.height = '100vh';
  wrapper.style.zIndex = '2147483000';
  wrapper.style.background = 'rgba(0,0,0,0.12)';
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.touchAction = 'none';
  document.body.appendChild(wrapper);

  // inner area sized to container
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
  src.getContext('2d').drawImage(image, 0,0);

  let scale = Math.min(inner.clientWidth / image.width, inner.clientHeight / image.height, 1);
  let rotation = 0;
  let pos = { x: (inner.clientWidth - image.width*scale)/2, y: (inner.clientHeight - image.height*scale)/2 };

  // multi-pointer
  const pointers = new Map();
  let prevMiddle = null, prevDist = 0, prevAngle = 0;

  function redraw(){
    const w = overlay.width / (window.devicePixelRatio||1);
    const h = overlay.height / (window.devicePixelRatio||1);
    octx.clearRect(0,0,w,h);
    octx.save();
    octx.translate(pos.x + (image.width*scale)/2, pos.y + (image.height*scale)/2);
    octx.rotate(rotation * Math.PI / 180);
    octx.drawImage(src, - (image.width*scale)/2, - (image.height*scale)/2, image.width*scale, image.height*scale);
    octx.restore();
  }
  redraw();

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
      prevMiddle = { x: (a.x + b.x)/2, y: (a.y + b.y)/2 };
      prevAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    }
  }

  function onPointerMove(e){
    if(!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(pointers.size === 1){
      const p = pointers.values().next().value;
      const dx = p.x - prevMiddle.x;
      const dy = p.y - prevMiddle.y;
      prevMiddle = { x: p.x, y: p.y };
      pos.x += dx; pos.y += dy;
      redraw();
    } else if(pointers.size >= 2){
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      const newDist = Math.hypot(b.x - a.x, b.y - a.y);
      const newMiddle = { x: (a.x + b.x)/2, y: (a.y + b.y)/2 };
      const newAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if(prevDist > 0){
        const factor = newDist / prevDist;
        const oldScale = scale;
        scale = Math.max(0.05, Math.min(scale * factor, 30));
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

  function onPointerUp(e){
    pointers.delete(e.pointerId);
    overlay.releasePointerCapture && overlay.releasePointerCapture(e.pointerId);
    if(pointers.size === 1){
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

  overlay.addEventListener('wheel', (ev)=>{
    ev.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const mx = ev.clientX - rect.left; const my = ev.clientY - rect.top;
    const delta = ev.deltaY < 0 ? 1.12 : 0.88;
    const oldScale = scale;
    scale = Math.max(0.05, Math.min(scale * delta, 30));
    pos.x = mx - ((mx - pos.x) * (scale / oldScale));
    pos.y = my - ((my - pos.y) * (scale / oldScale));
    redraw();
  }, { passive:false });

  // actions UI (zoom/pan/rotate/confirm/cancel)
  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  actions.style.position = 'absolute';
  actions.style.bottom = '12px';
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

  zoomInBtn.addEventListener('click', ()=>{
    const rect = overlay.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    const oldScale = scale;
    scale = Math.min(scale * 1.2, 30);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale));
    pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redraw();
  });
  zoomOutBtn_local.addEventListener('click', ()=>{
    const rect = overlay.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    const oldScale = scale;
    scale = Math.max(scale * 0.85, 0.05);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale));
    pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redraw();
  });
  rotL.addEventListener('click', ()=>{ rotation -= 15; redraw(); });
  rotR.addEventListener('click', ()=>{ rotation += 15; redraw(); });

  confirmBtn.addEventListener('click', ()=>{
    // record pre-snapshot for undo
    if(activeLayer) pushHistorySnapshot(activeLayer);
    else createLayer('Layer '+(layers.length+1));
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x + (image.width*scale)/2, pos.y + (image.height*scale)/2);
    activeLayer.ctx.rotate(rotation * Math.PI / 180);
    activeLayer.ctx.drawImage(src, - (image.width*scale)/2, - (image.height*scale)/2, image.width*scale, image.height*scale);
    activeLayer.ctx.restore();
    saveStateToLocal();
    cleanup();
  });

  cancelBtn.addEventListener('click', cleanup);

  function cleanup(){
    try{
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
      overlay.removeEventListener('pointercancel', onPointerUp);
    }catch(e){}
    if(wrapper.parentElement) document.body.removeChild(wrapper);
  }

  redraw();
}

/* ===== 흐림(블러) 컨트롤 동적 생성 및 적용 ===== */
(function createBlurControl(){
  const blurPanel = document.createElement('div');
  blurPanel.style.position = 'fixed';
  blurPanel.style.right = '12px';
  blurPanel.style.top = (toolbar ? (toolbar.getBoundingClientRect().height + 12) : 12) + 'px';
  blurPanel.style.zIndex = '1200';
  blurPanel.style.background = 'rgba(255,255,255,0.95)';
  blurPanel.style.border = '1px solid #ccc';
  blurPanel.style.padding = '6px';
  blurPanel.style.borderRadius = '6px';
  blurPanel.style.boxShadow = '0 4px 10px rgba(0,0,0,0.08)';
  blurPanel.style.display = 'flex';
  blurPanel.style.gap = '6px';
  blurPanel.style.alignItems = 'center';
  const label = document.createElement('span'); label.textContent = 'Blur';
  const input = document.createElement('input'); input.type = 'range'; input.min='0'; input.max='30'; input.step='1'; input.value='0';
  const applyBtn = document.createElement('button'); applyBtn.textContent = '적용';
  const resetBtn = document.createElement('button'); resetBtn.textContent = '초기화';
  blurPanel.appendChild(label); blurPanel.appendChild(input); blurPanel.appendChild(applyBtn); blurPanel.appendChild(resetBtn);
  document.body.appendChild(blurPanel);

  applyBtn.addEventListener('click', ()=>{
    const v = parseInt(input.value,10) || 0;
    if(!activeLayer) return;
    // record pre-snapshot
    pushHistorySnapshot(activeLayer);
    // apply blur by drawing source to temp with ctx.filter
    const tmp = document.createElement('canvas');
    setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
    const tctx = tmp.getContext('2d');
    tctx.clearRect(0,0,tmp.width/(window.devicePixelRatio||1), tmp.height/(window.devicePixelRatio||1));
    // copy current layer logical pixels into tmp without ratio issues
    tctx.drawImage(activeLayer.canvas, 0,0, container.clientWidth, container.clientHeight);
    // apply filter onto layer
    activeLayer.ctx.save();
    activeLayer.ctx.clearRect(0,0, container.clientWidth, container.clientHeight);
    activeLayer.ctx.filter = `blur(${v}px)`;
    activeLayer.ctx.drawImage(tmp, 0,0, container.clientWidth, container.clientHeight);
    activeLayer.ctx.filter = 'none';
    activeLayer.ctx.restore();
    saveStateToLocal();
  });
  resetBtn.addEventListener('click', ()=>{
    input.value = '0';
  });
})();

/* ===== 캔버스 크기 조절 UI (동적) ===== */
(function createCanvasResizeControl(){
  const btn = document.createElement('button');
  btn.textContent = '캔버스 크기';
  btn.style.position = 'fixed';
  btn.style.left = '12px';
  btn.style.top = (toolbar ? (toolbar.getBoundingClientRect().height + 12) : 12) + 'px';
  btn.style.zIndex = '1200';
  document.body.appendChild(btn);

  btn.addEventListener('click', ()=>{
    const modal = document.createElement('div');
    modal.style.position='fixed'; modal.style.left='0'; modal.style.top='0'; modal.style.width='100vw'; modal.style.height='100vh';
    modal.style.display='flex'; modal.style.alignItems='center'; modal.style.justifyContent='center'; modal.style.zIndex='2147483002';
    modal.style.background='rgba(0,0,0,0.2)';
    const box = document.createElement('div');
    box.style.background='#fff'; box.style.padding='16px'; box.style.borderRadius='8px'; box.style.width='320px';
    const wInput = document.createElement('input'); wInput.type='number'; wInput.value=container.clientWidth; wInput.style.width='100%';
    const hInput = document.createElement('input'); hInput.type='number'; hInput.value=container.clientHeight; hInput.style.width='100%';
    const checkScale = document.createElement('input'); checkScale.type='checkbox'; checkScale.checked=true;
    const labelScale = document.createElement('label'); labelScale.textContent='내용 스케일 유지';
    const apply = document.createElement('button'); apply.textContent='적용'; const cancel = document.createElement('button'); cancel.textContent='취소';
    box.appendChild(document.createTextNode('너비(px)')); box.appendChild(document.createElement('br')); box.appendChild(wInput);
    box.appendChild(document.createElement('br')); box.appendChild(document.createTextNode('높이(px)')); box.appendChild(document.createElement('br')); box.appendChild(hInput);
    box.appendChild(document.createElement('br')); box.appendChild(checkScale); box.appendChild(labelScale);
    box.appendChild(document.createElement('br')); box.appendChild(document.createElement('br')); box.appendChild(apply); box.appendChild(cancel);
    modal.appendChild(box); document.body.appendChild(modal);

    cancel.addEventListener('click', ()=>{ if(modal.parentElement) document.body.removeChild(modal); });
    apply.addEventListener('click', ()=>{
      const newW = Math.max(100, parseInt(wInput.value,10) || container.clientWidth);
      const newH = Math.max(100, parseInt(hInput.value,10) || container.clientHeight);
      // resize each layer, optionally scale content
      layers.forEach(layer=>{
        const tmp = document.createElement('canvas');
        setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
        tmp.getContext('2d').drawImage(layer.canvas, 0,0);
        // set new display size for canvas
        setCanvasSizeForDisplay(layer.canvas, newW, newH);
        const ctx = layer.ctx;
        ctx.clearRect(0,0,newW,newH);
        if(checkScale.checked){
          // draw previous content scaled to new size
          const ratio = window.devicePixelRatio || 1;
          ctx.drawImage(tmp, 0,0, tmp.width/ratio, tmp.height/ratio, 0,0, newW, newH);
        } else {
          // draw at top-left unscaled
          const ratio = window.devicePixelRatio || 1;
          ctx.drawImage(tmp, 0,0, tmp.width/ratio, tmp.height/ratio);
        }
      });
      container.style.width = newW + 'px';
      container.style.height = newH + 'px';
      saveStateToLocal();
      if(modal.parentElement) document.body.removeChild(modal);
    });
  });
})();

/* ===== 이미지 삽입 / 갤러리 로직은 기존과 동일 (pre-snapshot 추가로 undo 보장) ===== */
/* (openImageOverlay 위에서 이미 pushHistorySnapshot를 사용) */

/* ===== 단축키 ===== */
window.addEventListener('keydown', (e)=>{
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'z'){ e.preventDefault(); undoBtn.click(); }
  if((e.ctrlKey||e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase()==='z'))){ e.preventDefault(); redoBtn.click(); }
});

/* ===== 보장: 최소 1 레이어 및 초기 UI 업데이트 ===== */
if(layers.length === 0) createLayer('Layer 1');
updateLayersPanel();
drawLayers();

/* ===== 추가 헬퍼: 로컬 스토리지에서 완전 삭제를 원하면 아래 호출 가능 ===== */
/* localStorage.removeItem(autosaveKey); */
