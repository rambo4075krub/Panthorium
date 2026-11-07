'use strict';
const messages={
  ram_headroom:'AI บนเครื่องพักอยู่ เพราะ RAM ที่เหลือภายในเพดานยังไม่พอสำหรับโหลดโมเดล',
  ram_pressure:'AI บนเครื่องพักอยู่ เพราะ RAM ยังไม่ผ่านเกณฑ์เริ่มงาน',
  vram_pressure:'AI บนเครื่องพักอยู่ เพราะหน่วยความจำการ์ดจอยังไม่ผ่านเกณฑ์เริ่มงาน',
  gpu_metrics_unavailable:'AI บนเครื่องพักอยู่ เพราะยังตรวจหน่วยความจำการ์ดจอไม่ได้',
  resource_monitor_unavailable:'AI บนเครื่องพักอยู่ เพราะระบบตรวจทรัพยากรยังไม่พร้อม',
  model_not_installed:'AI บนเครื่องยังไม่พร้อม เพราะไม่พบไฟล์โมเดลที่ตรงกับการตั้งค่า'
};
function resourceCode(value){
  return typeof value==='string'&&Object.hasOwn(messages,value.replace(/^local_resource_/,''))&&value.startsWith('local_resource_')?value:null;
}
function resourceFailure(attempts,ordered){
  if(ordered.length!==1||ordered[0]!=='local')return null;
  const code=resourceCode(attempts.at(-1)?.error);
  if(!code)return null;
  return{ok:false,error:code,text:messages[code.slice('local_resource_'.length)]+' กรุณาลองใหม่เมื่อทรัพยากรพร้อม ไม่หักเครดิต',provider:'local',billable:false,creditsCharged:0};
}
function resourceStatus(s){
  // Only expose bounded numeric metrics to already-authorized private users.
  const metrics={};
  for(const key of ['ramTotalBytes','ramHeadroomBytes','ramRequiredAdditionalBytes','ramShortfallBytes'])
    if(Number.isSafeInteger(s[key])&&s[key]>=0)metrics[key]=s[key];
  for(const key of ['ramUsedFraction','ramLimit','vramUsedFraction','vramLimit'])
    if(Number.isFinite(s[key])&&s[key]>=0&&s[key]<=1)metrics[key]=s[key];
  let message=s.ready===true?'AI บนเครื่องพร้อมรับคำขอ':messages[s.reason]||'AI บนเครื่องกำลังรอทรัพยากร';
  if(Number.isFinite(metrics.ramUsedFraction)&&Number.isFinite(metrics.ramLimit))
    message+=` · RAM ${(metrics.ramUsedFraction*100).toFixed(1)}% / เพดาน ${(metrics.ramLimit*100).toFixed(0)}%`;
  if(['ram_headroom','ram_pressure'].includes(s.reason)&&metrics.ramShortfallBytes>0)
    message+=` · ต้องเผื่อ RAM เพิ่ม ${(metrics.ramShortfallBytes/1024**3).toFixed(1)} GiB ตามค่าประเมินก่อนเริ่ม`;
  return{resources:metrics,message};
}
module.exports={resourceCode,resourceFailure,resourceStatus};
