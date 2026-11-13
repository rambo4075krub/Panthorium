(function(){
  'use strict';
  let active=false,generation=0,recorder=null,stream=null,context=null,speech=null,controller=null,timer=null,sessionId=null,identity=null,queueTimer=null;
  let detector=null,source=null,analyser=null,mode='idle';
  const account=()=>{try{return String(OS.state?.user?.sub||OS.state?.user?.id||'');}catch{return '';}};
  const status=(label,mode='idle')=>{
    window.dispatchEvent(new CustomEvent('panthorium:live-state',{detail:{mode,label}}));
    for(const id of ['chat-mic','desktop-voice']){const b=document.getElementById(id);if(b){b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',String(active));b.classList.toggle('listening',active);b.textContent=active?'⏹':'🎤';}}
    // Idle/auth cleanup updates the microphone, not the welcome or last answer.
    if(mode!=='idle')window.PanthoriumOrb?.setTranscript?.(label,0);
  };
  async function api(path,body,signal){
    await window.PanthoriumAuth?.ensureSession?.();
    const token=window.PanthoriumAuth?.getAccessToken?.();if(!token)throw new Error('กรุณาเข้าสู่ระบบก่อน');
    const base=window.PanthoriumAuth?.getBackendUrl?.()||location.origin;
    const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal,credentials:'include'});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error==='voice_not_authorized'?'เสียงไม่ผ่านการยืนยันตัวตน':e.error==='voice_enrollment_required'?'กรุณาลงทะเบียนเสียงในตั้งค่าก่อน':'Qwen กำลังไม่พร้อมหรือทรัพยากรไม่พอ กรุณาลองใหม่ภายหลัง');}return r;
  }
  async function policy(){try{return await(await api('/api/hybrid/status',null,AbortSignal.timeout(6000))).json();}catch{return null;}}
  function stop(){clearInterval(queueTimer);queueTimer=null;clearInterval(detector);detector=null;mode='idle';generation++;active=false;controller?.abort();controller=null;clearTimeout(timer);timer=null;if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;recorder.stop();}recorder=null;source?.disconnect();source=null;analyser=null;stream?.getTracks().forEach(t=>t.stop());stream=null;speech?.stop();speech=null;if(context){context.close().catch(()=>{});context=null;}window.dispatchEvent(new CustomEvent('panthorium:ai-speaking',{detail:{speaking:false}}));status('กดไมค์เพื่อเริ่มเสียง Sentinel AI');}
  function row(kind,text){const list=document.getElementById('chat-messages');if(!list)return;const r=document.createElement('div');r.className='msg '+kind;r.textContent=text;list.appendChild(r);list.scrollTop=list.scrollHeight;}
  async function answer(blob,id){
    const check=()=>{if(id!==generation||identity!==account())throw new DOMException('Cancelled','AbortError');};
    try{
      check();status('Qwen ฟรี · กำลังถอดเสียงและคิดคำตอบ','processing');
      let polling=false;queueTimer=setInterval(async()=>{if(polling)return;polling=true;let p;try{p=await policy();}finally{polling=false;}if(id!==generation)return;const q=p?.local?.queue;if(q?.yourPosition)status(`Qwen ฟรี · คิวที่ ${q.yourPosition} · รอไม่เกิน ${q.maxWaitSeconds} วินาที${p.local.reason?' · รอทรัพยากร':''}`,'processing');},2500);
      const audio=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});check();
      const transcription=await(await api('/api/hybrid/transcribe',{audio},controller.signal)).json();check();
      if(!transcription.text?.trim())throw new Error('ได้ยินเสียงไม่ชัด กรุณาลองพูดใหม่');
      row('user',transcription.text);
      const phrase=transcription.text.normalize('NFC').replace(/[\s\p{P}\p{S}]+/gu,'').toLowerCase();
      if(/^(หยุดฟัง|ปิดไมค์|ปิดไมโครโฟน|หยุดรับคำสั่ง|stoplistening|stopmicrophone)$/.test(phrase)){stop();return;}
      const creative=window.PanthoriumCreativeVoiceCatalog?.parse(transcription.text);
      const localCommand=window.PanthoriumVoiceCommands?.hasPending?.() || window.PanthoriumScreenVoiceCatalog?.parse(transcription.text) || window.PanthoriumWindowCatalog?.classifyVoiceInput(transcription.text)?.kind==='command' || creative&&(!['confirm','cancel'].includes(creative.action)||window.PanthoriumCreativeStudio?.hasVoicePending?.());
      let result=localCommand&&window.PanthoriumVoiceCommands?await window.PanthoriumVoiceCommands.execute(transcription.text):await(await api('/api/local/chat',{message:transcription.text,sessionId,voice:true,requestId:crypto.randomUUID()},controller.signal)).json();check();
      if(result.summarize&&result.screen) result=await(await api('/api/local/chat',{message:transcription.text,screen:result.screen,sessionId,voice:true,requestId:crypto.randomUUID()},controller.signal)).json();check();
      if(!result.ok)throw new Error(result.text||'Qwen ยังตอบไม่ได้ กรุณาลองอีกครั้ง');
      sessionId=result.sessionId||sessionId;row('ai',result.text);window.dispatchEvent(new CustomEvent('panthorium:ai-done',{detail:{...result,source:'local',accountId:identity}}));
      status('Qwen ฟรี · กำลังเตรียมเสียงต่อเนื่อง','processing');
      speech=new window.PanthoriumSpeechBuffer.BufferedSpeech(context,async(text,signal)=>{check();return(await api('/api/hybrid/speech',{text},signal)).arrayBuffer();});
      window.dispatchEvent(new CustomEvent('panthorium:ai-speaking',{detail:{speaking:true}}));
      await speech.speak(result.text);check();
    }catch(error){if(id!==generation)return;if(error.name!=='AbortError'){row('ai',error.message);status(error.message,'error');}}
    finally{
      if(id===generation&&active){clearInterval(queueTimer);queueTimer=null;speech?.stop();speech=null;window.dispatchEvent(new CustomEvent('panthorium:ai-speaking',{detail:{speaking:false}}));recordTurn(id);}
    }
  }
  function recordTurn(id) {
    if(!active||id!==generation||identity!==account())return;
    if(!stream?.getAudioTracks().some(track=>track.readyState==='live')){stop();status('ไมโครโฟนถูกตัดการเชื่อมต่อ แตะไมค์เพื่อเริ่มใหม่','error');return;}
    mode='listening';
    const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    const current=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:32000}:{});recorder=current;
    const pieces=[];let bytes=0,heard=false,voicedFrames=0,lastVoice=performance.now(),send=false;
    const finish=(manual=false)=>{if(current.state!=='recording')return;send=manual||heard;current.stop();};
    current.ondataavailable=e=>{if(e.data.size){bytes+=e.data.size;if(bytes<=1024*1024)pieces.push(e.data);else {stop();status('เสียงยาวเกินไป กรุณาเริ่มใหม่','error');}}};
    current.onerror=()=>{if(id===generation){stop();status('บันทึกเสียงไม่สำเร็จ แตะไมค์เพื่อเริ่มใหม่','error');}};
    current.onstop=()=>{
      clearTimeout(timer);clearInterval(detector);detector=null;
      if(id!==generation||!active)return;
      recorder=null;
      if(send&&pieces.length){mode='processing';void answer(new Blob(pieces,{type:current.mimeType}),id);}
      else recordTurn(id);
    };
    current.submit=()=>finish(true);
    current.start(250);
    const samples=new Float32Array(analyser.fftSize);
    detector=setInterval(()=>{
      if(id!==generation||current.state!=='recording')return;
      analyser.getFloatTimeDomainData(samples);
      let energy=0;for(const value of samples)energy+=value*value;
      if(Math.sqrt(energy/samples.length)>.018){voicedFrames++;lastVoice=performance.now();if(voicedFrames>=3)heard=true;}
      else if(heard&&performance.now()-lastVoice>1100)finish();
    },80);
    timer=setTimeout(()=>finish(),20000);
    status('กำลังฟังต่อเนื่อง · เว้นจังหวะเพื่อส่ง · พูด ปิดไมค์ หรือแตะไมค์เพื่อหยุด','listening');
  }
  async function start(){
    if(active){stop();return;}
    // Restricted Cloud App sessions never fall back into unrestricted tools.
    if(window.PanthoriumCloudApps?.voiceContext?.()){status(document.body?.dataset.aiMode==='local-only'?'กรุณาพิมพ์คำสั่งในโหมดงานนี้ หรือออกจากบริบทงานเพื่อใช้เสียง Qwen':'โหมดงานนี้ต้องใช้ Sentinel AI กรุณาเติมเครดิตหรือออกจากบริบทงานก่อน','error');return;}
    stop();stopReader();active=true;const id=generation;identity=account();controller=new AbortController();
    try{
      const access=await policy();
      if(id!==generation||identity!==account())return;
      if(!access?.local?.enabled)throw new Error(document.body?.dataset.aiMode==='local-only'?'บัญชีนี้ยังไม่มีสิทธิ์ใช้ AI ในเครื่อง หรือบริการกำลังปิดอยู่':'บัญชีนี้ไม่สามารถใช้บริการ AI ภายในได้ กรุณาใช้ Sentinel AI ตามแพ็กเกจ');
      if(!window.MediaRecorder)throw new Error('เบราว์เซอร์ไม่รองรับเสียง Qwen กรุณาพิมพ์ข้อความแทน');
      context=new(window.AudioContext||window.webkitAudioContext)();await context.resume();
      const opened=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
      if(id!==generation||identity!==account()){opened.getTracks().forEach(t=>t.stop());return;}stream=opened;
      source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=1024;source.connect(analyser);
      recordTurn(id);
    }catch(error){if(id===generation){stop();status(error.name==='NotAllowedError'?'กรุณาอนุญาตไมโครโฟน':error.message,'error');}}
  }
  window.PanthoriumHybridVoice={start,stop,isActive:()=>active,policy,state:()=>({active,mode}),submit:()=>recorder?.submit?.()};
  // The notebook mode uses MediaRecorder + the local ASR/TTS broker exclusively.
  // Retain the public voice controls used by windows and notification playback.
  let readerContext=null,reader=null,readerGeneration=0;
  function stopReader(){readerGeneration++;reader?.stop();reader=null;if(readerContext){readerContext.close().catch(()=>{});readerContext=null;}}
  async function readAloud(text){
    stopReader();const id=readerGeneration,owner=account();
    const audioContext=new(window.AudioContext||window.webkitAudioContext)();readerContext=audioContext;
    try{
      await audioContext.resume();
      const player=new window.PanthoriumSpeechBuffer.BufferedSpeech(audioContext,async(chunk,signal)=>{
        if(id!==readerGeneration||owner!==account())throw new DOMException('Cancelled','AbortError');
        return(await api('/api/hybrid/speech',{text:chunk},signal)).arrayBuffer();
      });reader=player;await player.speak(String(text));
    }finally{if(id===readerGeneration)stopReader();}
  }
  window.PanthoriumLocalSpeech={speak:readAloud,stop:stopReader,pause:()=>readerContext?.suspend(),resume:()=>readerContext?.resume(),isActive:()=>!!reader};
  if(document.body?.dataset.aiMode==='local-only'){
    window.PanthoriumLiveVoice={toggle:start,stop:()=>{stop();stopReader();},stopPlayback:()=>{stop();stopReader();},
      isActive:()=>active,isBusy:()=>active||!!reader,state:()=>({active,busy:active||!!reader,mode}),stopChatSession:stop};
    document.getElementById('desktop-voice')?.addEventListener('click',()=>start());
  }
  window.addEventListener('panthorium:auth-changed',stopReader);
  window.addEventListener('pagehide',stopReader);
  window.addEventListener('panthorium:auth-changed',()=>{if(identity!==account()||!window.PanthoriumAuth?.getAccessToken?.()){stop();sessionId=null;}});
  window.addEventListener('panthorium:cloud-app-context',()=>{stop();sessionId=null;});
  window.addEventListener('pagehide',stop);
})();
