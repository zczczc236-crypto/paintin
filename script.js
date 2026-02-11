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
let history = []; // [{layer, imageData}]
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
  resizeContainerCanvases();
  createLayer('Layer 1');
});
window.addEventListener('resize', resizeContainerCanvases);

/* ========= 캔버스/레이어 유틸 ========= */
function resizeContainerCanvases(){
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer => {
    // 보존하면서 크기 조정: 임시 캔버스에 복사
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tmp.getContext('2d').drawImage(layer.canvas,0,0);
    layer.canvas.width = w;
    layer.canvas.height = h;
    layer.ctx.drawImage(tmp,0,0, tmp.width, tmp.height, 0,0, w, h);
  });
}

/* 레이어 생성 */
function createLayer(name='Layer'){
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth || 800;
  canvas.height = container.clientHeight || 600;
  canvas.style.zIndex = layers.length; // stacking order via append
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const layer = {canvas, ctx, name, brightness:1, visible:true};
  layers.push(layer);
  activeLayer = layer;
  updateLayersPanel();
  attachDrawingEvents(canvas);
  drawLayers();
  // 초기 빈 상태를 히스토리에 넣어둠 (undo 가능한 초기화)
  saveHistory();
  return layer;
}

/* 레이어 삭제 */
function deleteLayer(layer){
  if(layers.length <= 1) return;
  container.removeChild(layer.canvas);
  layers = layers.filter(l => l !== layer);
  if(activeLayer === layer) activeLayer = layers[layers.length - 1];
  updateLayersPanel();
}

/* 레이어 이동: dir -1 up, +1 down */
function moveLayer(layer, dir){
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if(newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  // re-append canvases in order to keep stacking visually correct
  layers.forEach(l => container.appendChild(l.canvas));
  updateLayersPanel();
}

/* 레이어 합치기: active와 아래 레이어 합치기 (아래가 없으면 상단과 합치기) */
function mergeActiveWithNeighbor(){
  if(layers.length < 2) return;
  const idx = layers.indexOf(activeLayer);
  let targetIdx = idx - 1;
  if(targetIdx < 0) targetIdx = idx + 1;
  if(targetIdx < 0 || targetIdx >= layers.length) return;
  const target = layers[targetIdx];
  // target 위에 active (혹은 active 위에 target) 그리기. 항상 아래쪽에 그리는 방식 유지:
  target.ctx.drawImage(activeLayer.canvas, 0,0);
  deleteLayer(activeLayer);
  activeLayer = target;
  saveHistory();
  updateLayersPanel();
}

/* 레이어 그리기(가시성/명도) */
function drawLayers(){
  layers.forEach((layer, i) => {
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    layer.canvas.style.filter = `brightness(${layer.brightness})`;
  });
}

/* 레이어 패널 업데이트 */
function updateLayersPanel(){
  layersPanel.innerHTML = '';
  layers.slice().reverse().forEach((layer, revIdx) => {
    // show top-most first => reverse mapping
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
    range.title = '명도';

    const visBtn = document.createElement('button');
    visBtn.textContent = layer.visible ? '👁' : '🚫';
    visBtn.title = '가시성';

    const delBtn = document.createElement('button');
    delBtn.textContent = '❌';
    delBtn.title = '삭제';

    const upBtn = document.createElement('button');
    upBtn.textContent = '⬆️';
    upBtn.title = '위로';

    const downBtn = document.createElement('button');
    downBtn.textContent = '⬇️';
    downBtn.title = '아래로';

    const controls = document.createElement('div');
    controls.className = 'layer-controls';
    controls.appendChild(visBtn);
    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(delBtn);

    item.appendChild(name);
    item.appendChild(range);
    item.appendChild(controls);

    // events
    item.addEventListener('click', (ev) => {
      // prevent clicks on buttons from toggling active twice
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
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteLayer(layer);
    });
    upBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveLayer(layer, +1); // visually move toward top
    });
    downBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveLayer(layer, -1); // move down
    });

    layersPanel.appendChild(item);
  });
}

/* ========= 히스토리 (레이어 단위) ========= */
function saveHistory(){
  // 캡쳐하는 레이어의 전체 픽데이터를 저장
  if(!activeLayer) return;
  try {
    const img = activeLayer.ctx.getImageData(0,0, activeLayer.canvas.width, activeLayer.canvas.height);
    history.push({layer: activeLayer, img});
    // 제한: 메모리 과다 방지(간단한 정책)
    if(history.length > 100) history.shift();
    redoStack = [];
  } catch(e) {
    // 보안/사이즈 에러 방지
    console.warn('saveHistory error:', e);
  }
}

undoBtn.addEventListener('click', () => {
  if(history.length === 0) return;
  const last = history.pop();
  try {
    const currentSnapshot = last.layer.ctx.getImageData(0,0,last.layer.canvas.width,last.layer.canvas.height);
    redoStack.push({layer: last.layer, img: currentSnapshot});
    last.layer.ctx.putImageData(last.img,0,0);
  } catch(e) {
    console.warn('undo error', e);
  }
});

redoBtn.addEventListener('click', () => {
  if(redoStack.length === 0) return;
  const next = redoStack.pop();
  try {
    const curSnapshot = next.layer.ctx.getImageData(0,0,next.layer.canvas.width,next.layer.canvas.height);
    history.push({layer: next.layer, img: curSnapshot});
    next.layer.ctx.putImageData(next.img,0,0);
  } catch(e) {
    console.warn('redo error', e);
  }
});

/* ========= 도구 이벤트 (브러시, 페인트통, 지우개 등) ========= */
fillBtn.addEventListener('click', () => {
  if(!activeLayer) return;
  isFilling = true;
  // immediate fill will be handled on next pointer start
});
eraserBtn.addEventListener('click', () => {
  usingEraser = !usingEraser;
  eraserBtn.style.background = usingEraser ? '#ddd' : '';
});

/* ========= 그리기 이벤트 (마우스 + 터치) ========= */
function attachDrawingEvents(canvas){
  let drawing = false;
  let last = {x:0,y:0};

  function pointerToPos(ev){
    const rect = container.getBoundingClientRect();
    let clientX, clientY;
    if(ev.touches && ev.touches.length > 0){
      clientX = ev.touches[0].clientX;
      clientY = ev.touches[0].clientY;
    } else if(ev.clientX !== undefined){
      clientX = ev.clientX;
      clientY = ev.clientY;
    } else return null;
    return {x: clientX - rect.left, y: clientY - rect.top};
  }

  function start(e){
    e.preventDefault();
    if(!activeLayer) return;
    const pos = pointerToPos(e);
    if(!pos) return;
    last = pos;
    drawing = true;
    if(isFilling){
      activeLayer.ctx.save();
      activeLayer.ctx.fillStyle = colorPicker.value;
      activeLayer.ctx.fillRect(0,0, activeLayer.canvas.width, activeLayer.canvas.height);
      activeLayer.ctx.restore();
      saveHistory();
      isFilling = false;
    }
  }
  function move(e){
    if(!drawing || !activeLayer) return;
    e.preventDefault();
    const pos = pointerToPos(e);
    if(!pos) return;
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
    if(drawing){
      saveHistory();
    }
    drawing = false;
  }

  // 마우스 events
  canvas.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move, {passive:false});
  window.addEventListener('mouseup', end);

  // 터치 events
  canvas.addEventListener('touchstart', start, {passive:false});
  canvas.addEventListener('touchmove', move, {passive:false});
  canvas.addEventListener('touchend', end);
}

/* ========= 유틸: 좌표 변환 ========= */
function getPosFromEvent(e){
  const rect = container.getBoundingClientRect();
  if(e.touches && e.touches[0]) e = e.touches[0];
  return {x: e.clientX - rect.left, y: e.clientY - rect.top};
}

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
      activeLayer.ctx.drawImage(image, 0,0, activeLayer.canvas.width, activeLayer.canvas.height);
      saveHistory();
    };
    image.src = src;
  });
  galleryPanel.appendChild(img);
}

/* ========= 레이어 토글 UI ========= */
toggleLayersBtn.addEventListener('click', () => {
  layersPanel.classList.toggle('visible');
  layersPanel.setAttribute('aria-hidden', !layersPanel.classList.contains('visible'));
});

/* ========= 레이어 추가 버튼 ========= */
addLayerBtn.addEventListener('click', () => {
  createLayer('Layer '+(layers.length+1));
});

/* ========= 레이어 합체 ========= */
mergeLayerBtn.addEventListener('click', () => {
  mergeActiveWithNeighbor();
});

/* ========= 레이어 삭제 / 이동 버튼은 updateLayersPanel에서 처리 ========= */

/* ========= 이미지 삽입 (PC 마우스 + 모바일 터치 모두) ========= */
imageInput.addEventListener('change', (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if(!file) return;
  const img = new Image();
  img.onload = () => {
    openImageEditorOverlay(img);
  };
  img.src = URL.createObjectURL(file);
  // clear input so same file can be chosen again
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

  // temporary image canvas for drawing transformations
  const src = document.createElement('canvas');
  src.width = image.width;
  src.height = image.height;
  const sctx = src.getContext('2d');
  sctx.drawImage(image, 0,0);

  // transform state
  let scale = Math.min( Math.min(overlay.width / image.width, overlay.height / image.height), 1 );
  let angle = 0; // degrees
  let pos = { x: (overlay.width - image.width*scale)/2, y: (overlay.height - image.height*scale)/2 };

  // gesture state
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

  /* pointer utilities for mouse/touch */
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

  /* mouse handlers */
  overlay.addEventListener('mousedown', (e) => {
    dragging = true;
    lastPointer = getPointFromEvent(e);
  });
  window.addEventListener('mousemove', (e) => {
    if(!dragging) return;
    const p = getPointFromEvent(e);
    pos.x += p.x - lastPointer.x;
    pos.y += p.y - lastPointer.y;
    lastPointer = p;
    draw();
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
    saveOverlayPreview();
  });

  /* touch handlers for pan/zoom/rotate */
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

      // scale relative change
      if(lastDist > 0){
        const factor = newDist / lastDist;
        scale *= factor;
        // limit scale
        scale = Math.max(0.05, Math.min(scale, 10));
      }
      // rotation delta
      angle += newAngle - lastAngle;

      lastDist = newDist;
      lastAngle = newAngle;
    }
    draw();
  }, {passive:false});

  overlay.addEventListener('touchend', (e) => {
    if(e.touches.length === 0){
      dragging = false;
    }
  });

  /* mouse wheel for zoom */
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.05 : 0.95;
    // zoom toward pointer
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // convert to image local coords
    const cx = (mx - pos.x) / scale;
    const cy = (my - pos.y) / scale;
    scale *= delta;
    scale = Math.max(0.05, Math.min(scale, 10));
    // adjust pos so the point under cursor stays under cursor
    pos.x = mx - cx * scale;
    pos.y = my - cy * scale;
    draw();
  }, {passive:false});

  /* overlay action buttons */
  const actions = document.createElement('div');
  actions.className = 'overlay-action';
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '✔';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✖';
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  document.body.appendChild(actions);

  /* commit: draw transformed image to activeLayer */
  confirmBtn.addEventListener('click', () => {
    if(!activeLayer) createLayer('Layer '+(layers.length+1));
    // draw overlay contents (only the image) onto activeLayer at correct transform
    // We'll render image with same transform used on overlay
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x + (image.width*scale)/2, pos.y + (image.height*scale)/2);
    activeLayer.ctx.rotate(angle * Math.PI / 180);
    activeLayer.ctx.drawImage(src, - (image.width*scale)/2, - (image.height*scale)/2, image.width*scale, image.height*scale);
    activeLayer.ctx.restore();
    saveHistory();
    cleanupOverlay();
  });

  cancelBtn.addEventListener('click', () => {
    cleanupOverlay();
  });

  function cleanupOverlay(){
    if(overlay && overlay.parentElement) container.removeChild(overlay);
    if(actions && actions.parentElement) document.body.removeChild(actions);
    // remove event listeners attached to window (mouse move/up)
    // listeners are anonymous; safe to leave, they check dragging flags.
  }

  /* small optimization: save preview state often */
  function saveOverlayPreview(){
    // noop placeholder currently
  }
}

/* ========= 토글 레이어 창 기본 visible 상태 제어 완료 ========= */

/* ========= 기본 레이아웃 준비: 하나의 기본 레이어 보장 ========= */
if(layers.length === 0){
  createLayer('Layer 1');
}

/* ========= 마우스/터치에서 캔버스별 draw 등록 (기존 레이어들 포함) ========= */
layers.forEach(l => attachDrawingEvents(l.canvas));

/* ========= 안전성: 키보드로도 이미지 조작 간단히 지원 (선택 기능) ========= */
window.addEventListener('keydown', (e) => {
  // 예: Ctrl+Z 취소, Ctrl+Y 되돌리기
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'){
    undoBtn.click();
    e.preventDefault();
  }
  if((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase()==='z'))){
    redoBtn.click();
    e.preventDefault();
  }
});

/* ========= 초기 UI 갱신 ========= */
updateLayersPanel();
drawLayers();
