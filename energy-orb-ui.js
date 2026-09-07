(function(){
'use strict';

const VERSION='phase14.3-energy-orb-v1';
const ROOT_ID='panthorium-energy-orb-root';
const MAX_LINES=80;
const DEFAULT_LINES=[
  'PANTHORIUM ENERGY CORE INTERACTIVE PROTOTYPE',
  'เลื่อนเมาส์เพื่อควบคุม · คลิกเพื่อปล่อยพลังงาน',
  'Sentinel Core พร้อมเชื่อมต่อข้อความและเสียงภาษาไทย'
];

if(typeof window==='undefined'||window.__panthoriumEnergyOrbInstalled)return;
window.__panthoriumEnergyOrbInstalled=true;

const state={
  installed:false,
  renderer:null,
  scene:null,
  camera:null,
  group:null,
  particles:null,
  glow:null,
  halo:null,
  rings:[],
  base:null,
  colors:null,
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
  reduced:false
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
  const first=desktop.firstChild;
  desktop.insertBefore(root,first);
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

function initThree(root){
  if(!window.THREE||state.renderer)return false;
  state.reduced=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const canvas=root.querySelector('canvas');
  const THREE=window.THREE;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(52,window.innerWidth/window.innerHeight,.1,1200);
  camera.position.z=255;
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
  renderer.setSize(window.innerWidth,window.innerHeight,false);
  const group=new THREE.Group();
  group.position.y=4;
  scene.add(group);

  const count=state.reduced?640:1550;
  const base=new Float32Array(count*3);
  const pos=new Float32Array(count*3);
  const colors=new Float32Array(count*3);
  const c1=new THREE.Color(0x00ffcc),c2=new THREE.Color(0x0099ff),c3=new THREE.Color(0xffffff);
  for(let i=0;i<count;i++){
    const theta=Math.random()*Math.PI*2;
    const u=Math.random()*2-1;
    const r=58+(Math.random()-.5)*4;
    const s=Math.sqrt(1-u*u);
    const o=i*3;
    base[o]=Math.cos(theta)*s*r;base[o+1]=u*r;base[o+2]=Math.sin(theta)*s*r;
    pos[o]=base[o];pos[o+1]=base[o+1];pos[o+2]=base[o+2];
    const mix=i%7===0?c3:(i%3===0?c2:c1);
    colors[o]=mix.r;colors[o+1]=mix.g;colors[o+2]=mix.b;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  const particles=new THREE.Points(geometry,new THREE.PointsMaterial({size:2.65,vertexColors:true,transparent:true,opacity:.93,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
  group.add(particles);

  const glow=new THREE.Points(geometry,new THREE.PointsMaterial({size:6.2,vertexColors:true,transparent:true,opacity:.09,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
  group.add(glow);

  const core=new THREE.Mesh(new THREE.IcosahedronGeometry(38,3),new THREE.MeshBasicMaterial({color:0x00ffcc,transparent:true,opacity:.15,wireframe:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  group.add(core);

  const rings=[];
  for(let i=0;i<3;i++){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(71+i*9,.42,8,128),new THREE.MeshBasicMaterial({color:i===0?0x00ffcc:0x0099ff,transparent:true,opacity:.28-i*.05,blending:THREE.AdditiveBlending,depthWrite:false}));
    ring.rotation.x=Math.PI/2+i*.45;
    ring.rotation.y=i*.55;
    group.add(ring);rings.push(ring);
  }

  const haloCanvas=document.createElement('canvas');haloCanvas.width=haloCanvas.height=256;
  const ctx=haloCanvas.getContext('2d');
  const grad=ctx.createRadialGradient(128,128,6,128,128,128);
  grad.addColorStop(0,'rgba(255,255,255,.34)');
  grad.addColorStop(.25,'rgba(0,255,204,.25)');
  grad.addColorStop(.64,'rgba(0,130,255,.12)');
  grad.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=grad;ctx.fillRect(0,0,256,256);
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(haloCanvas),transparent:true,opacity:.42,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false}));
  halo.scale.set(210,210,1);halo.position.z=-20;group.add(halo);

  state.renderer=renderer;state.scene=scene;state.camera=camera;state.group=group;state.particles=particles;state.glow=glow;state.halo=halo;state.rings=rings;state.base=base;state.colors=colors;state.core=core;
  window.addEventListener('resize',resize,{passive:true});
  resize();animate();return true;
}
function resize(){
  if(!state.renderer||!state.camera)return;
  const w=window.innerWidth||1,h=window.innerHeight||1;
  state.camera.aspect=w/h;state.camera.updateProjectionMatrix();state.renderer.setSize(w,h,false);
  const scale=clamp(Math.min(w,h)/780,.78,1.18);
  if(state.group)state.group.scale.setScalar(scale);
}
function animate(){
  state.frame=requestAnimationFrame(animate);
  if(!state.renderer||!state.scene||!state.camera)return;
  const t=performance.now()*.001;
  const voiceSpeaking=!!(window.speechSynthesis&&window.speechSynthesis.speaking);
  const liveActivity=(state.aiSpeaking||voiceSpeaking)?.86:(state.userSpeaking?.56:.18);
  state.targetActivity=Math.max(liveActivity,state.targetActivity*.965,state.release*.9);
  state.activity+=(state.targetActivity-state.activity)*.075;
  state.release*=.91;
  state.targetActivity=Math.max(.18,state.targetActivity*.992);
  const amp=state.reduced?1.1:2.6+state.activity*7.6;
  const pos=state.particles.geometry.getAttribute('position');
  const arr=pos.array;
  for(let i=0;i<arr.length;i+=3){
    const x=state.base[i],y=state.base[i+1],z=state.base[i+2];
    const wave=Math.sin(t*2.1+x*.055+z*.033)+Math.cos(t*1.7+y*.064);
    const burst=state.release*Math.sin(t*12+i*.013)*5.5;
    const m=(wave*.42*amp+burst)/Math.max(1,Math.hypot(x,y,z));
    arr[i]=x+x*m;arr[i+1]=y+y*m;arr[i+2]=z+z*m;
  }
  pos.needsUpdate=true;
  state.group.rotation.y+=state.reduced?.0015:.0028+state.activity*.0019;
  state.group.rotation.x+=(state.mouse.y*.18-state.group.rotation.x)*.035;
  state.group.rotation.z+=(state.mouse.x*.16-state.group.rotation.z)*.032;
  if(state.glow)state.glow.material.opacity=.075+state.activity*.13+state.release*.12;
  if(state.halo){const breathe=1+Math.sin(t*.95)*.025+state.activity*.075+state.release*.18;state.halo.scale.set(210*breathe,210*breathe,1);state.halo.material.opacity=.26+state.activity*.24;}
  if(state.core){state.core.rotation.x-=.004+state.activity*.003;state.core.rotation.y+=.006+state.activity*.005;state.core.material.opacity=.1+state.activity*.22;}
  state.rings.forEach((ring,i)=>{ring.rotation.z+=(i%2?-1:1)*(.004+state.activity*.006);ring.material.opacity=.16+state.activity*.24-i*.035;});
  state.renderer.render(state.scene,state.camera);
}

function installEvents(){
  window.addEventListener('panthorium:ai-status',(event)=>addLine(event.detail?.text||event.detail?.message||'Sentinel Core กำลังประมวลผล'));
  window.addEventListener('panthorium:ai-stream',(event)=>{state.aiSpeaking=true;state.targetActivity=.68;addLine(event.detail?.text||event.detail?.delta||'',{stream:true});});
  window.addEventListener('panthorium:ai-done',(event)=>{state.aiSpeaking=false;state.targetActivity=.78;addLine(event.detail?.text||event.detail?.message||state.lastStream||'AI ตอบเสร็จแล้ว');pulseRelease(.28);});
  window.addEventListener('panthorium:voice-start',(event)=>{state.aiSpeaking=true;state.targetActivity=.92;addLine(event.detail?.text||'AI กำลังพูดภาษาไทย');});
  window.addEventListener('panthorium:voice-boundary',()=>{state.targetActivity=.95;state.release=Math.min(.6,state.release+.08);});
  window.addEventListener('panthorium:voice-end',()=>{state.aiSpeaking=false;state.targetActivity=.32;});
  window.addEventListener('panthorium:voice-error',(event)=>addLine('Voice: '+(event.detail?.error||'speech error')));
  window.addEventListener('panthorium:voice-user-start',()=>{state.userSpeaking=true;state.targetActivity=.62;addLine('กำลังฟังเสียงผู้ใช้...');});
  window.addEventListener('panthorium:voice-user-result',(event)=>{state.userSpeaking=false;state.targetActivity=.5;addLine('คุณ: '+(event.detail?.text||''));});
  window.addEventListener('panthorium:voice-user-end',()=>{state.userSpeaking=false;});
}
function install(){
  if(state.installed||!visibleShellPath())return false;
  const desktop=prepareDesktop();
  if(!desktop)return false;
  ensureStyle();
  const root=createRoot(desktop);
  if(!initThree(root)){
    addLine('THREE.js ยังไม่พร้อม · ใช้โหมดข้อความ 3 แถวชั่วคราว');
  }
  installEvents();
  state.installed=true;
  emit('ready',{replaced:'bg-canvas',captionRows:3});
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

window.PanthoriumEnergyOrb={install,tryInstall,destroy,pushText:addLine,next:()=>moveCursor(1),previous:()=>moveCursor(-1),release:pulseRelease,status:()=>({version:VERSION,installed:state.installed,lines:state.lines.length,cursor:state.cursor,activity:state.activity,replaces:'bg-canvas',captionRows:3})};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tryInstall,{once:true});else tryInstall();
window.addEventListener('panthorium:boot-complete',tryInstall);
window.addEventListener('panthorium:boot-recovered',tryInstall);
})();
