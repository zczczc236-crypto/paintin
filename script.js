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

let layers = [];
let activeLayer = null;
let history = [];
let redoStack = [];
let usingEraser = false;

/* 브러시 선택 1~20 */
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
  updateLayersPanel();
});
window.addEventListener('resize', resizeContainerCanvases);

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

function createLayer(name){
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  canvas.style.zIndex = layers.length;
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const layer = {canvas, ctx, name: name || 'Layer '+(layers.length+1), brightness:1, visible:true};
  layers.push(layer);
  activeLayer = layer;
  attachDrawingEvents(canvas);
  drawLayers();
  saveHistory();
  updateLayersPanel();
  return layer;
}

function deleteLayer(layer){
  if(layers.length<=1) return;
  const idx = layers.indexOf(layer);
  layers.splice(idx,1);
  if(layer.canvas.parentElement) container.removeChild(layer.canvas);
  if(activeLayer===layer) activeLayer = layers[layers.length-1];
  layers.forEach((l,i)=>{ l.canvas.style.zIndex=i; container.appendChild(l.canvas); });
  updateLayersPanel();
  saveHistory();
}

function moveLayer(layer,dir){
  const idx = layers.indexOf(layer);
  const newIdx = idx+dir;
  if(newIdx<0||newIdx>=layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  layers.forEach((l,i)=>{ l.canvas.style.zIndex=i; container.appendChild(l.canvas); });
  updateLayersPanel();
  saveHistory();
}

function mergeActiveWithNeighbor(){
  if(layers.length<2)return;
  const idx = layers.indexOf(activeLayer);
  let targetIdx=idx-1;
  if(targetIdx<0) targetIdx=idx+1;
  if(targetIdx<0||targetIdx>=layers.length) return;
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
    layer.canvas.style.display=layer.visible?'block':'none';
    layer.canvas.style.filter = `brightness(${layer.brightness})`;
  });
}

function updateLayersPanel(){
  layersPanel.innerHTML='';
  for(let i=layers.length-1;i>=0;i--){
    const layer = layers[i];
    const item = document.createElement('div');
    item.className='layer-item'+(layer===activeLayer?' active':'');
    const name = document.createElement('span');
    name.className='name';
    name.textContent=layer.name;
    const range=document.createElement('input');
    range.type='range';
    range.min='0';
    range.max='2';
    range.step='0.01';
    range.value=layer.brightness;
    const visBtn=document.createElement('button');
    visBtn.textContent = layer.visible?'👁':'🚫';
    const delBtn=document.createElement('button');
    delBtn.textContent='❌';
    const upBtn=document.createElement('button');
    upBtn.textContent='⬆️';
    const downBtn=document.createElement('button');
    downBtn.textContent='⬇️';
    const controls=document.createElement('div');
    controls.className='layer-controls';
    controls.appendChild(visBtn);
    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(delBtn);

    item.appendChild(name);
    item.appendChild(range);
    item.appendChild(controls);

    item.addEventListener('click',(e)=>{
      if(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT') return;
      activeLayer=layer;
      updateLayersPanel();
    });

    range.addEventListener('input',()=>{
      layer.brightness=parseFloat(range.value);
      drawLayers();
    });
    visBtn.addEventListener('click',(e)=>{
      e.stopPropagation();
      layer.visible=!layer.visible;
      visBtn.textContent=layer.visible?'👁':'🚫';
      drawLayers();
      saveHistory();
    });
    delBtn.addEventListener('click',(e)=>{
      e.stopPropagation();
      deleteLayer(layer);
    });
    upBtn.addEventListener('click',(e)=>{
      e.stopPropagation();
      moveLayer(layer,1);
    });
    downBtn.addEventListener('click',(e)=>{
      e.stopPropagation();
      moveLayer(layer,-1);
    });

    layersPanel.appendChild(item);
  }
}

function saveHistory(){
  if(!activeLayer) return;
  try{
    const data = activeLayer.canvas.toDataURL('image/png');
    const idx = layers.indexOf(activeLayer);
    history.push({layerIndex:idx,dataUrl:data});
    if(history.length>200) history.shift();
    redoStack=[];
  }catch(e){}
}
async function restoreSnapshot(snapshot){
  return new Promise(resolve=>{
    const img = new Image();
    img.onload=()=>{
      const layer = layers[snapshot.layerIndex];
      if(!layer) return resolve();
      layer.ctx.clearRect(0,0,layer.canvas.width,layer.canvas.height);
      layer.ctx.drawImage(img,0,0,layer.canvas.width,layer.canvas.height);
      resolve();
    };
    img.src=snapshot.dataUrl;
  });
}

undoBtn.addEventListener('click',async()=>{
  if(history.length===0)return;
  const last = history.pop();
  try{
    const current = layers[last.layerIndex].canvas.toDataURL('image/png');
    redoStack.push({layerIndex:last.layerIndex,dataUrl:current});
  }catch(e){}
  await restoreSnapshot(last);
  updateLayersPanel();
});

redoBtn.addEventListener('click',async()=>{
  if(redoStack.length===0)return;
  const next = redoStack.pop();
  try{
    const current = layers[next.layerIndex].canvas.toDataURL('image/png');
    history.push({layerIndex:next.layerIndex,dataUrl:current});
  }catch(e){}
  await restoreSnapshot(next);
  updateLayersPanel();
});

fillBtn.addEventListener('click',()=>{
  if(!activeLayer) return;
  activeLayer.ctx.save();
  activeLayer.ctx.fillStyle=colorPicker.value;
  activeLayer.ctx.fillRect(0,0,activeLayer.canvas.width,activeLayer.canvas.height);
  activeLayer.ctx.restore();
  saveHistory();
});

eraserBtn.addEventListener('click',()=>{
  usingEraser = !usingEraser;
  eraserBtn.style.background=usingEraser?'#ddd':'';
});

function attachDrawingEvents(canvas){
  let drawing=false;
  let pointerId=null;
  let last={x:0,y:0};

  function getPos(x,y){
    const rect=container.getBoundingClientRect();
    return {x: x-rect.left, y: y-rect.top};
  }
  function down(e){
    if(e.target.tagName==='BUTTON') return;
    canvas.setPointerCapture&&canvas.setPointerCapture(e.pointerId);
    pointerId=e.pointerId;
    drawing=true;
    const p = getPos(e.clientX,e.clientY);
    last=p;
    if(activeLayer){
      const ctx=activeLayer.ctx;
      ctx.beginPath();
      ctx.moveTo(last.x,last.y);
    }
  }
  function move(e){
    if(!drawing||e.pointerId!==pointerId) return;
    const p=getPos(e.clientX,e.clientY);
    if(!activeLayer) return;
    const ctx=activeLayer.ctx;
    ctx.save();
    ctx.globalCompositeOperation = usingEraser?'destination-out':'source-over';
    ctx.strokeStyle=colorPicker.value;
    ctx.lineWidth=parseFloat(brushSelect.value)||5;
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.beginPath();
    ctx.moveTo(last.x,last.y);
    ctx.lineTo(p.x,p.y);
    ctx.stroke();
    ctx.restore();
    last=p;
  }
  function up(e){
    if(e.pointerId!==pointerId) return;
    canvas.releasePointerCapture&&canvas.releasePointerCapture(e.pointerId);
    drawing=false;
    saveHistory();
  }

  canvas.addEventListener('pointerdown',down,{passive:false});
  canvas.addEventListener('pointermove',move,{passive:false});
  canvas.addEventListener('pointerup',up);
  canvas.addEventListener('pointercancel',up);
  canvas.addEventListener('pointerleave',(e)=>{ if(drawing&&e.pointerId===pointerId) up(e); });
}

saveBtn.addEventListener('click',()=>{
  const tmp=document.createElement('canvas');
  tmp.width=container.clientWidth;
  tmp.height=container.clientHeight;
  const tctx=tmp.getContext('2d');
  layers.forEach(l=>{ if(l.visible) tctx.drawImage(l.canvas,0,0); });
  const data=tmp.toDataURL();
  const link=document.createElement('a');
  link.download='drawing.png';link.href=data;link.click();
  const img=document.createElement('img');
  img.src=data;img.className='gallery-item';
  img.addEventListener('click',()=>{
    const image=new Image();
    image.onload=()=>{ if(!activeLayer) createLayer(); activeLayer.ctx.clearRect(0,0,activeLayer.canvas.width,activeLayer.canvas.height); activeLayer.ctx.drawImage(image,0,0,activeLayer.canvas.width,activeLayer.canvas.height); saveHistory(); };
    image.src=data;
  });
  galleryPanel.appendChild(img);
});

toggleLayersBtn.addEventListener('click',()=>{ layersPanel.classList.toggle('visible'); });

addLayerBtn.addEventListener('click',()=>createLayer());
mergeLayerBtn.addEventListener('click',()=>mergeActiveWithNeighbor());

imageInput.addEventListener('change',(e)=>{
  const file=e.target.files[0];
  if(!file)return;
  const img=new Image();
  img.onload=()=>insertImageOverlay(img);
  img.src=URL.createObjectURL(file);
  imageInput.value='';
});

function insertImageOverlay(image){
  const wrapper=document.createElement('div');
  wrapper.style.position='absolute';
  wrapper.style.top='0';
  wrapper.style.left='0';
  wrapper.style.width='100%';
  wrapper.style.height='100%';
  wrapper.style.zIndex='5000';
  container.appendChild(wrapper);

  const overlay=document.createElement('canvas');
  overlay.width=container.clientWidth;
  overlay.height=container.clientHeight;
  wrapper.appendChild(overlay);
  const octx=overlay.getContext('2d');

  const src=document.createElement('canvas');
  src.width=image.width;
  src.height=image.height;
  src.getContext('2d').drawImage(image,0,0);

  let scale=Math.min(overlay.width/image.width,overlay.height/image.height);
  let angle=0;
  let pos={x:(overlay.width-image.width*scale)/2,y:(overlay.height-image.height*scale)/2};
  let dragging=false;
  let lastPt=null;

  function redraw(){
    octx.clearRect(0,0,overlay.width,overlay.height);
    octx.save();
    octx.translate(pos.x+image.width*scale/2,pos.y+image.height*scale/2);
    octx.rotate(angle*Math.PI/180);
    octx.drawImage(src,-image.width*scale/2,-image.height*scale/2,image.width*scale,image.height*scale);
    octx.restore();
  }
  redraw();

  function getPt(e){
    const rect=overlay.getBoundingClientRect();
    if(e.touches)return {x:e.touches[0].clientX-rect.left,y:e.touches[0].clientY-rect.top};
    return {x:e.clientX-rect.left,y:e.clientY-rect.top};
  }

  overlay.addEventListener('mousedown',(e)=>{ dragging=true; lastPt=getPt(e); });
  window.addEventListener('mousemove',(e)=>{ if(!dragging)return; const p=getPt(e); pos.x+=p.x-lastPt.x; pos.y+=p.y-lastPt.y; lastPt=p; redraw(); });
  window.addEventListener('mouseup',()=>{ dragging=false; });

  overlay.addEventListener('touchstart',(e)=>{ e.preventDefault(); dragging=true; lastPt=getPt(e);},{passive:false});
  overlay.addEventListener('touchmove',(e)=>{ e.preventDefault(); if(!dragging)return; const p=getPt(e); pos.x+=p.x-lastPt.x; pos.y+=p.y-lastPt.y; lastPt=p; redraw();},{passive:false});
  overlay.addEventListener('touchend',(e)=>{ dragging=false; });

  overlay.addEventListener('wheel',(e)=>{
    e.preventDefault();
    const delta = e.deltaY>0?0.9:1.1;
    scale*=delta;
    if(scale<0.05) scale=0.05;
    if(scale>10) scale=10;
    redraw();
  });

  const btns=document.createElement('div');
  btns.style.position='absolute';
  btns.style.bottom='10px';
  btns.style.left='50%';
  btns.style.transform='translateX(-50%)';
  btns.style.zIndex='5100';
  wrapper.appendChild(btns);

  const confirm=document.createElement('button');
  confirm.textContent='✔';
  const cancel=document.createElement('button');
  cancel.textContent='✖';
  btns.appendChild(cancel);
  btns.appendChild(confirm);

  confirm.addEventListener('click',()=>{
    if(!activeLayer) createLayer();
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x+image.width*scale/2,pos.y+image.height*scale/2);
    activeLayer.ctx.rotate(angle*Math.PI/180);
    activeLayer.ctx.drawImage(src,-image.width*scale/2,-image.height*scale/2,image.width*scale,image.height*scale);
    activeLayer.ctx.restore();
    saveHistory();
    if(wrapper.parentElement)container.removeChild(wrapper);
  });

  cancel.addEventListener('click',()=>{
    if(wrapper.parentElement)container.removeChild(wrapper);
  });
}

document.addEventListener('keydown',(e)=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){ undoBtn.click();}
  if((e.ctrlKey||e.metaKey)&&e.key==='y'){ redoBtn.click();}
});

if(layers.length===0) createLayer('Layer 1');
updateLayersPanel();
drawLayers();
