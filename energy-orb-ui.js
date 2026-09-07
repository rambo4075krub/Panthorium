(function(){
'use strict';

const VERSION='phase14.3-energy-orb-shape-lock-v2';
const ROOT_ID='panthorium-energy-orb-root';
const MAX_LINES=80;
const DEFAULT_LINES=[
  'PANTHORIUM ENERGY CORE INTERACTIVE PROTOTYPE',
  'เลื่อนเมาส์เพื่อควบคุม · คลิกเพื่อปล่อยพลังงาน',
  'Sentinel Core พร้อมเชื่อมต่อข้อความและเสียงภาษาไทย'
];

if(typeof window==='undefined'||window.__panthoriumEnergyOrbInstalled)return;
window.__panthoriumEnergyOrbInstalled=true;

const PROTOTYPE_SHAPE={
  count:3500,
  reducedCount:1400,
  radius:90,
  camera:[220,180,220],
  particleSize:1.25,
  glowSize:4.2,
  haloScale:235,
  goldenAngle:Math.PI*(3-Math.sqrt(5))
};
const PALETTE_HEX={red:0xff3b30,purple:0xa855f7,blue:0x2563ff,white:0xffffff};

const state={
  installed:false,
  renderer:null,
  scene:null,
  camera:null,
  sphere:null,
  glow:null,
  halo:null,
  base:null,
  frame:0,
  activity:.18,
  targetActivity:.18,
  release:0,
  mouse:{x:0,y:0},
  userSpeaking:false,
  aiSpeaking:false,
  lines:DEFAULT_LINES.slice(),
  cursor:DEFAULT_LINES.length-1,
  lastStream:'',
  root:null,
  caption:null,
  reduced:false,
  colorFlowPhase:0,
  previousTime:0
};

function visibleShellPath(){return /^(\/|\/admin(?:\/|\.html)?|\/sentinel\.html)$/i.test(location.pathname||'/');}
function clamp(n,min,max){return Math.min(max,Math.max(min,n));}
function textOf(value){return String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
function shorten(value,max=160){const text=textOf(value);return text.length>max?text.slice(0,max-1)+'…':text;}
function cssEscape(value){return String(value||'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function emit(type,detail={}){try{window.dispatchEvent(new CustomEvent(`panthorium:energy-orb-${type}`,{detail:{version:VERSION,...detail}}));}catch(_){} }

function addLine(value,{stream=false}={}){
  const text=shorten(value);
  if(!text)return;
  if(stream){
    state.lastStream=text;
    if(state.lines[state.lines.length-1]&&state.lines[state.lines.length-1].startsWith('AI: ')) state.lines[state.lines.length-1]='AI: '+text;
    else state.lines.push('AI: '+text);
  }else{
    const line=text.startsWith('AI: ')||text.startsWith('คุณ: ')?text:text;
    if(state.lines[state.lines.length-1]===line)return;
    state.lines.push(line);
    state.lastStream='';
  }
  if(state.lines.length>MAX_LINES)state.lines=state.lines.slice(-MAX_LINES);
  state.cursor=state.lines.length-1;
  renderCaption();
}
function moveCursor(delta){state.cursor=clamp(state.cursor+delta,0,Math.max(0,state.lines.length-1));renderCaption();}
function renderCaption(){
  if(!state.caption)return;
  const rows=[state.cursor-1,state.cursor,state.cursor+1].map((index,slot)=>{
    const text=index>=0&&index<state.lines.length?state.lines[index]:'';
    const cls=slot===1?'current':slot===0?'previous':'next';
    return `<div class="orb-caption-row ${cls}" data-row="${cls}">${cssEscape(text)}</div>`;
  }).join('');
  state.caption.innerHTML=rows;
}

function ensureStyle(){
  if(document.getElementById('panthorium-energy-orb-style'))return;
  const style=document.createElement('style');
  style.id='panthorium-energy-orb-style';
  style.textContent=`
#bg-canvas.panthorium-energy-orb-replaced{opacity:0!important;filter:none!important;pointer-events:none!important;}
#${ROOT_ID}{position:absolute;inset:0;z-index:2;overflow:hidden;pointer-events:auto;contain:layout paint;}
#${ROOT_ID} canvas{position:absolute;inset:0;width:100%!important;height:100%!important;display:block;outline:none;}
#${ROOT_ID} .orb-caption{position:absolute;left:50%;top:calc(50% + 132px);transform:translateX(-50%);width:min(760px,calc(100vw - 220px));min-width:min(520px,calc(100vw - 36px));display:grid;grid-template-rows:repeat(3,22px);gap:2px;font-family:Consolas,'Courier New',monospace;text-align:center;color:#dff;letter-spacing:.2px;text-shadow:0 0 9px rgba(0,255,204,.38),0 1px 3px #000;background:transparent;border:0;box-shadow:none;user-select:none;outline-offset:6px;}
#${ROOT_ID} .orb-caption:focus-visible{outline:1px solid rgba(0,255,204,.7);border-radius:8px;}
#${ROOT_ID} .orb-caption-row{height:22px;line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent;}
#${ROOT_ID} .orb-caption-row.previous,#${ROOT_ID} .orb-caption-row.next{opacity:.46;filter:blur(.72px);font-size:12px;}
#${ROOT_ID} .orb-caption-row.current{opacity:1;filter:none;font-size:14px;color:#f2ffff;text-shadow:0 0 12px rgba(0,255,204,.55),0 0 26px rgba(0,150,255,.25),0 1px 4px #000;}
#desktop-icons,#windows,#taskbar,#start-menu{position:relative;}
@media(max-width:760px){#${ROOT_ID} .orb-caption{top:calc(50% + 112px);width:calc(100vw - 28px);min-width:0;grid-template-rows:repeat(3,20px);}#${ROOT_ID} .orb-caption-row{height:20px;line-height:20px;}#${ROOT_ID} .orb-caption-row.current{font-size:12.5px;}#${ROOT_ID} .orb-caption-row.previous,#${ROOT_ID} .orb-caption-row.next{font-size:10.5px;}}
@media(prefers-reduced-motion:reduce){#${ROOT_ID} .orb-caption-row.previous,#${ROOT_ID} .orb-caption-row.next{filter:none;opacity:.55;}}
`;
  document.head.appendChild(style);
}
function prepareDesktop(){
  const desktop=document.getElementById('desktop');
  if(!desktop)return null;
  if(getComputedStyle(desktop).position==='static')desktop.style.position='fixed';
  const old=document.getElementById('bg-canvas');
  if(old){old.classList.add('panthorium-energy-orb-replaced');old.setAttribute('aria-hidden','true');}
  return desktop;
}
function createRoot(desktop){
  let root=document.getElementById(ROOT_ID);
  if(root)return root;
  root=document.createElement('div');
  root.id=ROOT_ID;
  root.setAttribute('aria-label','Panthorium Energy Orb desktop background');
  root.innerHTML='<canvas aria-hidden="true"></canvas><div class="orb-caption" tabindex="0" role="log" aria-live="polite"></div>';
  desktop.insertBefore(root,desktop.firstChild);
  state.caption=root.querySelector('.orb-caption');
  root.addEventListener('pointermove',onPointerMove,{passive:true});
  root.addEventListener('click',()=>pulseRelease(1));
  state.caption.addEventListener('wheel',(event)=>{event.preventDefault();moveCursor(event.deltaY>0?1:-1);},{passive:false});
  state.caption.addEventListener('keydown',(event)=>{if(event.key==='ArrowUp'){event.preventDefault();moveCursor(-1);}if(event.key==='ArrowDown'){event.preventDefault();moveCursor(1);}if(event.key==='Home'){event.preventDefault();state.cursor=0;renderCaption();}if(event.key==='End'){event.preventDefault();state.cursor=state.lines.length-1;renderCaption();}});
  state.root=root;
  renderCaption();
  return root;
}
function onPointerMove(event){
  const rect=state.root?.getBoundingClientRect?.();
  if(!rect)return;
  state.mouse.x=((event.clientX-rect.left)/rect.width-.5)*2;
  state.mouse.y=-(((event.clientY-rect.top)/rect.height-.5)*2);
}
function pulseRelease(amount=.85){state.release=Math.min(1,state.release+amount);state.targetActivity=Math.max(state.targetActivity,.88);emit('release',{amount});}

function organicNoise(x,y,z,t){
  return Math.sin(x*.031+y*.024+t*1.35)*.46+Math.sin(y*.039-z*.028-t*1.08)*.34+Math.cos(z*.033+x*.021+t*.82)*.20;
}
function proceduralNoise(x,y,z,t){
  return Math.sin(x*.075+y*.035+t*4.8)*.50+Math.sin(y*.092-z*.061-t*6.2)*.31+Math.cos(z*.083+x*.041+t*3.7)*.19;
}
function writePaletteColor(color,position,palette){
  const value=clamp(position,0,1);
  if(value<.31)color.lerpColors(palette.red,palette.purple,value/.31);
  else if(value<.66)color.lerpColors(palette.purple,palette.blue,(value-.31)/.35);
  else color.lerpColors(palette.blue,palette.white,(value-.66)/.34);
}
function makePrototypeHaloTexture(THREE){
  const haloCanvas=document.createElement('canvas');
  haloCanvas.width=haloCanvas.height=256;
  const ctx=haloCanvas.getContext('2d');
  const grad=ctx.createRadialGradient(128,128,8,128,128,128);
  grad.addColorStop(0,'rgba(255, 255, 255, 0.24)');
  grad.addColorStop(.34,'rgba(105, 66, 255, 0.16)');
  grad.addColorStop(.68,'rgba(37, 99, 255, 0.09)');
  grad.addColorStop(1,'rgba(255, 59, 48, 0)');
  ctx.fillStyle=grad;
  ctx.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(haloCanvas);
}

function initThree(root){
  if(!window.THREE||state.renderer)return false;
  state.reduced=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const canvas=root.querySelector('canvas');
  const THREE=window.THREE;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,.1,1000);
  camera.position.set(...PROTOTYPE_SHAPE.camera);
  camera.lookAt(0,0,0);
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setSize(window.innerWidth,window.innerHeight,false);

  const geometry=new THREE.BufferGeometry();
  const count=state.reduced?PROTOTYPE_SHAPE.reducedCount:PROTOTYPE_SHAPE.count;
  const base=new Float32Array(count*3);
  const pos=new Float32Array(count*3);
  const colors=new Float32Array(count*3);
  const palette={
    red:new THREE.Color(PALETTE_HEX.red),
    purple:new THREE.Color(PALETTE_HEX.purple),
    blue:new THREE.Color(PALETTE_HEX.blue),
    white:new THREE.Color(PALETTE_HEX.white)
  };
  const particleColor=new THREE.Color();

  for(let i=0;i<count;i++){
    const y=1-(i/(count-1))*2;
    const r=Math.sqrt(Math.max(0,1-y*y));
    const theta=PROTOTYPE_SHAPE.goldenAngle*i;
    const o=i*3;
    base[o]=Math.cos(theta)*r*PROTOTYPE_SHAPE.radius;
    base[o+1]=y*PROTOTYPE_SHAPE.radius;
    base[o+2]=Math.sin(theta)*r*PROTOTYPE_SHAPE.radius;
    pos[o]=base[o];pos[o+1]=base[o+1];pos[o+2]=base[o+2];
    writePaletteColor(particleColor,(1-y)*.5,palette);
    const depthLight=.82+((base[o+2]/PROTOTYPE_SHAPE.radius+1)*.09);
    colors[o]=particleColor.r*depthLight;
    colors[o+1]=particleColor.g*depthLight;
    colors[o+2]=particleColor.b*depthLight;
  }
  geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));

  const sphere=new THREE.Points(geometry,new THREE.PointsMaterial({size:PROTOTYPE_SHAPE.particleSize,vertexColors:true,transparent:true,opacity:.90,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
  sphere.userData.palette=palette;
  sphere.userData.flowColor=new THREE.Color();
  sphere.renderOrder=2;
  scene.add(sphere);

  const glow=new THREE.Points(geometry,new THREE.PointsMaterial({size:PROTOTYPE_SHAPE.glowSize,vertexColors:true,transparent:true,opacity:.08,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
  glow.renderOrder=1;
  scene.add(glow);

  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:makePrototypeHaloTexture(THREE),color:0xffffff,transparent:true,opacity:.21,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false}));
  halo.scale.set(PROTOTYPE_SHAPE.haloScale,PROTOTYPE_SHAPE.haloScale,1);
  halo.position.z=-35;
  halo.renderOrder=0;
  scene.add(halo);

  state.renderer=renderer;
  state.scene=scene;
  state.camera=camera;
  state.sphere=sphere;
  state.glow=glow;
  state.halo=halo;
  state.base=base;
  state.previousTime=performance.now()*.001;
  window.addEventListener('resize',resize,{passive:true});
  resize();
  animate();
  return true;
}
function resize(){
  if(!state.renderer||!state.camera)return;
  const w=window.innerWidth||1,h=window.innerHeight||1;
  state.camera.aspect=w/h;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(w,h,false);
}
function animate(){
  state.frame=requestAnimationFrame(animate);
  if(!state.renderer||!state.scene||!state.camera||!state.sphere)return;
  const t=performance.now()*.001;
  const dt=Math.min(.05,Math.max(0,t-state.previousTime));
  state.previousTime=t;
  const voiceSpeaking=!!(window.speechSynthesis&&window.speechSynthesis.speaking);
  const aiSpeaking=state.aiSpeaking||voiceSpeaking;
  const idle=PROTOTYPE_SHAPE.radius*.02;
  const user=PROTOTYPE_SHAPE.radius*.005;
  const ai=PROTOTYPE_SHAPE.radius*.10;
  const targetNoise=aiSpeaking?ai:(state.userSpeaking?user:idle);
  state.targetActivity=Math.max(targetNoise,state.targetActivity*.965,state.release*ai);
  const ease=targetNoise>state.activity?.12:.035;
  state.activity+=(targetNoise-state.activity)*ease;
  state.release*=.88;
  if(aiSpeaking)state.colorFlowPhase+=dt*3.2;

  const positionAttribute=state.sphere.geometry.getAttribute('position');
  const colorAttribute=state.sphere.geometry.getAttribute('color');
  const points=positionAttribute.array;
  const colors=colorAttribute.array;
  const palette=state.sphere.userData.palette;
  const flowColor=state.sphere.userData.flowColor;
  const activityNoise=Math.max(state.activity,state.release*ai);

  for(let i=0;i<points.length/3;i++){
    const o=i*3;
    const x=state.base[o],y=state.base[o+1],z=state.base[o+2];
    const invRadius=1/Math.max(1,Math.hypot(x,y,z));
    const organic=organicNoise(x,y,z,t);
    const procedural=proceduralNoise(x,y,z,t);
    const releaseWave=state.release*Math.sin(t*11+i*.021)*PROTOTYPE_SHAPE.radius*.018;
    const displacement=(organic*.68+procedural*.32)*activityNoise+releaseWave;
    points[o]=x+x*invRadius*displacement;
    points[o+1]=y+y*invRadius*displacement;
    points[o+2]=z+z*invRadius*displacement;

    const latitude=(1-y/PROTOTYPE_SHAPE.radius)*.5;
    const longitude=Math.atan2(z,x);
    const poleLock=Math.sin(Math.PI*latitude);
    const rotatingBands=(Math.sin(longitude*3-state.colorFlowPhase+latitude*Math.PI*2.4)*.075+Math.sin(longitude*7+state.colorFlowPhase*.54)*.025)*poleLock;
    writePaletteColor(flowColor,latitude+rotatingBands,palette);
    const shimmer=.84+(Math.sin(longitude*5-state.colorFlowPhase*1.4)+1)*.045;
    colors[o]=flowColor.r*shimmer;
    colors[o+1]=flowColor.g*shimmer;
    colors[o+2]=flowColor.b*shimmer;
  }
  positionAttribute.needsUpdate=true;
  colorAttribute.needsUpdate=true;

  const pointerYaw=state.mouse.x*.06;
  const pointerPitch=state.mouse.y*.04;
  state.sphere.rotation.y+=.0026+pointerYaw*.012;
  state.sphere.rotation.x+=(pointerPitch-state.sphere.rotation.x)*.018;
  if(state.glow){
    state.glow.rotation.copy(state.sphere.rotation);
    const activityGlow=activityNoise/ai;
    state.glow.material.opacity=.075+Math.sin(t*1.35)*.015+activityGlow*.035+state.release*.08;
  }
  if(state.halo){
    const activityGlow=activityNoise/ai;
    const breathe=1+Math.sin(t*.9)*.025+activityGlow*.018+state.release*.08;
    state.halo.scale.set(PROTOTYPE_SHAPE.haloScale*breathe,PROTOTYPE_SHAPE.haloScale*breathe,1);
    state.halo.material.opacity=.19+Math.sin(t*1.1)*.025+activityGlow*.035+state.release*.06;
  }
  state.renderer.render(state.scene,state.camera);
}

function installEvents(){
  window.addEventListener('panthorium:ai-status',(event)=>addLine(event.detail?.text||event.detail?.message||'Sentinel Core กำลังประมวลผล'));
  window.addEventListener('panthorium:ai-stream',(event)=>{state.aiSpeaking=true;addLine(event.detail?.text||event.detail?.delta||'',{stream:true});});
  window.addEventListener('panthorium:ai-done',(event)=>{state.aiSpeaking=false;addLine(event.detail?.text||event.detail?.message||state.lastStream||'AI ตอบเสร็จแล้ว');pulseRelease(.28);});
  window.addEventListener('panthorium:voice-start',(event)=>{state.aiSpeaking=true;addLine(event.detail?.text||'AI กำลังพูดภาษาไทย');});
  window.addEventListener('panthorium:voice-boundary',()=>{state.release=Math.min(.6,state.release+.08);});
  window.addEventListener('panthorium:voice-end',()=>{state.aiSpeaking=false;});
  window.addEventListener('panthorium:voice-error',(event)=>addLine('Voice: '+(event.detail?.error||'speech error')));
  window.addEventListener('panthorium:voice-user-start',()=>{state.userSpeaking=true;addLine('กำลังฟังเสียงผู้ใช้...');});
  window.addEventListener('panthorium:voice-user-result',(event)=>{state.userSpeaking=false;addLine('คุณ: '+(event.detail?.text||''));});
  window.addEventListener('panthorium:voice-user-end',()=>{state.userSpeaking=false;});
}
function install(){
  if(state.installed||!visibleShellPath())return false;
  const desktop=prepareDesktop();
  if(!desktop)return false;
  ensureStyle();
  const root=createRoot(desktop);
  if(!initThree(root))addLine('THREE.js ยังไม่พร้อม · ใช้โหมดข้อความ 3 แถวชั่วคราว');
  installEvents();
  state.installed=true;
  emit('ready',{replaced:'bg-canvas',captionRows:3,shape:'prototype-fibonacci-sphere'});
  return true;
}
function tryInstall(){
  let attempts=0;
  const tick=()=>{attempts+=1;if(install()||attempts>80)return;setTimeout(tick,100);};
  tick();
}
function destroy(){
  if(state.frame)cancelAnimationFrame(state.frame);
  window.removeEventListener('resize',resize);
  state.renderer?.dispose?.();
  state.root?.remove?.();
  const old=document.getElementById('bg-canvas');if(old)old.classList.remove('panthorium-energy-orb-replaced');
  state.installed=false;
}

window.PanthoriumEnergyOrb={install,tryInstall,destroy,pushText:addLine,next:()=>moveCursor(1),previous:()=>moveCursor(-1),release:pulseRelease,status:()=>({version:VERSION,installed:state.installed,lines:state.lines.length,cursor:state.cursor,activity:state.activity,replaces:'bg-canvas',captionRows:3,shape:'prototype-fibonacci-sphere'})};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tryInstall,{once:true});else tryInstall();
window.addEventListener('panthorium:boot-complete',tryInstall);
window.addEventListener('panthorium:boot-recovered',tryInstall);
})();
