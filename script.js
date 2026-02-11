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
const imageInput = document.getElementById('image-input');
const toggleLayersBtn = document.getElementById('toggle-layers');

let layers = [];
let activeLayer = null;
let history = [];
let redoStack = [];
let isFilling = false;
let usingEraser = false;

for(let i=1;i<=20;i++){
  const opt = document.createElement('option');
  opt.value=i;
  opt.text=i;
  brushSelect.appendChild(opt);
}
brushSelect.value=5;

function createLayer(name='Layer'){
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const layer = {canvas, ctx, name, brightness:1, visible:true};
  layers.push(layer);
  activeLayer = layer;
  updateLayersPanel();
  attachDrawingEvents(canvas);
  drawLayers();
  return layer;
}

function updateLayersPanel(){
  layersPanel.innerHTML='';
  layers.forEach((layer,i)=>{
    const div = document.createElement('div');
    div.className='layer-item';
    div.innerHTML=`<span>${layer.name}</span>
    <input type="range" min="0" max="2" step="0.01" value="${layer.brightness}">
    <button>${layer.visible?'👁':'🚫'}</button>
    <button class="del">❌</button>
    <button class="up">⬆️</button>
    <button class="down">⬇️</button>`;
    const range = div.querySelector('input');
    const btn = div.querySelector('button');
    const delBtn = div.querySelector('.del');
    const upBtn = div.querySelector('.up');
    const downBtn = div.querySelector('.down');

    range.addEventListener('input',()=>{ layer.brightness=parseFloat(range.value); drawLayers(); });
    btn.addEventListener('click',()=>{
      layer.visible=!layer.visible; btn.textContent = layer.visible?'👁':'🚫'; drawLayers();
    });
    delBtn.addEventListener('click',()=>{ deleteLayer(layer); });
    upBtn.addEventListener('click',()=>{ moveLayer(layer, -1); });
    downBtn.addEventListener('click',()=>{ moveLayer(layer,1); });

    div.addEventListener('click',()=>{ activeLayer = layer; });
    layersPanel.appendChild(div);
  });
}

function drawLayers(){
  layers.forEach(layer=>{
    layer.canvas.style.display=layer.visible?'block':'none';
    layer.canvas.style.filter=`brightness(${layer.brightness})`;
  });
}

function attachDrawingEvents(canvas){
  let drawing=false, lastX=0, lastY=0;
  function start(e){
    e.preventDefault();
    const pos = getPos(e);
    lastX=pos.x; lastY=pos.y;
    drawing=true;
    if(isFilling){
      fillCanvas(activeLayer.ctx, colorPicker.value);
      saveHistory();
      isFilling=false;
    }
  }
  function move(e){
    if(!drawing) return;
    const pos = getPos(e);
    activeLayer.ctx.strokeStyle = usingEraser?'#ffffff':colorPicker.value;
    activeLayer.ctx.lineWidth = brushSelect.value;
    activeLayer.ctx.lineCap='round';
    activeLayer.ctx.globalCompositeOperation = usingEraser?'destination-out':'source-over';
    activeLayer.ctx.beginPath();
    activeLayer.ctx.moveTo(lastX,lastY);
    activeLayer.ctx.lineTo(pos.x,pos.y);
    activeLayer.ctx.stroke();
    lastX=pos.x; lastY=pos.y;
    activeLayer.ctx.globalCompositeOperation='source-over';
  }
  function end(){ if(drawing) saveHistory(); drawing=false; }

  canvas.addEventListener('mousedown',start);
  canvas.addEventListener('touchstart',start);
  canvas.addEventListener('mousemove',move);
  canvas.addEventListener('touchmove',move);
  canvas.addEventListener('mouseup',end);
  canvas.addEventListener('touchend',end);
}

function getPos(e){
  const rect = container.getBoundingClientRect();
  if(e.touches) e=e.touches[0];
  return {x:e.clientX-rect.left, y:e.clientY-rect.top};
}

function fillCanvas(ctx,color){
  ctx.fillStyle=color;
  ctx.fillRect(0,0,ctx.canvas.width, ctx.canvas.height);
}

function saveHistory(){
  const img = activeLayer.ctx.getImageData(0,0,activeLayer.canvas.width,activeLayer.canvas.height);
  history.push({layer:activeLayer,img});
  redoStack=[];
}

undoBtn.addEventListener('click',()=>{
  if(history.length==0) return;
  const last = history.pop();
  redoStack.push({layer:last.layer, img:last.layer.ctx.getImageData(0,0,last.layer.canvas.width,last.layer.canvas.height)});
  last.layer.ctx.putImageData(last.img,0,0);
});
redoBtn.addEventListener('click',()=>{
  if(redoStack.length==0) return;
  const next = redoStack.pop();
  history.push({layer:next.layer, img:next.layer.ctx.getImageData(0,0,next.layer.canvas.width,next.layer.canvas.height)});
  next.layer.ctx.putImageData(next.img,0,0);
});

zoomOutBtn.addEventListener('click',()=>{
  container.style.transform='scale(0.5)';
  container.style.transformOrigin='0 0';
});

saveBtn.addEventListener('click',()=>{
  const link=document.createElement('a');
  link.download='drawing.png';
  const tmpCanvas=document.createElement('canvas');
  tmpCanvas.width=container.clientWidth;
  tmpCanvas.height=container.clientHeight;
  const tmpCtx=tmpCanvas.getContext('2d');
  layers.forEach(layer=>{ if(layer.visible) tmpCtx.drawImage(layer.canvas,0,0); });
  link.href=tmpCanvas.toDataURL();
  link.click();
  addGallery(tmpCanvas.toDataURL());
});

function addGallery(src){
  const img = document.createElement('img');
  img.src=src;
  img.className='gallery-item';
  img.addEventListener('click',()=>{ loadGalleryImage(src); });
  galleryPanel.appendChild(img);
}
function loadGalleryImage(src){
  const img = new Image();
  img.onload=()=>{ activeLayer.ctx.drawImage(img,0,0); saveHistory(); };
  img.src=src;
}

addLayerBtn.addEventListener('click',()=>{ createLayer('Layer '+(layers.length+1)); });
eraserBtn.addEventListener('click',()=>{ usingEraser = !usingEraser; });
toggleLayersBtn.addEventListener('click',()=>{ layersPanel.classList.toggle('visible'); });

function deleteLayer(layer){
  if(layers.length<=1) return;
  container.removeChild(layer.canvas);
  layers = layers.filter(l=>l!==layer);
  if(activeLayer===layer) activeLayer=layers[layers.length-1];
  updateLayersPanel();
}

function moveLayer(layer,dir){
  const idx = layers.indexOf(layer);
  let newIdx = idx+dir;
  if(newIdx<0 || newIdx>=layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  layers.forEach(c=>container.appendChild(c.canvas));
  updateLayersPanel();
}

mergeLayerBtn.addEventListener('click',()=>{
  if(layers.length<2) return;
  const top = layers[layers.length-1];
  const below = layers[layers.length-2];
  below.ctx.drawImage(top.canvas,0,0);
  deleteLayer(top);
  saveHistory();
});

imageInput.addEventListener('change',(e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const img = new Image();
  img.onload=()=>{
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width=img.width;
    tempCanvas.height=img.height;
    const tempCtx=tempCanvas.getContext('2d');
    tempCtx.drawImage(img,0,0);

    const overlay = document.createElement('canvas');
    overlay.width=container.clientWidth;
    overlay.height=container.clientHeight;
    overlay.style.position='absolute';
    overlay.style.top='0'; overlay.style.left='0';
    container.appendChild(overlay);
    const octx=overlay.getContext('2d');

    let x=(overlay.width-img.width)/2, y=(overlay.height-img.height)/2;
    let scale=1, angle=0;
    let lastDist=0, lastAngle=0;
    let dragging=false, lastPos={x:0,y:0};

    function drawOverlay(){
      octx.clearRect(0,0,overlay.width,overlay.height);
      octx.save();
      octx.translate(x+tempCanvas.width*scale/2, y+tempCanvas.height*scale/2);
      octx.rotate(angle*Math.PI/180);
      octx.drawImage(tempCanvas, -tempCanvas.width*scale/2, -tempCanvas.height*scale/2, tempCanvas.width*scale, tempCanvas.height*scale);
      octx.restore();
    }
    drawOverlay();

    overlay.addEventListener('touchstart',(e)=>{
      if(e.touches.length==1){
        dragging=true;
        const t=e.touches[0];
        lastPos={x:t.clientX, y:t.clientY};
      }
      if(e.touches.length==2){
        lastDist = getDistance(e.touches[0], e.touches[1]);
        lastAngle = getAngle(e.touches[0], e.touches[1]);
      }
    });
    overlay.addEventListener('touchmove',(e)=>{
      e.preventDefault();
      if(e.touches.length==1 && dragging){
        const t=e.touches[0];
        x += t.clientX-lastPos.x;
        y += t.clientY-lastPos.y;
        lastPos={x:t.clientX, y:t.clientY};
      }
      if(e.touches.length==2){
        const newDist = getDistance(e.touches[0], e.touches[1]);
        const newAngle = getAngle(e.touches[0], e.touches[1]);
        scale *= newDist/lastDist;
        angle += (newAngle-lastAngle);
        lastDist=newDist;
        lastAngle=newAngle;
      }
      drawOverlay();
    });
    overlay.addEventListener('touchend',(e)=>{ if(e.touches.length==0) dragging=false; });

    function getDistance(p1,p2){ return Math.hypot(p2.clientX-p1.clientX, p2.clientY-p1.clientY); }
    function getAngle(p1,p2){ return Math.atan2(p2.clientY-p1.clientY, p2.clientX-p1.clientX)*180/Math.PI; }

    const confirmBtn=document.createElement('button');
    confirmBtn.textContent='✔';
    confirmBtn.style.position='absolute';
    confirmBtn.style.bottom='10px';
    confirmBtn.style.right='10px';
    confirmBtn.style.fontSize='20px';
    confirmBtn.style.zIndex='1000';
    container.appendChild(confirmBtn);

    const cancelBtn=document.createElement('button');
    cancelBtn.textContent='✖';
    cancelBtn.style.position='absolute';
    cancelBtn.style.bottom='10px';
    cancelBtn.style.right='60px';
    cancelBtn.style.fontSize='20px';
    cancelBtn.style.zIndex='1000';
    container.appendChild(cancelBtn);

    confirmBtn.addEventListener('click',()=>{
      activeLayer.ctx.drawImage(overlay,0,0);
      saveHistory();
      container.removeChild(overlay);
      container.removeChild(confirmBtn);
      container.removeChild(cancelBtn);
    });
    cancelBtn.addEventListener('click',()=>{
      container.removeChild(overlay);
      container.removeChild(confirmBtn);
      container.removeChild(cancelBtn);
    });
  };
  img.src=URL.createObjectURL(file);
});

createLayer('Layer 1');
