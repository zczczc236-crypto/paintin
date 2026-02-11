/* ========= 기본 DOM 요소 ========= */
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
let layers = []; // [{canvas, ctx, name, brightness, visible}]
let activeLayer = null;
let history = []; // [{layerIndex, img}]
let redoStack = [];
let isFilling = false;
let usingEraser = false;

/* ========= 초기화 ========= */
for(let i=1;i<=20;i++){
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  brushSelect.appendChild(opt);
}
brushSelect.value = 5;

window.addEventListener('load', () => {
  createLayer('Layer 1');
  resizeContainerCanvases();
});
window.addEventListener('resize', resizeContainerCanvases);

/* ========= 캔버스/레이어 유틸 ========= */
function resizeContainerCanvases(){
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer => {
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tmp.getContext('2d').drawImage(layer.canvas,0,0);
    layer.canvas.width = w;
    layer.canvas.height = h;
    layer.ctx.drawImage(tmp,0,0, tmp.width, tmp.height, 0,0, w, h);
  });
}

/* ========= 히스토리: snapshot push/pop ========= */
function pushHistorySnapshot(layer){
  if(!layer) return;
  try {
    const img = layer.ctx.getImageData(0,0,layer.canvas.width,layer.canvas.height);
    history.push({layerIndex: layers.indexOf(layer), img});
    if(history.length > 300) history.shift();
    // clear redo on new action
    redoStack = [];
  } catch(e){
    console.warn('pushHistorySnapshot error', e);
  }
}

function undo(){
  if(history.length === 0) return;
  const state = history.pop();
  const layer = layers[state.layerIndex];
  if(!layer) return;
  try {
    const current = layer.ctx.getImageData(0,0,layer.canvas.width,layer.canvas.height);
    redoStack.push({layerIndex: state.layerIndex, img: current});
    layer.ctx.putImageData(state.img, 0, 0);
    // if activeLayer was different, keep active selection
    updateLayersPanel();
  } catch(e){
    console.warn('undo error', e);
  }
}

function redo(){
  if(redoStack.length === 0) return;
  const state = redoStack.pop();
  const layer = layers[state.layerIndex];
  if(!layer) return;
  try {
    const current = layer.ctx.getImageData(0,0,layer.canvas.width,layer.canvas.height);
    history.push({layerIndex: state.layerIndex, img: current});
    layer.ctx.putImageData(state.img, 0, 0);
    updateLayersPanel();
  } catch(e){
    console.warn('redo error', e);
  }
}

/* ========= 레이어 생성/삭제/이동/합체 ========= */
function createLayer(name='Layer'){
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth || 800;
  canvas.height = container.clientHeight || 600;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.zIndex = layers.length; // simple stacking
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const layer = {canvas, ctx, name, brightness:1, visible:true};
  layers.push(layer);
  activeLayer = layer;
  attachDrawingEvents(canvas);
  updateLayersPanel();
  drawLayers();
  // store initial empty snapshot for undo baseline
  pushHistorySnapshot(layer);
  return layer;
}

function deleteLayer(layer){
  if(layers.length <= 1) return;
  try {
    container.removeChild(layer.canvas);
  } catch(e){}
  layers = layers.filter(l => l !== layer);
  if(activeLayer === layer) activeLayer = layers[layers.length - 1];
  updateLayersPanel();
  drawLayers();
}

function moveLayer(layer, dir){
  const idx = layers.indexOf(layer);
  if(idx === -1) return;
  const newIdx = idx + dir;
  if(newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  // reappend canvases in order to reflect stacking
  layers.forEach((l, i) => {
    l.canvas.style.zIndex = i;
    container.appendChild(l.canvas);
  });
  updateLayersPanel();
  drawLayers();
}

/* merge active into neighbor (below preferred) */
function mergeActiveWithNeighbor(){
  if(layers.length < 2 || !activeLayer) return;
  const idx = layers.indexOf(activeLayer);
  let targetIdx = idx - 1;
  if(targetIdx < 0) targetIdx = idx + 1;
  if(targetIdx < 0 || targetIdx >= layers.length) return;
  const target = layers[targetIdx];
  // push snapshot of target before merge
  pushHistorySnapshot(target);
  // draw active onto target preserving dimensions
  target.ctx.drawImage(activeLayer.canvas, 0,0);
  deleteLayer(activeLayer);
  activeLayer = target;
  updateLayersPanel();
  drawLayers();
}

/* draw visibility + brightness */
function drawLayers(){
  layers.forEach(layer => {
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    layer.canvas.style.filter = `brightness(${layer.brightness})`;
  });
}

/* layers panel */
function updateLayersPanel(){
  layersPanel.innerHTML = '';
  // show topmost first
  const items = layers.slice().reverse();
  items.forEach((layer, revIdx) => {
    const idx = layers.length - 1 - revIdx;
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer === activeLayer ? ' active' : '');
    item.dataset.index = idx;

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
    visBtn.title = '가시성';

    const upBtn = document.createElement('button');
    upBtn.textContent = '⬆️';
    upBtn.title = '위로';

    const downBtn = document.createElement('button');
    downBtn.textContent = '⬇️';
    downBtn.title = '아래로';

    const delBtn = document.createElement('button');
    delBtn.textContent = '❌';
    delBtn.title = '삭제';

    controls.appendChild(visBtn);
    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(delBtn);

    item.appendChild(name);
    item.appendChild(range);
    item.appendChild(controls);

    item.addEventListener('click', (ev) => {
      if(ev.target.tagName === 'BUTTON' || ev.target.tagName === 'INPUT') return;
      activeLayer = layer;
      updateLayersPanel();
    });

    range.addEventListener('input', (e) => {
      layer.brightness = parseFloat(range.value);
      drawLayers();
    });

    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      visBtn.textContent = layer.visible ? '👁' : '🚫';
      drawLayers();
    });

    upBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveLayer(layer, +1);
    });

    downBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveLayer(layer, -1);
    });

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteLayer(layer);
    });

    layersPanel.appendChild(item);
  });
}

/* ========= 도구: 페인트통/지우개/취소/되돌리기 동작 연결 ========= */
fillBtn.addEventListener('click', () => {
  if(!activeLayer) return;
  pushHistorySnapshot(activeLayer);
  activeLayer.ctx.save();
  activeLayer.ctx.fillStyle = colorPicker.value;
  activeLayer.ctx.fillRect(0,0, activeLayer.canvas.width, activeLayer.canvas.height);
  activeLayer.ctx.restore();
});

eraserBtn.addEventListener('click', () => {
  usingEraser = !usingEraser;
  eraserBtn.style.background = usingEraser ? '#ddd' : '';
});

undoBtn.addEventListener('click', () => undo());
redoBtn.addEventListener('click', () => redo());

zoomOutBtn.addEventListener('click', () => {
  container.style.transform = 'scale(0.5)';
  container.style.transformOrigin = '0 0';
});

/* ========= 저장/갤러리 ========= */
saveBtn.addEventListener('click', () => {
  const tmp = document.createElement('canvas');
  tmp.width = container.clientWidth;
  tmp.height = container.clientHeight;
  const tctx = tmp.getContext('2d');
  layers.forEach(layer => {
    if(layer.visible) tctx.drawImage(layer.canvas, 0,0);
  });
  const data = tmp.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = 'drawing.png';
  link.href = data;
  link.click();
  addGalleryThumbnail(data);
});

function addGalleryThumbnail(src){
  const img = document.createElement('img');
  img.src = src;
  img.className = 'gallery-item';
  img.title = '불러오기';
  img.addEventListener('click', () => {
    const image = new Image();
    image.onload = () => {
      if(!activeLayer) createLayer('Layer '+(layers.length+1));
      pushHistorySnapshot(activeLayer);
      activeLayer.ctx.drawImage(image, 0,0, activeLayer.canvas.width, activeLayer.canvas.height);
      pushHistorySnapshot(activeLayer); // capture after
    };
    image.src = src;
  });
  galleryPanel.appendChild(img);
}

/* ========= 레이어 창 토글 ========= */
toggleLayersBtn.addEventListener('click', () => {
  layersPanel.classList.toggle('visible');
  layersPanel.setAttribute('aria-hidden', !layersPanel.classList.contains('visible'));
});

/* ========= 레이어 추가/합체 버튼 연결 ========= */
addLayerBtn.addEventListener('click', () => createLayer('Layer '+(layers.length+1)));
mergeLayerBtn.addEventListener('click', () => mergeActiveWithNeighbor());

/* ========= 그리기 이벤트 (마우스 + 터치) ========= */
function attachDrawingEvents(canvas){
  let drawing = false;
  let last = {x:0,y:0};

  function pointerToPos(ev){
    const rect = container.getBoundingClientRect();
    if(ev.touches && ev.touches.length > 0){
      return {x: ev.touches[0].clientX - rect.left, y: ev.touches[0].clientY - rect.top};
    } else if(ev.clientX !== undefined){
      return {x: ev.clientX - rect.left, y: ev.clientY - rect.top};
    }
    return null;
  }

  function start(e){
    if(!activeLayer) return;
    const pos = pointerToPos(e);
    if(!pos) return;
    e.preventDefault();
    // snapshot before the change
    pushHistorySnapshot(activeLayer);
    last = pos;
    drawing = true;
  }

  function move(e){
    if(!drawing || !activeLayer) return;
    const pos = pointerToPos(e);
    if(!pos) return;
    e.preventDefault();
    const ctx = activeLayer.ctx;
    ctx.save();
    ctx.globalCompositeOperation = usingEraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = parseFloat(brushSelect.value);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.restore();
    last = pos;
  }

  function end(e){
    if(drawing && activeLayer){
      // snapshot after is already captured via previous push; to allow redo we push current state as another history entry (so undo restores previous)
      pushHistorySnapshot(activeLayer);
    }
    drawing = false;
  }

  // mouse
  canvas.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move, {passive:false});
  window.addEventListener('mouseup', end);

  // touch
  canvas.addEventListener('touchstart', start, {passive:false});
  canvas.addEventListener('touchmove', move, {passive:false});
  canvas.addEventListener('touchend', end);
}

/* ========= 이미지 삽입 (PC 마우스 + 모바일 터치 모두) ========= */
imageInput.addEventListener('change', (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if(!file) return;
  const img = new Image();
  img.onload = () => {
    openImageEditorOverlay(img);
  };
  img.src = URL.createObjectURL(file);
  imageInput.value = '';
});

function openImageEditorOverlay(image){
  // overlay canvas
  const overlay = document.createElement('canvas');
  overlay.width = container.clientWidth;
  overlay.height = container.clientHeight;
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.zIndex = 2000;
  overlay.style.touchAction = 'none';
  container.appendChild(overlay);
  const octx = overlay.getContext('2d');

  // source canvas
  const src = document.createElement('canvas');
  src.width = image.width;
  src.height = image.height;
  const sctx = src.getContext('2d');
  sctx.drawImage(image, 0,0);

  // transform state
  let scale = Math.min( Math.min(overlay.width / image.width, overlay.height / image.height), 1 );
  let angle = 0;
  let pos = { x: (overlay.width - image.width*scale)/2, y: (overlay.height - image.height*scale)/2 };

  // gesture
  let dragging = false;
  let lastPointer = null;
  let lastDist = 0;
  let lastAngle = 0;

  function draw(){
    octx.clearRect(0,0,overlay.width, overlay.height);
    octx.save();
    octx.translate(pos.x + (image.width*scale)/2, pos.y + (image.height*scale)/2);
    octx.rotate(angle * Math.PI / 180);
    octx.drawImage(src, - (image.width*scale)/2, - (image.height*scale)/2, image.width*scale, image.height*scale);
    octx.restore();
  }
  draw();

  function getPointFromEvent(e, idx=0){
    const rect = container.getBoundingClientRect();
    if(e.touches && e.touches.length > idx){
      return {x: e.touches[idx].clientX - rect.left, y: e.touches[idx].clientY - rect.top};
    } else if(e.clientX !== undefined){
      return {x: e.clientX - rect.left, y: e.clientY - rect.top};
    }
    return null;
  }
  function distance(a,b){
    return Math.hypot(a.x-b.x, a.y-b.y);
  }
  function angleDeg(a,b){
    return Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI;
  }

  // mouse handlers
  overlay.addEventListener('mousedown', (e) => {
    dragging = true;
    lastPointer = getPointFromEvent(e);
  });
  window.addEventListener('mousemove', (e) => {
    if(!dragging) return;
    const p = getPointFromEvent(e);
    if(!p) return;
    pos.x += p.x - lastPointer.x;
    pos.y += p.y - lastPointer.y;
    lastPointer = p;
    draw();
  });
  window.addEventListener('mouseup', () => {
    if(dragging) {
      dragging = false;
    }
  });

  // touch handlers
  overlay.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if(e.touches.length === 1){
      lastPointer = getPointFromEvent(e,0);
      dragging = true;
    } else if(e.touches.length >= 2){
      const p1 = getPointFromEvent(e,0);
      const p2 = getPointFromEvent(e,1);
      lastDist = distance(p1,p2);
      lastAngle = angleDeg(p1,p2);
      dragging = false;
    }
  }, {passive:false});

  overlay.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if(e.touches.length === 1 && dragging){
      const p = getPointFromEvent(e,0);
      pos.x += p.x - lastPointer.x;
      pos.y += p.y - lastPointer.y;
      lastPointer = p;
    } else if(e.touches.length >= 2){
      const p1 = getPointFromEvent(e,0);
      const p2 = getPointFromEvent(e,1);
      const newDist = distance(p1,p2);
      const newAngle = angleDeg(p1,p2);
      if(lastDist > 0){
        const factor = newDist / lastDist;
        scale *= factor;
        scale = Math.max(0.05, Math.min(scale, 20));
      }
      angle += newAngle - lastAngle;
      lastDist = newDist;
      lastAngle = newAngle;
    }
    draw();
  }, {passive:false});

  overlay.addEventListener('touchend', (e) => {
    if(e.touches.length === 0) dragging = false;
  });

  // wheel zoom
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.08 : 0.92;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cx = (mx - pos.x) / scale;
    const cy = (my - pos.y) / scale;
    scale *= delta;
    scale = Math.max(0.05, Math.min(scale, 50));
    pos.x = mx - cx * scale;
    pos.y = my - cy * scale;
    draw();
  }, {passive:false});

  // action buttons
  const actions = document.createElement('div');
  actions.className = 'overlay-action';
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '✔';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✖';
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  document.body.appendChild(actions);

  confirmBtn.addEventListener('click', () => {
    if(!activeLayer) createLayer('Layer '+(layers.length+1));
    // snapshot before
    pushHistorySnapshot(activeLayer);
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x + (image.width*scale)/2, pos.y + (image.height*scale)/2);
    activeLayer.ctx.rotate(angle * Math.PI / 180);
    activeLayer.ctx.drawImage(src, - (image.width*scale)/2, - (image.height*scale)/2, image.width*scale, image.height*scale);
    activeLayer.ctx.restore();
    // snapshot after
    pushHistorySnapshot(activeLayer);
    cleanup();
  });

  cancelBtn.addEventListener('click', cleanup);

  function cleanup(){
    if(overlay && overlay.parentElement) container.removeChild(overlay);
    if(actions && actions.parentElement) document.body.removeChild(actions);
    // no anonymous window listeners left that are problematic (they check flags)
  }
}

/* ========= 키보드 단축 (안전) ========= */
window.addEventListener('keydown', (e) => {
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'){
    e.preventDefault();
    undo();
  }
  if((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase()==='z'))){
    e.preventDefault();
    redo();
  }
});

/* ========= 초기화 UI 갱신 ========= */
updateLayersPanel();
drawLayers();
