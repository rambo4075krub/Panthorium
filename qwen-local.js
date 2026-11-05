'use strict';
const login = document.querySelector('#login');
const chat = document.querySelector('#chat');
const output = document.querySelector('output');
let token = '';
login.onsubmit = async event => {
  event.preventDefault(); login.querySelector('button').disabled = true;
  try {
    const response = await fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(login)))});
    const result = await response.json();
    if (!response.ok || !result.accessToken) throw Error('เข้าสู่ระบบไม่ได้ กรุณาตรวจชื่อผู้ใช้และรหัสผ่าน');
    token = result.accessToken; login.reset(); login.hidden = true; chat.hidden = false; output.textContent = ''; chat.elements.message.focus();
  } catch (error) { output.textContent = error.message; }
  finally { login.querySelector('button').disabled = false; }
};
chat.onsubmit = async event => {
  event.preventDefault(); chat.querySelector('button').disabled = true; output.textContent = 'Qwen กำลังตอบ…';
  try {
    const response = await fetch('/api/local/chat',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({message:chat.elements.message.value})});
    const result = await response.json();
    if (response.status === 401) { token=''; chat.hidden=true; login.hidden=false; throw Error('กรุณาเข้าสู่ระบบอีกครั้ง'); }
    if (!response.ok) throw Error(response.status===429?'Qwen กำลังตอบคำขออื่น กรุณาลองอีกครั้ง':'ยังรับคำตอบจาก Qwen ไม่ได้');
    output.textContent = result.text;
  } catch(error) { output.textContent=error.message; }
  finally { chat.querySelector('button').disabled=false; }
};