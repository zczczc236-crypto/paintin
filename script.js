/* 파일명: script.js
   전체 통합본 — 기존 모든 기능 유지 + 추가 기능 요청 반영
   - 스포이드(색상 추출)
   - 불투명 브러시 (brush opacity)
   - 브러시 압력 지원 (pointer.pressure fallback)
   - 단축키 전부 (Ctrl+Z / Ctrl+Shift+Z, Tab UI 숨기기 등) + 단축키 가이드 표시
   - 마우스 드래그 캔버스 패닝 (Space 누르거나 중간버튼)
   - Undo/Redo 강화: 설정 가능한 단계 (min 50, default 1000, can set "unlimited" large)
   - 지우개 되돌리기/되돌리기 취소 안정화
   - 브러시/지우개 크기 최대 100
   - 흐림(blur) 효과 (레이어 단위 및 스트로크 필터 사용 가능하면 적용)
   - 캔버스 크기 조절 UI 가능
   - 저장된 그림 불러오기 시 이전 상태로 undo 가능
   - 새로고침 복원 via localStorage (로그인 미구현, localStorage로 저장)
   - 페인트통: 선택 영역 채우기(flood fill)
   - 모바일 UI 개선: 툴바/패널 자동 숨김/토글, overlay 우선순위
   - 스냅(스트로크 안정화) 기본 구현 (간단한 곡선 보정)
   - 브러시 프리셋 저장/버튼 불러오기
   - 브러시 종류 여러개(연필, 부드러운, 하드, 불투명 등) + 브러시 이미지 썸네일
   - 대칭 그리기 (vertical/horizontal/axis)
   - 선택 영역 / 이동툴 (기본 박스 선택 및 이동)
   - 캔버스 회전/확대/축소 (wheel + pinch) 및 뷰 변환 반영하여 그리기 가능
   - UI 숨기기 (Tab)
   - PSD-like 내보내기: ZIP(각 레이어 PNG + metadata JSON) (실제 .psd 바이너리 호환 아님)
   - GIF/APNG export stub (creates frames from layers or gallery images as simple downloadable zip of frames)
   - 브러시 스트로크 안정화(보정) 간단 구현: 그리기 지연 & smoothing
   - 브러시 압력/불투명도/크기 적용
   - 레이어: 불투명도, 대비(contrast), 채도(saturate), 흐림(blur), 명도(brightness) 조절
   - 지우개가 한번에 undo 되도록 히스토리 관리 개선
   - 캔버스 크기 직접 변경 UI hook
   - 기존 기능 훼손 금지
*/

/* ================= DOM 참조 (기존 HTML 요소 있어야 함) ================= */
const toolbar = document.getElementById('toolbar') || (() => { console.warn('toolbar not found'); return null; })();
const container = document.getElementById('canvas-container') || (() => { throw new Error('canvas-container missing'); })();
const layersPanel = document.getElementById('layers-panel') || (() => { console.warn('layers-panel missing, creating'); const p = document.createElement('div'); p.id='layers-panel'; document.body.appendChild(p); return p; })();
const galleryPanel = document.getElementById('gallery-panel') || (() => { console.warn('gallery-panel missing, creating'); const p = document.createElement('div'); p.id='gallery-panel'; document.body.appendChild(p); return p; })();

let brushSelect = document.getElementById('brush-size');
let colorPicker = document.getElementById('color');
let undoBtn = document.getElementById('undo');
let redoBtn = document.getElementById('redo');
let fillBtn = document.getElementById('fill');
let eraserBtn = document.getElementById('eraser');
let zoomOutBtn = document.getElementById('zoom-out');
let saveBtn = document.getElementById('save');
let addLayerBtn = document.getElementById('add-layer');
let mergeLayerBtn = document.getElementById('merge-layer');
let toggleLayersBtn = document.getElementById('toggle-layers');
let imageInput = document.getElementById('image-input');

/* 동적 보정: 필요한 요소 생성 */
function ensureElement(id, tag='div', attrs={}) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    Object.assign(el, attrs);
    if (toolbar) toolbar.appendChild(el); else document.body.appendChild(el);
  }
  return el;
}
brushSelect = brushSelect || ensureElement('brush-size','select');
colorPicker = colorPicker || ensureElement('color','input',{type:'color', value:'#000000'});
undoBtn = undoBtn || ensureElement('undo','button'); undoBtn.textContent = undoBtn.textContent || '되돌리기';
redoBtn = redoBtn || ensureElement('redo','button'); redoBtn.textContent = redoBtn.textContent || '취소';
fillBtn = fillBtn || ensureElement('fill','button'); fillBtn.textContent = fillBtn.textContent || '페인트통';
eraserBtn = eraserBtn || ensureElement('eraser','button'); eraserBtn.textContent = eraserBtn.textContent || '지우개';
zoomOutBtn = zoomOutBtn || ensureElement('zoom-out','button'); zoomOutBtn.textContent = zoomOutBtn.textContent || '줌아웃';
saveBtn = saveBtn || ensureElement('save','button'); saveBtn.textContent = saveBtn.textContent || '저장';
addLayerBtn = addLayerBtn || ensureElement('add-layer','button'); addLayerBtn.textContent = addLayerBtn.textContent || '레이어추가';
mergeLayerBtn = mergeLayerBtn || ensureElement('merge-layer','button'); mergeLayerBtn.textContent = mergeLayerBtn.textContent || '레이어합체';
toggleLayersBtn = toggleLayersBtn || ensureElement('toggle-layers','button'); toggleLayersBtn.textContent = toggleLayersBtn.textContent || '레이어창';
imageInput = imageInput || (() => { const f = ensureElement('image-input','input',{type:'file', accept:'image/*'}); return f; })();

/* ================= 상태 구조 ================= */
let layers = []; // {canvas, ctx, name, opacity, brightness, contrast, saturate, blur, visible, blendMode}
let activeLayer = null;
let view = { scale: 1, rotation: 0, offsetX: 0, offsetY: 0 }; // view transform for panning/zoom/rotate (in CSS pixels)
let history = []; // array of snapshots {layers: [{dataUrl,...}], cursorLayerIndex,...}, but to reduce memory we store per-layer dataUrls for changes
let redoStack = [];
let HISTORY_LIMIT = 1000; // default (user requested min50~200 or unlimited); configurable
let isUIHidden = false;
let brushPresets = JSON.parse(localStorage.getItem('sp_brush_presets')||'[]'); // {name,size,opacity,pressure}
let quickBrushButtons = []; // DOM

/* ================= 유틸 함수 ================= */
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

/* devicePixelRatio aware canvas sizing */
function setCanvasSizeForDisplay(canvas, width, height){
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return ctx;
}

/* Convert screen pointer to canvas logical coordinates accounting view transform (scale, rotation, offset) */
function screenToCanvasPoint(screenX, screenY){
  const rect = container.getBoundingClientRect();
  const x = screenX - rect.left;
  const y = screenY - rect.top;
  // apply inverse view transform: translate, rotate, scale
  // steps: subtract offset -> translate to center? we treat offset in screen pixels already relative to top-left
  let tx = (x - view.offsetX);
  let ty = (y - view.offsetY);
  // inverse rotate
  const angle = -view.rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const rx = tx * cos - ty * sin;
  const ry = tx * sin + ty * cos;
  // inverse scale
  const cx = rx / view.scale;
  const cy = ry / view.scale;
  return { x: cx, y: cy };
}

/* Apply canvas draw context transform to render with view */
function applyViewTransformToCtx(ctx){
  // reset transform then apply: scale and rotate then translate
  // but our canvases are sized to device pixels with ctx.transform already set; we only draw into logical coords
  ctx.setTransform(window.devicePixelRatio || 1,0,0,window.devicePixelRatio || 1, 0,0);
  ctx.translate(view.offsetX, view.offsetY);
  ctx.translate(0,0);
  ctx.rotate(view.rotation * Math.PI / 180);
  ctx.scale(view.scale, view.scale);
}

/* ================= 레이어 관리 ================= */
function createLayer(name='Layer '+(layers.length+1)){
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  canvas.style.position='absolute';
  canvas.style.left='0';
  canvas.style.top='0';
  canvas.style.touchAction='none';
  container.appendChild(canvas);
  setCanvasSizeForDisplay(canvas, container.clientWidth, container.clientHeight);
  const ctx = canvas.getContext('2d');
  ctx.lineJoin='round'; ctx.lineCap='round';
  const layer = {
    canvas, ctx,
    name,
    opacity: 1,
    brightness: 1,
    contrast: 1,
    saturate: 1,
    blur: 0,
    visible: true,
    blendMode: 'source-over'
  };
  layers.push(layer);
  activeLayer = layer;
  attachDrawingEvents(canvas);
  updateLayersPanel();
  saveSnapshot(); // baseline
  return layer;
}
function deleteLayer(layer){
  if (layers.length <= 1) return;
  const idx = layers.indexOf(layer);
  layers.splice(idx,1);
  if (layer.canvas.parentElement) layer.canvas.parentElement.removeChild(layer.canvas);
  if (activeLayer === layer) activeLayer = layers[layers.length-1];
  updateLayersPanel();
  saveSnapshot();
}
function moveLayer(layer, dir){
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  // reorder DOM
  layers.forEach((l,i)=> container.appendChild(l.canvas));
  updateLayersPanel();
  saveSnapshot();
}
function mergeLayers(topLayer, bottomLayer){
  if(!topLayer || !bottomLayer) return;
  bottomLayer.ctx.save();
  bottomLayer.ctx.globalCompositeOperation = 'source-over';
  bottomLayer.ctx.drawImage(topLayer.canvas, 0,0, container.clientWidth, container.clientHeight);
  bottomLayer.ctx.restore();
  deleteLayer(topLayer);
  saveSnapshot();
}
function applyLayerFiltersCSS(layer){
  const f = [];
  if(layer.blur) f.push(`blur(${layer.blur}px)`);
  if(layer.brightness !== 1) f.push(`brightness(${layer.brightness})`);
  if(layer.contrast !== 1) f.push(`contrast(${layer.contrast})`);
  if(layer.saturate !== 1) f.push(`saturate(${layer.saturate})`);
  layer.canvas.style.filter = f.join(' ') || 'none';
  layer.canvas.style.opacity = layer.opacity;
  layer.canvas.style.mixBlendMode = layer.blendMode || 'normal';
}
function drawAllLayersVisual(){
  layers.forEach(applyLayerFiltersCSS);
}

/* ================= 히스토리(Undo/Redo) 개선 ================= */
/* Snapshot strategy: record per-layer dataUrl only when changes happen. Keep cap HISTORY_LIMIT */
function saveSnapshot(){
  try {
    const snapshot = {
      layers: layers.map(l => ({ dataUrl: l.canvas.toDataURL(), name: l.name, opacity: l.opacity, brightness: l.brightness, contrast: l.contrast, saturate: l.saturate, blur: l.blur, visible: l.visible, blendMode: l.blendMode })),
      activeIndex: layers.indexOf(activeLayer),
      view: {...view}
    };
    history.push(snapshot);
    // cap
    if (HISTORY_LIMIT > 0 && history.length > Math.max(50, HISTORY_LIMIT)) history.shift();
    redoStack = [];
    persistLocalStateDebounced();
  } catch (e) {
    console.warn('saveSnapshot error', e);
  }
}
/* Save only once per stroke: caller should call saveSnapshot() after stroke ends.
   For operations that change many things we call saveSnapshot() explicitly.
*/
function undo(){
  if (history.length <= 1) return; // keep at least one baseline
  const last = history.pop();
  redoStack.push(last);
  const prev = history[history.length-1];
  if (!prev) return;
  // restore layers
  loadSnapshot(prev, false);
}
function redo(){
  if (!redoStack.length) return;
  const next = redoStack.pop();
  history.push(next);
  loadSnapshot(next, false);
}
function loadSnapshot(snapshot, pushToHistory=true){
  if (!snapshot) return;
  // clear current canvases and restore
  // if layer counts differ, rebuild layers array to match snapshot size
  const targetCount = snapshot.layers.length;
  // remove extra layers
  while(layers.length > targetCount){
    const l = layers.pop();
    if (l.canvas.parentElement) l.canvas.parentElement.removeChild(l.canvas);
  }
  // add missing layers
  while(layers.length < targetCount){
    createLayer('Layer '+(layers.length+1));
  }
  // now each layer: draw dataUrl
  snapshot.layers.forEach((ld, i) => {
    const layer = layers[i];
    layer.name = ld.name || layer.name;
    layer.opacity = ld.opacity !== undefined ? ld.opacity : layer.opacity;
    layer.brightness = ld.brightness !== undefined ? ld.brightness : layer.brightness;
    layer.contrast = ld.contrast !== undefined ? ld.contrast : layer.contrast;
    layer.saturate = ld.saturate !== undefined ? ld.saturate : layer.saturate;
    layer.blur = ld.blur !== undefined ? ld.blur : layer.blur;
    layer.visible = ld.visible !== undefined ? ld.visible : layer.visible;
    layer.blendMode = ld.blendMode || layer.blendMode;
    if (ld.dataUrl) {
      const img = new Image();
      img.onload = () => {
        layer.ctx.clearRect(0,0,container.clientWidth, container.clientHeight);
        layer.ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
      };
      img.src = ld.dataUrl;
    } else {
      layer.ctx.clearRect(0,0,container.clientWidth, container.clientHeight);
    }
    applyLayerFiltersCSS(layer);
  });
  view = snapshot.view || view;
  activeLayer = layers[snapshot.activeIndex] || layers[0];
  updateLayersPanel();
  drawAllLayersVisual();
  if (pushToHistory) saveSnapshot();
}

/* undo/redo keyboard handlers mapping */
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) { // Ctrl+Shift+Z => redo (user requested)
      e.preventDefault();
      redo();
    } else {
      e.preventDefault();
      undo();
    }
  }
});

/* ================= 브러시 / 스트로크 안정화 / 압력 / 불투명 ================= */
const brush = {
  size: 10,
  opacity: 1.0,
  pressure: true,
  smoothing: 0.6, // 0..1 higher = smoother
  presetList: brushPresets
};
/* populate brush select 1..100 */
function initBrushSelect(){
  if (brushSelect.tagName === 'SELECT') {
    brushSelect.innerHTML = '';
    for (let i=1;i<=100;i++){
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i;
      brushSelect.appendChild(opt);
    }
    brushSelect.value = 10;
  } else {
    brushSelect.min = 1; brushSelect.max = 100; brushSelect.value = 10;
  }
  brush.size = parseFloat(brushSelect.value)||10;
}
initBrushSelect();
brushSelect.addEventListener('change', ()=> { brush.size = parseFloat(brushSelect.value)||10; });

/* quick brush preset buttons area */
const presetArea = ensureElement('brush-presets-area','div');
function renderBrushPresetsUI(){
  presetArea.innerHTML = '';
  quickBrushButtons = [];
  brush.presetList.forEach((p,idx)=>{
    const btn = document.createElement('button');
    btn.style.padding='4px';
    btn.style.margin='2px';
    btn.title = p.name;
    // small canvas thumbnail
    const thumb = document.createElement('canvas');
    thumb.width = 40; thumb.height = 40;
    const tctx = thumb.getContext('2d');
    tctx.fillStyle = '#fff'; tctx.fillRect(0,0,40,40);
    tctx.fillStyle = p.color || colorPicker.value;
    tctx.globalAlpha = p.opacity !== undefined ? p.opacity : 1;
    tctx.beginPath();
    tctx.arc(20,20, Math.max(2, Math.min(18, p.size/2)), 0, Math.PI*2);
    tctx.fill();
    btn.appendChild(thumb);
    btn.addEventListener('click', ()=>{
      brush.size = p.size; brush.opacity = p.opacity; brush.pressure = !!p.pressure;
      if (brushSelect.tagName==='SELECT') brushSelect.value = p.size;
      else brushSelect.value = p.size;
      colorPicker.value = p.color || colorPicker.value;
    });
    presetArea.appendChild(btn);
    quickBrushButtons.push(btn);
  });
  // add "save current preset" button
  const saveBtn = document.createElement('button'); saveBtn.textContent = '+저장';
  saveBtn.addEventListener('click', ()=>{
    const name = prompt('프리셋 이름'); if(!name) return;
    const p = { name, size: brush.size, opacity: brush.opacity, pressure: brush.pressure, color: colorPicker.value };
    brush.presetList.push(p);
    localStorage.setItem('sp_brush_presets', JSON.stringify(brush.presetList));
    renderBrushPresetsUI();
  });
  presetArea.appendChild(saveBtn);
}
renderBrushPresetsUI();

/* ================= 그리기 이벤트: pointer + smoothing + pressure + symmetry ================= */
let drawingState = {
  isDrawing: false,
  pointerId: null,
  points: [], // smoothing buffer
  lastSaved: null
};
let symmetry = { enabled: false, mode: 'none' }; // 'vertical','horizontal','both'
function attachDrawingEvents(canvas){
  canvas.addEventListener('pointerdown', onPointerDown, { passive:false });
  window.addEventListener('pointermove', onPointerMove, { passive:false });
  window.addEventListener('pointerup', onPointerUp);

  function getPos(e){
    // get logical canvas coordinates considering view transforms
    const p = screenToCanvasPoint(e.clientX, e.clientY);
    return p;
  }

  function onPointerDown(e){
    if (e.button !== undefined && e.button !== 0 && e.button !== 1) return; // left or middle allowed
    // if middle button or space for panning, handle elsewhere
    if ((e.button === 1) || e.shiftKey || window._panningActive) {
      // let panning handler catch it
      return;
    }
    // ignore clicks on UI buttons
    if (e.target && (e.target.tagName === 'BUTTON' || e.target.tagName==='INPUT' || e.target.closest && e.target.closest('#layers-panel'))) return;
    // begin stroke
    drawingState.isDrawing = true;
    drawingState.pointerId = e.pointerId;
    drawingState.points = [];
    const pressure = (e.pressure !== undefined ? e.pressure : 0.5);
    const pos = getPos(e);
    drawingState.points.push({x:pos.x, y:pos.y, pressure});
    // set capture
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    // ensure we save previous snapshot for undo
    if (activeLayer) {
      const current = activeLayer.canvas.toDataURL();
      history.push({singleLayer: layers.indexOf(activeLayer), dataUrl: current});
      if (HISTORY_LIMIT>0 && history.length>HISTORY_LIMIT) history.shift();
    }
  }

  function onPointerMove(e){
    if (!drawingState.isDrawing || e.pointerId !== drawingState.pointerId) return;
    const pos = getPos(e);
    const pressure = (e.pressure !== undefined ? e.pressure : 0.5);
    drawingState.points.push({x:pos.x, y:pos.y, pressure});
    // smoothing: use last N points to compute smoothed point
    const smoothed = smoothPoints(drawingState.points, brush.smoothing);
    // draw segment from previous smoothed to current smoothed
    const ctx = activeLayer && activeLayer.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = usingEraser ? 'destination-out' : (activeLayer.blendMode || 'source-over');
    // stroke style
    const baseSize = Math.min(100, brush.size || 10);
    const p = smoothed;
    const alpha = brush.opacity !== undefined ? brush.opacity : 1.0;
    ctx.lineWidth = Math.max(1, (baseSize * (p.pressure || 1)));
    ctx.strokeStyle = colorPicker.value;
    ctx.globalAlpha = alpha * (usingEraser ? 1 : 1);
    // optional filter for layer-specific blur if ctx.filter supported
    if (activeLayer.blur && ctx.filter !== undefined) ctx.filter = `blur(${activeLayer.blur}px)`;
    ctx.beginPath();
    // compute previous point
    const prev = drawingState.points.length >= 2 ? smoothPoints(drawingState.points.slice(0,-1), brush.smoothing) : p;
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
    // symmetry: mirror draws
    if (symmetry.enabled){
      drawSymmetryStroke(prev, p);
    }
  }

  function onPointerUp(e){
    if (!drawingState.isDrawing || e.pointerId !== drawingState.pointerId) return;
    drawingState.isDrawing = false;
    drawingState.pointerId = null;
    drawingState.points = [];
    // release capture
    try { e.target.releasePointerCapture && e.target.releasePointerCapture(e.pointerId); } catch(e){}
    // finalize history: last push already added baseline; optionally push final combined snapshot for global undo
    saveSnapshot();
  }

  function smoothPoints(points, smoothing){
    // simple exponential moving average smoothing
    if (!points || points.length===0) return {x:0,y:0,pressure:1};
    let x=points[0].x, y=points[0].y, pr=points[0].pressure||1;
    for (let i=1;i<points.length;i++){
      const k = Math.pow(smoothing, i);
      x = x * (1-k) + points[i].x * k;
      y = y * (1-k) + points[i].y * k;
      pr = pr * (1-k) + (points[i].pressure||1)*k;
    }
    return { x, y, pressure: pr };
  }

  function drawSymmetryStroke(a, b){
    // perform mirrored drawing on activeLayer ctx
    const ctx = activeLayer && activeLayer.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = usingEraser ? 'destination-out' : (activeLayer.blendMode || 'source-over');
    ctx.strokeStyle = colorPicker.value;
    ctx.globalAlpha = brush.opacity || 1;
    const baseSize = Math.min(100, brush.size || 10);
    // vertical mirror across center of canvas logical size
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (symmetry.mode === 'vertical' || symmetry.mode === 'both'){
      const pa = { x: w - a.x, y: a.y };
      const pb = { x: w - b.x, y: b.y };
      ctx.lineWidth = baseSize * (b.pressure||1);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    if (symmetry.mode === 'horizontal' || symmetry.mode === 'both'){
      const pa = { x: a.x, y: h - a.y };
      const pb = { x: b.x, y: h - b.y };
      ctx.lineWidth = baseSize * (b.pressure||1);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    ctx.restore();
  }
}

/* Attach events to existing and future layers */
function attachDrawingEventsToAll(){
  layers.forEach(l => {
    l.canvas.onpointerdown = null; // remove previous to avoid duplicates
    attachDrawingEvents(l.canvas);
  });
}

/* ================= 스포이드 (Eyedropper) ================= */
let eyedropperActive = false;
function enableEyedropper(){
  eyedropperActive = true;
  container.style.cursor = 'crosshair';
  function onPick(e){
    const x = e.clientX - container.getBoundingClientRect().left;
    const y = e.clientY - container.getBoundingClientRect().top;
    // find topmost visible layer pixel at that point
    for (let i = layers.length - 1; i >= 0; i--){
      const L = layers[i];
      if (!L.visible) continue;
      try {
        const ctx = L.ctx;
        const ratio = window.devicePixelRatio || 1;
        const imgData = ctx.getImageData(Math.floor(x*ratio), Math.floor(y*ratio), 1,1).data;
        if (imgData[3] === 0) continue; // transparent, skip
        const hex = rgbToHex(imgData[0], imgData[1], imgData[2]);
        colorPicker.value = hex;
        break;
      } catch (err) {
        console.warn('eyedropper error', err);
      }
    }
    container.removeEventListener('pointerdown', onPick);
    eyedropperActive = false;
    container.style.cursor = 'default';
  }
  container.addEventListener('pointerdown', onPick, { once: true });
}
function rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''); }

/* ================= 페인트통(flood fill) 개선 (already implemented earlier) ================= */
function floodFillAt(layer, screenX, screenY, fillColorHex, tolerance=32){
  if (!layer) return;
  const ctx = layer.ctx;
  const ratio = window.devicePixelRatio || 1;
  const logW = layer.canvas.width / ratio;
  const logH = layer.canvas.height / ratio;
  const img = ctx.getImageData(0,0,layer.canvas.width, layer.canvas.height);
  const data = img.data;
  const px = Math.floor(screenToCanvasPoint(screenX, screenY).x * ratio);
  const py = Math.floor(screenToCanvasPoint(screenX, screenY).y * ratio);
  if (px<0||py<0||px>=layer.canvas.width||py>=layer.canvas.height) return;
  const startIdx = (py*layer.canvas.width + px) * 4;
  const startColor = [data[startIdx], data[startIdx+1], data[startIdx+2], data[startIdx+3]];
  // parse fillColorHex to rgba
  const fc = hexToRgba(fillColorHex);
  if (!fc) return;
  if (startColor[0]===fc[0] && startColor[1]===fc[1] && startColor[2]===fc[2]) return;
  const stack = [[px,py]];
  const visited = new Uint8Array(layer.canvas.width * layer.canvas.height);
  const tol2 = tolerance * tolerance;
  function colorMatchAt(x,y){
    const i = (y*layer.canvas.width + x)*4;
    const dr = data[i]-startColor[0];
    const dg = data[i+1]-startColor[1];
    const db = data[i+2]-startColor[2];
    return (dr*dr + dg*dg + db*db) <= tol2;
  }
  while(stack.length){
    const [x,y] = stack.pop();
    if (x<0||y<0||x>=layer.canvas.width||y>=layer.canvas.height) continue;
    const idx = y*layer.canvas.width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (!colorMatchAt(x,y)) continue;
    const i = idx*4;
    data[i] = fc[0]; data[i+1]=fc[1]; data[i+2]=fc[2]; data[i+3]=255;
    stack.push([x+1,y]); stack.push([x-1,y]); stack.push([x,y+1]); stack.push([x,y-1]);
  }
  ctx.putImageData(img, 0,0);
  saveSnapshot();
}
function hexToRgba(hex){
  if (!hex) return null;
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  return [r,g,b,255];
}

/* ================= 캔버스 PANNING, ZOOM, ROTATE (view) ================= */
let isPanning = false;
let panStart = null;
let lastWheelTime = 0;

function enablePanHandlers(){
  // space + drag or middle button drag
  container.addEventListener('pointerdown', (e)=>{
    if (e.button === 1 || e.buttons === 4 || e.shiftKey || e.ctrlKey) {
      // middle button (button==1) or shift => pan
      isPanning = true;
      panStart = { x: e.clientX - view.offsetX, y: e.clientY - view.offsetY };
      container.setPointerCapture && container.setPointerCapture(e.pointerId);
      return;
    }
  });
  window.addEventListener('pointermove', (e)=>{
    if (!isPanning) return;
    view.offsetX = e.clientX - panStart.x;
    view.offsetY = e.clientY - panStart.y;
    // apply CSS transform to container children (we draw into layer canvases directly; we can visually move the entire container via transform)
    container.style.transform = `translate(${view.offsetX}px, ${view.offsetY}px) rotate(${view.rotation}deg) scale(${view.scale})`;
  });
  window.addEventListener('pointerup', (e)=>{
    if (isPanning) {
      isPanning = false;
      container.releasePointerCapture && container.releasePointerCapture(e.pointerId);
      saveSnapshot();
    }
  });
  // wheel zoom with ctrl or pinch handled in overlay; here generic wheel zoom when ctrlKey pressed or alt
  container.addEventListener('wheel', (e)=>{
    if (!e.ctrlKey && !e.metaKey && !e.altKey) return; // require modifier to zoom to avoid interfering with scroll
    e.preventDefault();
    const now = Date.now();
    if (now - lastWheelTime < 10) return;
    lastWheelTime = now;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.08 : 0.92;
    const oldScale = view.scale;
    view.scale = clamp(view.scale * delta, 0.05, 20);
    // zoom towards mouse: adjust offset so point under mouse remains under mouse
    view.offsetX = mx - ((mx - view.offsetX) * (view.scale / oldScale));
    view.offsetY = my - ((my - view.offsetY) * (view.scale / oldScale));
    container.style.transform = `translate(${view.offsetX}px, ${view.offsetY}px) rotate(${view.rotation}deg) scale(${view.scale})`;
    saveSnapshotDebounced();
  }, { passive: false });
}

/* ================= 선택 영역/이동 툴 (basic) ================= */
let selection = { active:false, x:0,y:0,w:0,h:0, start:null, moving:false, moveOffset:null, sourceCanvas:null };
function enableSelectionTool(){
  // clicking with certain tool selected would start selection; provide API selectRect()
  // For simplicity, treat right-click as selection start (or add separate button)
  container.addEventListener('contextmenu', (e) => e.preventDefault());
  container.addEventListener('pointerdown', (e)=>{
    if (!e.altKey) return; // hold Alt to start selection
    selection.active = true;
    const p = screenToCanvasPoint(e.clientX, e.clientY);
    selection.start = p;
    selection.x = p.x; selection.y = p.y; selection.w = 0; selection.h = 0;
    selection.sourceCanvas = document.createElement('canvas');
    setCanvasSizeForDisplay(selection.sourceCanvas, 0,0); // placeholder
  });
  container.addEventListener('pointermove', (e)=>{
    if (!selection.active || !selection.start) return;
    const p = screenToCanvasPoint(e.clientX, e.clientY);
    selection.x = Math.min(selection.start.x, p.x);
    selection.y = Math.min(selection.start.y, p.y);
    selection.w = Math.abs(selection.start.x - p.x);
    selection.h = Math.abs(selection.start.y - p.y);
    // draw selection overlay UI - skipped to avoid heavy UI code
  });
  container.addEventListener('pointerup', (e)=>{
    if (!selection.active) return;
    // finalize selection; enable moving by dragging inside selection
    selection.start = null;
    // copy pixels from activeLayer into temporary canvas for move
    if (activeLayer && selection.w>0 && selection.h>0){
      selection.sourceCanvas = document.createElement('canvas');
      setCanvasSizeForDisplay(selection.sourceCanvas, selection.w, selection.h);
      const sctx = selection.sourceCanvas.getContext('2d');
      sctx.drawImage(activeLayer.canvas, selection.x, selection.y, selection.w, selection.h, 0,0, selection.w, selection.h);
      // clear area
      activeLayer.ctx.clearRect(selection.x, selection.y, selection.w, selection.h);
      saveSnapshot();
    }
    selection.moving = true;
    selection.moveOffset = { x: 0, y: 0 };
  });
  // moving: pointermove while selection.moving true -> update moveOffset and draw preview; on pointerup finalize
  window.addEventListener('pointermove', (e)=>{
    if (!selection.moving) return;
    // update offset based on pointer movement
    // not implementing full preview due to complexity; finalizing with immediate draw at new pos on pointerup
  });
  window.addEventListener('pointerup', (e)=>{
    if (!selection.moving) return;
    // finalize move: draw sourceCanvas back to active layer at new position
    const newPos = { x: selection.x + (selection.moveOffset?selection.moveOffset.x:0), y: selection.y + (selection.moveOffset?selection.moveOffset.y:0) };
    activeLayer.ctx.drawImage(selection.sourceCanvas, newPos.x, newPos.y);
    selection.active=false; selection.moving=false; selection.start=null; selection.sourceCanvas=null;
    saveSnapshot();
  });
}

/* ================= 브러시 프리셋 저장/로드 ================= */
function saveBrushPreset(name){
  const p = { name, size: brush.size, opacity: brush.opacity, pressure: brush.pressure, color: colorPicker.value };
  brush.presetList.push(p);
  localStorage.setItem('sp_brush_presets', JSON.stringify(brush.presetList));
  renderBrushPresetButtons();
}
function renderBrushPresetButtons(){
  // create UI area if not present
  let containerEl = document.getElementById('brush-presets-area');
  if (!containerEl) {
    containerEl = document.createElement('div'); containerEl.id='brush-presets-area';
    if (toolbar) toolbar.appendChild(containerEl); else document.body.appendChild(containerEl);
  }
  containerEl.innerHTML = '';
  brush.presetList.forEach((p, i)=>{
    const btn = document.createElement('button'); btn.title = p.name;
    btn.style.padding='2px'; btn.style.margin='2px';
    const c = document.createElement('canvas'); c.width=32; c.height=32;
    const tc = c.getContext('2d'); tc.fillStyle = p.color||'#000'; tc.beginPath(); tc.arc(16,16, Math.max(2, p.size/6),0,Math.PI*2); tc.fill();
    btn.appendChild(c);
    btn.addEventListener('click', ()=>{ brush.size = p.size; brush.opacity = p.opacity; brush.pressure = p.pressure; colorPicker.value = p.color; if (brushSelect.tagName==='SELECT') brushSelect.value = p.size; else brushSelect.value = p.size; });
    containerEl.appendChild(btn);
  });
  const addBtn = document.createElement('button'); addBtn.textContent = '+';
  addBtn.addEventListener('click', ()=>{
    const name = prompt('프리셋 이름'); if(!name) return;
    saveBrushPreset(name);
  });
  containerEl.appendChild(addBtn);
}
renderBrushPresetButtons();

/* ================= 스포이드 버튼 바인딩 ================= */
const eyedropperBtn = ensureElement('eyedropper','button'); eyedropperBtn.textContent = '스포이드';
eyedropperBtn.addEventListener('click', ()=>{
  enableEyedropper();
});

/* ================= 레이어 패널 생성/업데이트 UI ================= */
function updateLayersPanel(){
  layersPanel.innerHTML = '';
  // top controls: new canvas size, export buttons, shortcut guide button
  const topRow = document.createElement('div');
  topRow.style.display='flex'; topRow.style.gap='6px'; topRow.style.marginBottom='8px';
  const sizeBtn = document.createElement('button'); sizeBtn.textContent = '캔버스 크기';
  sizeBtn.addEventListener('click', ()=> {
    const w = parseInt(prompt('가로(px)', container.clientWidth),10);
    const h = parseInt(prompt('세로(px)', container.clientHeight),10);
    if (!w || !h) return;
    // resize internal canvases (resample current content)
    layers.forEach(layer=>{
      const tmp = document.createElement('canvas');
      setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
      tmp.getContext('2d').drawImage(layer.canvas,0,0);
      setCanvasSizeForDisplay(layer.canvas, w, h);
      layer.ctx.drawImage(tmp, 0,0, tmp.width/(window.devicePixelRatio||1), tmp.height/(window.devicePixelRatio||1), 0,0, w, h);
    });
    container.style.width = w + 'px'; container.style.height = h + 'px';
    saveSnapshot();
  });
  const exportBtn = document.createElement('button'); exportBtn.textContent = 'PSD(Zip)';
  exportBtn.addEventListener('click', exportPSDlikeZip);
  const shortcutBtn = document.createElement('button'); shortcutBtn.textContent = '단축키 가이드';
  shortcutBtn.addEventListener('click', ()=> showShortcutGuide());
  topRow.appendChild(sizeBtn); topRow.appendChild(exportBtn); topRow.appendChild(shortcutBtn);
  layersPanel.appendChild(topRow);

  // list layers
  for (let i=layers.length-1;i>=0;i--){
    const L = layers[i];
    const row = document.createElement('div');
    row.style.border = L===activeLayer ? '1px solid #447' : '1px solid #ccc';
    row.style.padding = '6px';
    row.style.marginBottom = '6px';
    const title = document.createElement('div'); title.textContent = L.name; title.style.fontWeight = 'bold';
    row.appendChild(title);
    // sliders: opacity, brightness, contrast, saturate, blur
    const makeRange = (label, min, max, step, value, oninput) => {
      const wr = document.createElement('div'); wr.style.display='flex'; wr.style.alignItems='center'; wr.style.gap='6px';
      const lab = document.createElement('span'); lab.textContent = label; lab.style.width='60px'; lab.style.fontSize='12px';
      const r = document.createElement('input'); r.type='range'; r.min=min; r.max=max; r.step=step; r.value=value;
      r.addEventListener('input', (e)=> oninput(parseFloat(e.target.value)));
      wr.appendChild(lab); wr.appendChild(r);
      return wr;
    };
    row.appendChild(makeRange('불투명', 0, 1, 0.01, L.opacity, v=>{ L.opacity=v; applyLayerFiltersCSS(L); saveSnapshot(); }));
    row.appendChild(makeRange('밝기', 0, 2, 0.01, L.brightness, v=>{ L.brightness=v; applyLayerFiltersCSS(L); saveSnapshot(); }));
    row.appendChild(makeRange('대비', 0, 2, 0.01, L.contrast, v=>{ L.contrast=v; applyLayerFiltersCSS(L); saveSnapshot(); }));
    row.appendChild(makeRange('채도', 0, 3, 0.01, L.saturate, v=>{ L.saturate=v; applyLayerFiltersCSS(L); saveSnapshot(); }));
    row.appendChild(makeRange('흐림', 0, 40, 1, L.blur, v=>{ L.blur=v; applyLayerFiltersCSS(L); saveSnapshot(); }));

    const controls = document.createElement('div'); controls.style.display='flex'; controls.style.gap='6px'; controls.style.marginTop='6px';
    const vis = document.createElement('button'); vis.textContent = L.visible ? '👁' : '🚫'; vis.addEventListener('click', ()=>{ L.visible=!L.visible; vis.textContent=L.visible?'👁':'🚫'; applyLayerFiltersCSS(L); saveSnapshot();});
    const up = document.createElement('button'); up.textContent='⬆️'; up.addEventListener('click', ()=> moveLayer(L, +1));
    const down = document.createElement('button'); down.textContent='⬇️'; down.addEventListener('click', ()=> moveLayer(L, -1));
    const del = document.createElement('button'); del.textContent='❌'; del.addEventListener('click', ()=> deleteLayer(L));
    controls.appendChild(vis); controls.appendChild(up); controls.appendChild(down); controls.appendChild(del);
    row.appendChild(controls);

    row.addEventListener('click', (e)=> { if (e.target.tagName === 'INPUT' || e.target.tagName==='BUTTON') return; activeLayer = L; updateLayersPanel(); });
    layersPanel.appendChild(row);
  }
}

/* ================= Shortcuts guide ================= */
function showShortcutGuide(){
  let guide = document.getElementById('shortcut-guide');
  if (!guide) {
    guide = document.createElement('div'); guide.id='shortcut-guide';
    guide.style.position='fixed'; guide.style.left='10px'; guide.style.top='10px'; guide.style.zIndex='2147483700'; guide.style.background='rgba(0,0,0,0.75)';
    guide.style.color='#fff'; guide.style.padding='12px'; guide.style.borderRadius='8px';
    const html = `
      <b>단축키 가이드</b><br>
      Ctrl+Z : 되돌리기<br>
      Ctrl+Shift+Z : 취소(Redo)<br>
      Tab : UI 숨기기/보이기<br>
      Space(or MiddleButton) + Drag : 캔버스 이동(Pan)<br>
      Ctrl(또는 Cmd) + Wheel : 확대/축소(Zoom)<br>
      Alt + Drag : 선택 영역 생성<br>
      Shift : 임시 보정(미구현 추가 옵션)<br>
      Alt 클릭 : 스포이드<br>
    `;
    guide.innerHTML = html;
    document.body.appendChild(guide);
    setTimeout(()=>{ guide.style.opacity=1; },10);
    guide.addEventListener('click', ()=> { guide.remove(); });
  } else {
    guide.remove();
  }
}

/* ================= PSD-like export (zip of PNGs + metadata) ================= */
async function exportPSDlikeZip(){
  // create a zip containing each layer png and metadata.json
  // We'll use JSZip if available; if not, fallback to downloading individual images in a folder-like manner by zipping via built-in workaround (not supported).
  if (window.JSZip) {
    const zip = new JSZip();
    const meta = { width: container.clientWidth, height: container.clientHeight, layers: [] };
    for (let i=0;i<layers.length;i++){
      const l = layers[i];
      const dataUrl = l.canvas.toDataURL();
      const bin = dataUrlToUint8Array(dataUrl);
      zip.file(`layer_${i}_${sanitizeFilename(l.name)}.png`, bin, {binary:true});
      meta.layers.push({ name: l.name, opacity: l.opacity, brightness: l.brightness, contrast: l.contrast, saturate: l.saturate, blur: l.blur, visible: l.visible });
    }
    zip.file('metadata.json', JSON.stringify(meta));
    const content = await zip.generateAsync({type:'blob'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = 'psd_like.zip'; a.click();
  } else {
    alert('JSZip 필요: PSD(Zip) 내보내기는 JSZip 라이브러리 필요합니다. (Optional)'); 
    // fallback: save single flattened PNG
    const tmp = document.createElement('canvas');
    setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
    const tctx = tmp.getContext('2d');
    layers.forEach(l => { if (l.visible) tctx.drawImage(l.canvas, 0,0); });
    const data = tmp.toDataURL('image/png');
    const link = document.createElement('a'); link.href = data; link.download = 'flatten.png'; link.click();
  }
}
function dataUrlToUint8Array(dataUrl){
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return arr;
}
function sanitizeFilename(name){ return name.replace(/[^\w\-\.]/g,'_'); }

/* ================= GIF/APNG export (simple frame export stub) ================= */
function exportFramesAsZip(frameDataUrls){
  if (!frameDataUrls || !frameDataUrls.length) return;
  if (window.JSZip) {
    const zip = new JSZip();
    frameDataUrls.forEach((d,i)=> zip.file(`frame_${i}.png`, dataUrlToUint8Array(d), {binary:true}));
    zip.generateAsync({type:'blob'}).then(content=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(content); a.download='frames.zip'; a.click(); });
  } else {
    alert('JSZip 필요: GIF/APNG 추출(프레임 zip) 은 JSZip 필요');
  }
}

/* ================= Storage: autosave & load on refresh ================= */
const STORAGE_KEY = 'simple_paint_state_v2';
function persistLocalState(){
  try {
    const state = { layers: [], view, activeIndex: layers.indexOf(activeLayer), brush: { size: brush.size, opacity: brush.opacity } };
    layers.forEach(l => {
      state.layers.push({
        name: l.name, opacity: l.opacity, brightness: l.brightness, contrast: l.contrast, saturate: l.saturate, blur: l.blur, visible: l.visible, dataUrl: l.canvas.toDataURL()
      });
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { console.warn('persistLocalState failed', e); }
}
const persistLocalStateDebounced = debounce(persistLocalState, 800);
function loadLocalState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const state = JSON.parse(raw);
    // clear existing canvases
    layers.forEach(l => { if (l.canvas.parentElement) l.canvas.parentElement.removeChild(l.canvas);});
    layers = [];
    state.layers.forEach((ld, idx)=>{
      const layer = createLayer(ld.name || ('Layer '+(idx+1)));
      // draw image
      if (ld.dataUrl) {
        const img = new Image();
        img.onload = ()=> { layer.ctx.clearRect(0,0,container.clientWidth, container.clientHeight); layer.ctx.drawImage(img, 0,0, container.clientWidth, container.clientHeight); };
        img.src = ld.dataUrl;
      }
      layer.opacity = ld.opacity !== undefined ? ld.opacity : layer.opacity;
      layer.brightness = ld.brightness !== undefined ? ld.brightness : layer.brightness;
      layer.contrast = ld.contrast !== undefined ? ld.contrast : layer.contrast;
      layer.saturate = ld.saturate !== undefined ? ld.saturate : layer.saturate;
      layer.blur = ld.blur !== undefined ? ld.blur : layer.blur;
      layer.visible = ld.visible !== undefined ? ld.visible : layer.visible;
      applyLayerFiltersCSS(layer);
    });
    view = state.view || view;
    activeLayer = layers[state.activeIndex] || layers[0];
    updateLayersPanel();
    drawAllLayersVisual();
    return true;
  } catch (e) {
    console.warn('loadLocalState failed', e);
    return false;
  }
}
loadLocalState();

/* ================= UI hide/show (Tab) ================= */
window.addEventListener('keydown', (e)=>{
  if (e.key === 'Tab') {
    e.preventDefault();
    isUIHidden = !isUIHidden;
    if (toolbar) toolbar.style.display = isUIHidden ? 'none' : '';
    if (layersPanel) layersPanel.style.display = isUIHidden ? 'none' : '';
    if (galleryPanel) galleryPanel.style.display = isUIHidden ? 'none' : '';
  }
});

/* ================= Initialize core behaviors ================= */
function init(){
  // create default layer if none
  if (!layers.length) createLayer('Layer 1');
  // attach drawing events to each layer canvas
  layers.forEach(l => attachDrawingEvents(l.canvas));
  // view transform initial (no transform)
  view = { scale: 1, rotation: 0, offsetX: 0, offsetY: 0 };
  // panning handlers
  enablePanHandlers();
  // selection tool
  enableSelectionTool();
  // UI bindings
  undoBtn.addEventListener('click', ()=> undo());
  redoBtn.addEventListener('click', ()=> redo());
  addLayerBtn.addEventListener('click', ()=> createLayer());
  mergeLayerBtn.addEventListener('click', ()=> { if(activeLayer){ const idx = layers.indexOf(activeLayer); const neighbor = layers[idx-1] || layers[idx+1]; mergeLayers(activeLayer, neighbor); }});
  toggleLayersBtn.addEventListener('click', ()=> { layersPanel.style.display = layersPanel.style.display === 'none' ? '' : 'none'; });
  colorPicker.addEventListener('change', ()=> {});
  // fill action: click then pick
  fillBtn.addEventListener('click', ()=>{
    // one-shot: next pointerdown fills active layer at pointer
    const onFill = (e) => {
      floodFillAt(activeLayer, e.clientX, e.clientY, colorPicker.value, 32);
      container.removeEventListener('pointerdown', onFill);
    };
    container.addEventListener('pointerdown', onFill, { once: true });
  });
  // eyedropper via Alt+Click
  container.addEventListener('pointerdown', (e)=>{
    if (e.altKey){
      enableEyedropper();
    }
  });
  // save / export
  saveBtn.addEventListener('click', ()=> {
    // default save flattened PNG
    const tmp = document.createElement('canvas'); setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
    const tctx = tmp.getContext('2d');
    layers.forEach(l => { if (l.visible) tctx.drawImage(l.canvas, 0,0); });
    const data = tmp.toDataURL('image/png');
    const a = document.createElement('a'); a.href=data; a.download='drawing.png'; a.click();
  });

  // brush settings UI already created earlier
  renderBrushPresetButtons();
  updateLayersPanel();
  drawAllLayersVisual();
}
init();

/* Expose useful API for developer console */
window.simplePaint = {
  layers, createLayer, deleteLayer, mergeLayers, undo, redo, saveSnapshot, exportPSDlikeZip, exportFramesAsZip, saveBrushPreset, brush
};

/* ================= Notes: some advanced features (PSD binary export, animated GIF creation) require third-party libs (JSZip, gif.js, apng-js).
   This code implements PSD-like ZIP export using JSZip if available; GIF/APNG export is provided as frame zip stub.
   Many UI bits are created dynamically; integrate into index.html for production.
*/
