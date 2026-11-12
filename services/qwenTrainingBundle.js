'use strict';
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');
const profile = require('../deploy/hybrid/model-profile.json');
const hash = value => createHash('sha256').update(value).digest('hex');

function prepareDataset(jsonl) {
  if (typeof jsonl !== 'string' || Buffer.byteLength(jsonl) > 20*1024**2) throw Error('training_dataset_too_large');
  const byPrompt = new Map();
  let excluded = 0;
  for (const line of jsonl.split('\n').filter(x=>x.trim())) {
    const row=JSON.parse(line),messages=row.messages;
    // Synthetic acceptance fixtures and unscored examples must never become weights.
    if (/acceptance|staging|deterministic/i.test(row.metadata?.source||'') || Number(row.metadata?.qualityScore||0)<90) {excluded++;continue;}
    if (!Array.isArray(messages) || messages.length!==2 || messages[0]?.role!=='user' || messages[1]?.role!=='assistant' || messages.some(m=>typeof m.content!=='string'||!m.content.trim()||m.content.length>12000)) {excluded++;continue;}
    const key=hash(messages[0].content.trim().normalize('NFKC').toLowerCase());
    // Keep all equal prompts in one split; conflicting answers need human review.
    const answer=messages[1].content.trim();
    if (byPrompt.has(key)) {
      if (byPrompt.get(key)?.messages[1].content!==answer) byPrompt.set(key,null);
      excluded++;continue;
    }
    byPrompt.set(key,{messages:[{role:'user',content:messages[0].content.trim()},{role:'assistant',content:answer}]});
  }
  const rows=[...byPrompt.entries()].filter(([,v])=>v).sort(([a],[b])=>a.localeCompare(b));
  if (rows.length<20) {const error=Error('training_needs_20_approved_examples');error.count=rows.length;throw error;}
  const evalCount=Math.max(2,Math.floor(rows.length*.1));
  const serialize=values=>values.map(([,r])=>JSON.stringify(r)).join('\n')+'\n';
  const train=serialize(rows.slice(evalCount)),validation=serialize(rows.slice(0,evalCount));
  return {train,validation,trainCount:rows.length-evalCount,validationCount:evalCount,excluded};
}

async function trainingBundle(training) {
  // exportJsonl enforces consent/anonymization/publication for private examples.
  const data=prepareDataset(await training.exportJsonl());
  const manifest={schema:1,model:profile.training.base,revision:profile.training.revision,method:'bf16-lora',
    createdAt:new Date().toISOString(),minimumFreeVramGiB:10,sequenceLength:2048,
    train:{file:'train.jsonl',count:data.trainCount,sha256:hash(data.train)},
    validation:{file:'validation.jsonl',count:data.validationCount,sha256:hash(data.validation)},
    excluded:data.excluded,scope:'approved-global-training',mode:'text',visionLayers:'frozen',
    automaticProductionPromotion:false};
  const zip=new JSZip();
  zip.file('manifest.json',JSON.stringify(manifest,null,2));zip.file('train.jsonl',data.train);zip.file('validation.jsonl',data.validation);
  for(const name of ['train_qwen4.py','requirements-training.txt','README.md']) {
    zip.file(name,await fs.readFile(path.join(__dirname,'../deploy/hybrid/training',name)));
  }
  return {buffer:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),manifest};
}
function trainingStatus() {
  return {ok:true,model:profile.training.base,method:'bf16-lora',minimumFreeVramGiB:10,minimumExamples:20,
    mode:'text',visionLayers:'frozen',execution:'downloadable-dedicated-runner',autoPromotion:false,
    message:'เตรียมชุดฝึกจากตัวอย่างที่อนุมัติ แล้วรันบนเครื่องฝึกที่มี VRAM ว่างอย่างน้อย 10 GB ระบบไม่เริ่มฝึกบนเครื่องบริการและไม่ส่งข้อมูลไปคลาวด์อัตโนมัติ'};
}
module.exports={prepareDataset,trainingBundle,trainingStatus};
