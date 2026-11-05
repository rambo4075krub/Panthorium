(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PanthoriumSpeechBuffer=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  function chunks(text){
    const clean=String(text||'').replace(/```[\s\S]*?```/g,' โค้ดแสดงอยู่ในข้อความ ').replace(/[*#`]/g,'').trim();
    if(clean.length<=320)return clean?[clean]:[];
    const sentences=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('th',{granularity:'sentence'}).segment(clean)].map(s=>s.segment):clean.split(/(?<=[!?。\n])\s*/u);
    const out=[];let pending='';
    for(const sentence of sentences){
      // Word segmentation avoids slicing Thai words and decimal tokens.
      const words=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('th',{granularity:'word'}).segment(sentence)].map(s=>s.segment):sentence.split(/(\s+)/);
      for(const word of words){if(pending.length+word.length>360&&pending.trim()){out.push(pending.trim());pending='';}pending+=word;}
      if(pending.length>=100){out.push(pending.trim());pending='';}
    }
    if(pending.trim())out.push(pending.trim());
    return out;
  }
  class BufferedSpeech {
    constructor(context,synthesize){this.context=context;this.synthesize=synthesize;this.sources=new Set();this.generation=0;this.controller=null;this.next=0;}
    stop(){this.generation++;this.controller?.abort();for(const s of this.sources){try{s.stop();}catch{}}this.sources.clear();this.next=0;}
    async speak(text){
      this.stop();const generation=this.generation;this.controller=new AbortController();const signal=this.controller.signal;
      const parts=chunks(text);let buffered=[];
      const current=()=>{if(signal.aborted||generation!==this.generation)throw new DOMException('Cancelled','AbortError');};
      const schedule=buffer=>{current();const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);const at=Math.max(this.context.currentTime+.04,this.next);this.next=at+buffer.duration;this.sources.add(source);source.onended=()=>this.sources.delete(source);source.start(at);};
      for(let i=0;i<parts.length;i++){
        current();
        while(this.next-this.context.currentTime>20){await new Promise(r=>setTimeout(r,100));current();}
        const bytes=await this.synthesize(parts[i],signal);current();
        const audio=await this.context.decodeAudioData(bytes);current();
        buffered.push(audio);
        // Hold two complete clips before starting a long answer; synthesis of
        // subsequent clips runs while these scheduled clips are playing.
        if(i>=1||parts.length===1){for(const clip of buffered)schedule(clip);buffered=[];}
      }
      while(this.sources.size){await new Promise(r=>setTimeout(r,100));current();}
    }
  }
  return {chunks,BufferedSpeech};
});
