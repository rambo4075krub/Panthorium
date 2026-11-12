'use strict';
const login = document.querySelector('#login');
const chat = document.querySelector('#chat');
const output = document.querySelector('output');
const availability = document.querySelector('#availability');
let token = '';
function showAvailability(local){availability.hidden=!local?.enabled;availability.textContent=local?.message||'';}
let pending;const cancelButton=document.querySelector('#cancel');cancelButton.onclick=()=>pending?.abort();
login.onsubmit = async event => {
  event.preventDefault(); login.querySelector('button').disabled = true;
  try {
    const response = await fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(login)))});
    const result = await response.json();
    if (!response.ok || !result.accessToken) throw Error('เข้าสู่ระบบไม่ได้ กรุณาตรวจชื่อผู้ใช้และรหัสผ่าน');
    token = result.accessToken;
    const accessResponse=await fetch('/api/hybrid/status',{headers:{Authorization:'Bearer '+token}});
    const access=await accessResponse.json();
    if(!accessResponse.ok||!access.local?.enabled){token='';throw Error('บัญชีนี้ไม่มีสิทธิ์สนทนา หรือบริการ Qwen ในเครื่องกำลังปิดอยู่');}
    login.reset(); login.hidden = true; chat.hidden = false; output.textContent = '';showAvailability(access.local); chat.elements.message.focus();
  } catch (error) { output.textContent = error.message; }
  finally { login.querySelector('button').disabled = false; }
};
chat.onsubmit = async event => {
  event.preventDefault(); chat.querySelector('button').disabled = true; output.textContent = 'Qwen ฟรี · กำลังตรวจคิวและทรัพยากร…';
  pending=new AbortController();cancelButton.hidden=false;let polling=false,finished=false;const timer=setInterval(async()=>{if(polling)return;polling=true;try{const r=await fetch('/api/hybrid/status',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(1500)});const s=await r.json(),q=s.local?.queue;if(finished)return;if(q?.yourPosition)output.textContent=`Qwen ฟรี · คิวที่ ${q.yourPosition} · รอได้ไม่เกิน ${q.maxWaitSeconds} วินาที${s.local.reason?' · รอทรัพยากร':''}`;else if(q?.yourRunning)output.textContent='Qwen ฟรี · กำลังตอบ…';}catch{}finally{polling=false;}},2000);
  try {
    const media=await window.PanthoriumLocalMedia.prepare(chat.elements.media.files,pending.signal);
    const response = await fetch('/api/local/chat',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.any([pending.signal,AbortSignal.timeout(210000)]),body:JSON.stringify({message:chat.elements.message.value,media,thinking:chat.elements.thinking.checked})});
    const result = await response.json();
    if (response.status === 401) { token=''; chat.hidden=true; login.hidden=false;showAvailability(null); throw Error('กรุณาเข้าสู่ระบบอีกครั้ง'); }
    if(response.status===403){token='';chat.hidden=true;login.hidden=false;showAvailability(null);throw Error('บัญชีนี้ไม่มีสิทธิ์ใช้บริการ AI ภายใน');}
    if (!response.ok) throw Error(String(result.error||'').startsWith('local_resource_')&&typeof result.text==='string'?result.text:response.status===429?'Qwen กำลังตอบคำขออื่น กรุณาลองอีกครั้ง':'Qwen พักรับงานเนื่องจากคิวหรือทรัพยากรไม่พร้อม กรุณาลองใหม่ภายหลัง ไม่หักเครดิต');
    output.textContent = result.text;
  } catch(error) { output.textContent=error.name==='AbortError'?'ยกเลิกคำขอแล้ว':error.message; }
  finally {finished=true;clearInterval(timer);pending=null;cancelButton.hidden=true;chat.querySelector('button').disabled=false;if(token)try{const r=await fetch('/api/hybrid/status',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(2000)});if(r.ok)showAvailability((await r.json()).local);}catch{}}
};
