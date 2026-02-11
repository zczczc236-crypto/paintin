/* ========= DOM ========= */
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

/* ========= 상태 ========= */
let layers = [];
let activeLayer = null;
let history = [];
let redoStack = [];
let usingEraser = false;

/* ========= 초기 브러시 옵션 ========= */
for(let i=1;i<=20;i++){
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  brushSelect.appendChild(opt);
}
brushSelect.value = 5;

/* ========= 초기화 ========= */
window.addEventListener('load', () => {
  createLayer('Layer 1');
  resizeCanvases();
  updateLayersPanel();
});
window.addEventListener('resize', () => {
  resizeCanvases();
});

/* ========= 캔버스/레이어 유틸 ========= */
function resizeCanvases(){
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer=>{
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tmp.getContext('2d').drawImage(layer.canvas,0,0);
    layer.canvas.width = w;
    layer.canvas.height = h;
    layer.ctx.drawImage(tmp,0,0, tmp.width, tmp.height, 0,0, w, h);
  });
}

/* ========= 레이어 관리 ========= */
function createLayer(name='Layer'){
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  canvas.width = container.clientWidth || 800;
  canvas.height = container.clientHeight || 600;
  canvas.style.zIndex = layers.length;
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

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
  if(activeLayer === layer) activeLayer = layers[layers.length-1];
  layers.forEach((l,i)=>{ l.canvas.style.zIndex = i; if(l.canvas.parentElement) container.appendChild(l.canvas); });
  updateLayersPanel();
  saveHistory();
}

function moveLayer(layer, dir){
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if(newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  layers.forEach((l,i)=>{ l.canvas.style.zIndex = i; container.appendChild(l.canvas); });
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
  target.ctx.drawImage(activeLayer.canvas,0,0);
  target.ctx.restore();
  deleteLayer(activeLayer);
  activeLayer = target;
  updateLayersPanel();
  saveHistory();
}

function drawLayers(){
  layers.forEach(layer=>{
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
    const name = document.createElement('span'); name.className='name'; name.textContent = layer.name;
    const range = document.createElement('input'); range.type='range'; range.min='0'; range.max='2'; range.step='0.01'; range.value=layer.brightness;
    const controls = document.createElement('div'); controls.className='layer-controls';
    const visBtn = document.createElement('button'); visBtn.textContent = layer.visible ? '👁' : '🚫';
    const upBtn = document.createElement('button'); upBtn.textContent='⬆️';
    const downBtn = document.createElement('button'); downBtn.textContent='⬇️';
    const delBtn = document.createElement('button'); delBtn.textContent='❌';
    controls.appendChild(visBtn); controls.appendChild(upBtn); controls.appendChild(downBtn); controls.appendChild(delBtn);

    item.appendChild(name); item.appendChild(range); item.appendChild(controls);

    item.addEventListener('click',(e)=>{
      if(e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return;
      activeLayer = layer;
      updateLayersPanel();
    });
    range.addEventListener('input', ()=>{ layer.brightness = parseFloat(range.value); drawLayers(); });
    visBtn.addEventListener('click',(e)=>{ e.stopPropagation(); layer.visible = !layer.visible; visBtn.textContent = layer.visible ? '👁' : '🚫'; drawLayers(); saveHistory(); });
    delBtn.addEventListener('click',(e)=>{ e.stopPropagation(); deleteLayer(layer); });
    upBtn.addEventListener('click',(e)=>{ e.stopPropagation(); moveLayer(layer, +1); });
    downBtn.addEventListener('click',(e)=>{ e.stopPropagation(); moveLayer(layer, -1); });

    layersPanel.appendChild(item);
  }
}

/* ========= 히스토리 (undo/redo) ========= */
function saveHistory(){
  if(!activeLayer) return;
  try{
    const data = activeLayer.canvas.toDataURL('image/png');
    const idx = layers.indexOf(activeLayer);
    history.push({ layerIndex: idx, dataUrl: data });
    if(history.length > 200) history.shift();
    redoStack = [];
  }catch(e){}
}
async function restoreSnapshot(snapshot){
  return new Promise(resolve=>{
    const img = new Image();
    img.onload = ()=>{
      const layer = layers[snapshot.layerIndex];
      if(!layer) return resolve();
      layer.ctx.clearRect(0,0,layer.canvas.width,layer.canvas.height);
      layer.ctx.drawImage(img,0,0,layer.canvas.width,layer.canvas.height);
      resolve();
    };
    img.src = snapshot.dataUrl;
  });
}

undoBtn.addEventListener('click', async ()=>{
  if(history.length===0) return;
  const last = history.pop();
  try{ const current = layers[last.layerIndex].canvas.toDataURL('image/png'); redoStack.push({layerIndex:last.layerIndex,dataUrl:current}); }catch(e){}
  await restoreSnapshot(last);
  updateLayersPanel();
});
redoBtn.addEventListener('click', async ()=>{
  if(redoStack.length===0) return;
  const next = redoStack.pop();
  try{ const current = layers[next.layerIndex].canvas.toDataURL('image/png'); history.push({layerIndex:next.layerIndex,dataUrl:current}); }catch(e){}
  await restoreSnapshot(next);
  updateLayersPanel();
});

/* ========= 도구: 페인트통 / 지우개 ========= */
fillBtn.addEventListener('click', ()=>{
  if(!activeLayer) return;
  activeLayer.ctx.save();
  activeLayer.ctx.fillStyle = colorPicker.value;
  activeLayer.ctx.fillRect(0,0,activeLayer.canvas.width,activeLayer.canvas.height);
  activeLayer.ctx.restore();
  saveHistory();
});
eraserBtn.addEventListener('click', ()=>{
  usingEraser = !usingEraser;
  eraserBtn.style.background = usingEraser ? '#ddd' : '';
});

/* ========= 그리기 이벤트 (pointer 통합) ========= */
function attachDrawingEvents(canvas){
  let drawing = false;
  let pointerId = null;
  let last = {x:0,y:0};

  function toPos(clientX, clientY){
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }
  function down(e){
    if(e.target.tagName==='BUTTON') return;
    if(e.pointerId !== undefined) e.preventDefault && e.preventDefault();
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    drawing = true;
    last = toPos(e.clientX, e.clientY);
    if(activeLayer){
      const ctx = activeLayer.ctx;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
    }
  }
  function move(e){
    if(!drawing || e.pointerId !== pointerId) return;
    const p = toPos(e.clientX, e.clientY);
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
  function up(e){
    if(e.pointerId !== undefined && e.pointerId !== pointerId) return;
    canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId);
    pointerId = null;
    drawing = false;
    saveHistory();
  }

  canvas.addEventListener('pointerdown', down, { passive:false });
  canvas.addEventListener('pointermove', move, { passive:false });
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', (e)=>{ if(drawing && e.pointerId === pointerId) up(e); });
}

/* ========= 저장 / 갤러리 ========= */
saveBtn.addEventListener('click', ()=>{
  const tmp = document.createElement('canvas');
  tmp.width = container.clientWidth;
  tmp.height = container.clientHeight;
  const tctx = tmp.getContext('2d');
  layers.forEach(l=>{ if(l.visible) tctx.drawImage(l.canvas,0,0); });
  const data = tmp.toDataURL('image/png');
  const link = document.createElement('a');
  link.download='drawing.png'; link.href=data; link.click();
  const thumb = document.createElement('img');
  thumb.src = data; thumb.className = 'gallery-item';
  thumb.addEventListener('click', ()=>{
    const image = new Image();
    image.onload = ()=>{
      if(!activeLayer) createLayer();
      activeLayer.ctx.clearRect(0,0,activeLayer.canvas.width,activeLayer.canvas.height);
      activeLayer.ctx.drawImage(image,0,0,activeLayer.canvas.width,activeLayer.canvas.height);
      saveHistory();
    };
    image.src = data;
  });
  galleryPanel.appendChild(thumb);
});

/* ========= 레이어 UI 토글 ========= */
toggleLayersBtn.addEventListener('click', ()=>{
  layersPanel.classList.toggle('visible');
  layersPanel.classList.toggle('hidden');
});

/* ========= 레이어 버튼 ========= */
addLayerBtn.addEventListener('click', ()=> createLayer());
mergeLayerBtn.addEventListener('click', ()=> mergeActiveWithNeighbor());

/* ========= 이미지 삽입 (확대/축소 포함) ========= */
imageInput.addEventListener('change', (e)=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const img = new Image();
  img.onload = ()=> openImageOverlay(img);
  img.src = URL.createObjectURL(f);
  imageInput.value = '';
});

function openImageOverlay(image){
  const wrapper = document.createElement('div');
  wrapper.className = 'image-overlay-wrapper';
  wrapper.style.position = 'absolute';
  wrapper.style.inset = '0';
  wrapper.style.zIndex = '5000';
  container.appendChild(wrapper);

  const overlay = document.createElement('canvas');
  overlay.className = 'image-overlay-canvas';
  overlay.width = container.clientWidth;
  overlay.height = container.clientHeight;
  wrapper.appendChild(overlay);
  const octx = overlay.getContext('2d');

  const src = document.createElement('canvas');
  src.width = image.width;
  src.height = image.height;
  src.getContext('2d').drawImage(image,0,0);

  let scale = Math.min(overlay.width / image.width, overlay.height / image.height);
  if(!isFinite(scale) || scale<=0) scale = 1;
  let angle = 0;
  let pos = { x: (overlay.width - image.width*scale)/2, y: (overlay.height - image.height*scale)/2 };

  let dragging = false;
  let lastPt = null;
  let pinch = { active:false, startDist:0, startScale:1, startAngle:0, startRot:0, center:{x:0,y:0} };

  function redraw(){
    octx.clearRect(0,0,overlay.width,overlay.height);
    octx.save();
    octx.translate(pos.x + (image.width*scale)/2, pos.y + (image.height*scale)/2);
    octx.rotate(angle * Math.PI / 180);
    octx.drawImage(src, -image.width*scale/2, -image.height*scale/2, image.width*scale, image.height*scale);
    octx.restore();
  }
  redraw();

  function getPointFromMouse(e){
    const rect = overlay.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function getPointFromTouch(touch, rect){
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }
  function distance(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
  function midpoint(a,b){ return { x:(a.x+b.x)/2, y:(a.y+b.y)/2 }; }
  function angleBetween(a,b){ return Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI; }

  /* mouse pan */
  overlay.addEventListener('mousedown', (e)=>{
    if(e.target.tagName === 'BUTTON') return;
    dragging = true;
    lastPt = getPointFromMouse(e);
  });
  window.addEventListener('mousemove', (e)=>{
    if(!dragging) return;
    const p = getPointFromMouse(e);
    pos.x += p.x - lastPt.x;
    pos.y += p.y - lastPt.y;
    lastPt = p;
    redraw();
  });
  window.addEventListener('mouseup', ()=>{ dragging = false; });

  /* wheel zoom (mouse) */
  overlay.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cx = (mx - pos.x) / scale;
    const cy = (my - pos.y) / scale;
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    scale *= factor;
    scale = Math.max(0.05, Math.min(scale, 20));
    pos.x = mx - cx * scale;
    pos.y = my - cy * scale;
    redraw();
  }, { passive:false });

  /* touch: pan & pinch (zoom+rotate) */
  overlay.addEventListener('touchstart', (e)=>{
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    if(e.touches.length === 1){
      dragging = true;
      lastPt = getPointFromTouch(e.touches[0], rect);
    } else if(e.touches.length >= 2){
      pinch.active = true;
      const a = getPointFromTouch(e.touches[0], rect);
      const b = getPointFromTouch(e.touches[1], rect);
      pinch.startDist = distance(a,b);
      pinch.startScale = scale;
      pinch.startAngle = angleBetween(a,b);
      pinch.startRot = angle;
      pinch.center = midpoint(a,b);
    }
  }, { passive:false });

  overlay.addEventListener('touchmove', (e)=>{
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    if(pinch.active && e.touches.length >= 2){
      const a = getPointFromTouch(e.touches[0], rect);
      const b = getPointFromTouch(e.touches[1], rect);
      const newDist = distance(a,b);
      const newAngle = angleBetween(a,b);
      const center = midpoint(a,b);

      const factor = newDist / pinch.startDist;
      scale = pinch.startScale * factor;
      scale = Math.max(0.05, Math.min(scale, 20));

      // rotation delta
      const deltaAngle = newAngle - pinch.startAngle;
      angle = pinch.startRot + deltaAngle;

      // adjust pos so the center stays under fingers
      const imgCx = (center.x - pos.x) / pinch.startScale;
      const imgCy = (center.y - pos.y) / pinch.startScale;
      pos.x = center.x - imgCx * scale;
      pos.y = center.y - imgCy * scale;

      redraw();
    } else if(dragging && e.touches.length === 1){
      const p = getPointFromTouch(e.touches[0], rect);
      pos.x += p.x - lastPt.x;
      pos.y += p.y - lastPt.y;
      lastPt = p;
      redraw();
    }
  }, { passive:false });

  overlay.addEventListener('touchend', (e)=>{
    if(e.touches.length < 2) pinch.active = false;
    if(e.touches.length === 0) dragging = false;
  });

  /* controls area (confirm/cancel/zoom in/out/rotate) */
  const controls = document.createElement('div');
  controls.className = 'image-overlay-controls';
  const btnZoomOut = document.createElement('button'); btnZoomOut.textContent = '−';
  const btnZoomIn  = document.createElement('button'); btnZoomIn.textContent = '+';
  const btnRotateL = document.createElement('button'); btnRotateL.textContent = '⤺';
  const btnRotateR = document.createElement('button'); btnRotateR.textContent = '⤽';
  const btnCancel  = document.createElement('button'); btnCancel.textContent = '취소';
  const btnConfirm = document.createElement('button'); btnConfirm.textContent = '삽입';
  controls.appendChild(btnZoomOut);
  controls.appendChild(btnZoomIn);
  controls.appendChild(btnRotateL);
  controls.appendChild(btnRotateR);
  controls.appendChild(btnCancel);
  controls.appendChild(btnConfirm);
  wrapper.appendChild(controls);

  btnZoomIn.addEventListener('click', ()=>{
    // zoom toward center
    const cx = overlay.width/2, cy = overlay.height/2;
    const ix = (cx - pos.x) / scale, iy = (cy - pos.y) / scale;
    scale *= 1.15;
    scale = Math.min(20, scale);
    pos.x = cx - ix * scale;
    pos.y = cy - iy * scale;
    redraw();
  });
  btnZoomOut.addEventListener('click', ()=>{
    const cx = overlay.width/2, cy = overlay.height/2;
    const ix = (cx - pos.x) / scale, iy = (cy - pos.y) / scale;
    scale *= 0.87;
    scale = Math.max(0.05, scale);
    pos.x = cx - ix * scale;
    pos.y = cy - iy * scale;
    redraw();
  });
  btnRotateL.addEventListener('click', ()=>{ angle -= 15; redraw(); });
  btnRotateR.addEventListener('click', ()=>{ angle += 15; redraw(); });

  btnCancel.addEventListener('click', ()=>{
    if(wrapper.parentElement) container.removeChild(wrapper);
  });

  btnConfirm.addEventListener('click', ()=>{
    if(!activeLayer) createLayer();
    // draw transformed image onto activeLayer
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x + (image.width*scale)/2, pos.y + (image.height*scale)/2);
    activeLayer.ctx.rotate(angle * Math.PI / 180);
    activeLayer.ctx.drawImage(src, -image.width*scale/2, -image.height*scale/2, image.width*scale, image.height*scale);
    activeLayer.ctx.restore();
    saveHistory();
    if(wrapper.parentElement) container.removeChild(wrapper);
  });

  // keyboard for overlay: +/- and Esc
  function overlayKeyHandler(ev){
    if(ev.key === '+' || ev.key === '='){ btnZoomIn.click(); ev.preventDefault(); }
    if(ev.key === '-') { btnZoomOut.click(); ev.preventDefault(); }
    if(ev.key === 'Escape'){ btnCancel.click(); ev.preventDefault(); }
  }
  window.addEventListener('keydown', overlayKeyHandler);

  // cleanup: remove overlayKeyHandler on remove
  const observer = new MutationObserver(()=>{ if(!document.body.contains(wrapper)){ window.removeEventListener('keydown', overlayKeyHandler); observer.disconnect(); } });
  observer.observe(document.body, { childList:true, subtree:true });

  redraw();
}

/* ========= 단축키: Ctrl+Z / Ctrl+Y ========= */
window.addEventListener('keydown',(e)=>{
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'z'){ e.preventDefault(); undoBtn.click(); }
  if((e.ctrlKey||e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase()==='z'))){ e.preventDefault(); redoBtn.click(); }
});

/* ========= 보장: 최소 1 레이어 ========= */
if(layers.length === 0) createLayer('Layer 1');
updateLayersPanel();
drawLayers();
