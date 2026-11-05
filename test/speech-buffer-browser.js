'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
 const page=await browser.newPage();await page.addScriptTag({path:require.resolve('../speech-buffer.js')});
 const result=await page.evaluate(async()=>{
  const ctx=new AudioContext();await ctx.resume();const log=[];
  const make=ctx.createBufferSource.bind(ctx);ctx.createBufferSource=()=>{const source=make(),start=source.start.bind(source);source.start=at=>{log.push({at,duration:source.buffer.duration,clock:ctx.currentTime});start(at);};return source;};
  function wave(){const rate=16000,samples=16000,buffer=new ArrayBuffer(44+samples*2),view=new DataView(buffer);const str=(o,s)=>[...s].forEach((c,i)=>view.setUint8(o+i,c.charCodeAt(0)));str(0,'RIFF');view.setUint32(4,36+samples*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,samples*2,true);for(let i=0;i<samples;i++)view.setInt16(44+i*2,Math.sin(i*2*Math.PI*220/rate)*2000,true);return buffer;}
  let fetched=0;
  const speech=new PanthoriumSpeechBuffer.BufferedSpeech(ctx,async(text,signal)=>{await new Promise(r=>setTimeout(r,150));if(signal.aborted)throw new DOMException('cancelled','AbortError');fetched++;return wave();});
  const text=('ทดสอบเสียงต่อเนื่อง ราคา 546.02 บาท โดยแบ่งตามช่วงของภาษาไทย ').repeat(12);
  await speech.speak(text);
  const gaps=log.slice(1).map((item,i)=>item.at-(log[i].at+log[i].duration));
  const pending=speech.speak(text);await new Promise(r=>setTimeout(r,400));speech.stop();let cancelled=false;try{await pending;}catch(e){cancelled=e.name==='AbortError';}
  await ctx.close();return{gaps,clips:log.length,fetched,cancelled};
 });
 assert(result.gaps.length>0);assert(result.gaps.every(g=>Math.abs(g)<.001));assert(result.cancelled);console.log('Chromium Web Audio: '+JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
