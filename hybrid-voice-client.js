(function(){
  'use strict';
  let active=false,generation=0,recorder=null,stream=null,context=null,speech=null,controller=null,timer=null,sessionId=null,identity=null;
  const account=()=>{try{return String(OS.state?.user?.sub||OS.state?.user?.id||'');}catch{return '';}};
  const status=(label,mode='idle')=>{
    window.dispatchEvent(new CustomEvent('panthorium:live-state',{detail:{mode,label}}));
    for(const id of ['chat-mic','desktop-voice']){const b=document.getElementById(id);if(b){b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',String(active));b.classList.toggle('listening',active);b.textContent=active?'⏹':'🎤';}}
    window.PanthoriumOrb?.setTranscript?.(label,0);
  };
  async function api(path,body,signal){
    await window.PanthoriumAuth?.ensureSession?.();
    const token=window.PanthoriumAuth?.getAccessToken?.();if(!token)throw new Error('กรุณาเข้าสู่ระบบก่อน');
    const base=window.PanthoriumAuth?.getBackendUrl?.()||location.origin;
    const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal,credentials:'include'});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error==='voice_not_authorized'?'เสียงไม่ผ่านการยืนยันตัวตน':e.error==='voice_enrollment_required'?'กรุณาลงทะเบียนเสียงในตั้งค่าก่อน':'Qwen กำลังไม่พร้อมหรือทรัพยากรไม่พอ กรุณาลองใหม่ภายหลัง');}return r;
  }
  async function policy(){try{return await(await api('/api/hybrid/status',null,AbortSignal.timeout(6000))).json();}catch{return null;}}
  function stop(){generation++;active=false;controller?.abort();controller=null;clearTimeout(timer);timer=null;if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;recorder.stop();}recorder=null;stream?.getTracks().forEach(t=>t.stop());stream=null;speech?.stop();speech=null;if(context){context.close().catch(()=>{});context=null;}window.dispatchEvent(new CustomEvent('panthorium:ai-speaking',{detail:{speaking:false}}));status('กดไมค์เพื่อเริ่มเสียง · Qwen ใช้ฟรี');}
  function row(kind,text){const list=document.getElementById('chat-messages');if(!list)return;const r=document.createElement('div');r.className='msg '+kind;r.textContent=text;list.appendChild(r);list.scrollTop=list.scrollHeight;}
  async function answer(blob,id){
    const check=()=>{if(id!==generation||identity!==account())throw new DOMException('Cancelled','AbortError');};
    try{
      check();status('Qwen ฟรี · กำลังถอดเสียงและคิดคำตอบ','processing');
      const audio=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});check();
      const transcription=await(await api('/api/hybrid/transcribe',{audio},controller.signal)).json();check();
      if(!transcription.text?.trim())throw new Error('ได้ยินเสียงไม่ชัด กรุณาลองพูดใหม่');
      row('user',transcription.text);
      const result=await(await api('/api/local/chat',{message:transcription.text,sessionId,voice:true,requestId:crypto.randomUUID()},controller.signal)).json();check();
      if(!result.ok)throw new Error('Qwen ยังตอบไม่ได้ กรุณาลองอีกครั้ง');
      sessionId=result.sessionId||sessionId;row('ai',result.text);window.dispatchEvent(new CustomEvent('panthorium:ai-done',{detail:{...result,source:'local'}}));
      status('Qwen ฟรี · กำลังเตรียมเสียงต่อเนื่อง','processing');
      speech=new window.PanthoriumSpeechBuffer.BufferedSpeech(context,async(text,signal)=>{check();return(await api('/api/hybrid/speech',{text},signal)).arrayBuffer();});
      window.dispatchEvent(new CustomEvent('panthorium:ai-speaking',{detail:{speaking:true}}));
      await speech.speak(result.text);check();stop();
    }catch(error){if(id!==generation)return;stop();if(error.name!=='AbortError')status(error.message,'error');}
  }
  async function start(){
    if(active){if(recorder?.state==='recording')recorder.stop();else stop();return;}
    // Restricted Cloud App sessions never fall back into unrestricted tools.
    if(window.PanthoriumCloudApps?.voiceContext?.()){status('โหมดงานนี้ต้องใช้ Gemini Live กรุณาเติมเครดิตหรือออกจากบริบทงานก่อน','error');return;}
    stop();active=true;const id=generation;identity=account();controller=new AbortController();
    try{
      if(!window.MediaRecorder)throw new Error('เบราว์เซอร์ไม่รองรับเสียง Qwen กรุณาพิมพ์ข้อความแทน');
      context=new(window.AudioContext||window.webkitAudioContext)();await context.resume();
      const opened=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
      if(id!==generation||identity!==account()){opened.getTracks().forEach(t=>t.stop());return;}stream=opened;
      const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
      recorder=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:32000}:{});const pieces=[];let bytes=0;
      recorder.ondataavailable=e=>{if(e.data.size){bytes+=e.data.size;if(bytes<=1024*1024)pieces.push(e.data);else stop();}};
      recorder.onstop=()=>{clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;if(id===generation)answer(new Blob(pieces,{type:recorder.mimeType}),id);};
      recorder.start(500);timer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();},20000);
      status('Qwen ฟรี · กำลังฟัง แตะไมค์อีกครั้งเพื่อส่ง (สูงสุด 20 วินาที)','listening');
    }catch(error){if(id===generation){stop();status(error.name==='NotAllowedError'?'กรุณาอนุญาตไมโครโฟน':error.message,'error');}}
  }
  window.PanthoriumHybridVoice={start,stop,isActive:()=>active,policy};
  window.addEventListener('panthorium:auth-changed',()=>{if(identity!==account()||!window.PanthoriumAuth?.getAccessToken?.()){stop();sessionId=null;}});
  window.addEventListener('panthorium:cloud-app-context',()=>{stop();sessionId=null;});
  window.addEventListener('pagehide',stop);
})();
