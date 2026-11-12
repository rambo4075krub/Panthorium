'use strict';
const assert = require('node:assert/strict');
const { ProviderManager } = require('../services/providerManager');
const { AiGateway } = require('../services/aiGateway');
const { enforceAiMode } = require('../services/aiModePolicy');
const { createLocalAppCompletion } = require('../services/localAppCompletion');
const { createMailboxCompletion } = require('../services/mailbox/completion');
const { completeLive } = require('../services/geminiLiveCompletion');
const { connectGeminiLive } = require('../services/geminiLiveVertex');
const { synthesizeSentinelMaleVoice } = require('../services/sentinelSpeechAudio');

(async () => {
  const saved = { ...process.env }, originalFetch = global.fetch;
  try {
    Object.assign(process.env, { PANTHORIUM_AI_MODE:'local-only', PANTHORIUM_LOCAL_QWEN:'1',
      GEMINI_LIVE_ENABLED:'1', AI_PRIORITY:'gemini-live,openai', OPENAI_API_KEY:'fixture',
      GOOGLE_APPLICATION_CREDENTIALS:'shared-google-identity', SENTINEL_TEACHER_PROVIDERS:'vertex' });
    delete process.env.PANTHORIUM_LOCAL_PROFILE;
    delete process.env.LOCAL_LLM_URL;
    enforceAiMode();
    assert.equal(process.env.GEMINI_LIVE_ENABLED,'0');
    assert.equal(process.env.AI_PRIORITY,'local');
    assert.equal(process.env.SENTINEL_TEACHER_PROVIDERS,'');
    assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS,'shared-google-identity');
    const providers = new ProviderManager();
    providers.authorizeLocal = async id => id === 'owner';
    providers.entitlements = { state:async()=>{ throw Error('Local-only routing must not consult paid credit'); } };
    assert.equal(providers.hybrid,true);
    assert.deepEqual(providers.available(),['local']);
    assert.deepEqual(providers.evaluationAvailable(),['local']);
    const calls = [];
    const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
    global.fetch = async (url, options) => {
      assert.equal(new URL(url).origin,'http://127.0.0.1:8765','no external AI request may escape');
      assert.equal(options.redirect,'error');
      calls.push({url:String(url),options});
      if (String(url).endsWith('/speech')) return new Response(wav);
      if (String(url).endsWith('/transcribe')) return Response.json({text:'ทดสอบเสียงในเครื่อง'});
      return Response.json({choices:[{finish_reason:'stop',message:{content:'คำตอบในเครื่อง'}}]});
    };
    const gateway=new AiGateway({providers});
    const result=await gateway.complete({userId:'owner',systemPrompt:'brief',history:[{role:'user',content:'สวัสดี'}],preferredProvider:'gemini-live'});
    assert.equal(result.ok,true);assert.equal(result.provider,'local');assert.equal(result.billable,false);assert.equal(result.creditsCharged,0);
    assert.equal(calls.length,1);
    for (const provider of ['gemini-live','gemini','vertex','openai','groq','anthropic']) await assert.rejects(providers.callDetailed(provider,'s',[],{userId:'owner'}),/provider_not_available/);
    await assert.rejects(completeLive({connect:()=>{throw Error('connection attempted');}}),/cloud_ai_disabled/);
    await assert.rejects(connectGeminiLive({authClient:{getAccessToken(){throw Error('token requested');}}}),/cloud_ai_disabled/);
    await assert.rejects(providers.vertexAccessToken(),/cloud_ai_disabled/);
    assert.equal(calls.length,1);
    const speech=await synthesizeSentinelMaleVoice('ทดสอบ','th-TH',{userId:'owner'});
    assert.equal(speech.contentType,'audio/wav');assert.equal(speech.voice,'local-th_m_1');
    assert.equal((await providers.transcribeAudio(Buffer.from('fixture'),'audio/wav','th-TH',{userId:'owner'})).provider,'local');
    const before=calls.length;
    await assert.rejects(providers.transcribeAudio(Buffer.from('fixture'),'audio/wav','th-TH',{userId:'other'}),/local_access_denied/);
    assert.equal(calls.length,before);
    const user={sub:'owner',roles:['administrator'],permissions:['chat']};
    const mail=await createMailboxCompletion(gateway)({user,provider:'gemini-live',question:'สรุป',sources:[{id:'S1',text:'ตัวอย่าง'}]});
    assert.equal(mail.provider,'local');
    const draft=await createLocalAppCompletion({gateway})({user,systemPrompt:'Return ONLY valid JSON\nUntrusted source data',messages:[{role:'user',content:'งานตัวอย่าง'}]});
    assert.equal(draft.provider,'local');assert.deepEqual(JSON.parse(draft.text).sourceIds,[]);
    assert.equal(draft.billable,false);
    const failedCalls=[];
    global.fetch=async url=>{failedCalls.push(String(url));return Response.json({detail:'local_resource_ram_headroom'},{status:503});};
    const failed=await gateway.complete({userId:'owner',systemPrompt:'s',history:[{role:'user',content:'test'}]});
    assert.equal(failed.ok,false);assert.equal(failed.error,'local_resource_ram_headroom');
    assert.deepEqual(failedCalls,['http://127.0.0.1:8765/v1/chat/completions']);
    process.env.PANTHORIUM_QWEN_DISABLED='1';assert.deepEqual(providers.available(),[]);
    console.log('PASS local-only production: chat, voice, drafts, mailbox, authorization, resource failure and no cloud fallback');
  } finally {
    global.fetch=originalFetch;
    for (const key of Object.keys(process.env)) delete process.env[key];Object.assign(process.env,saved);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
