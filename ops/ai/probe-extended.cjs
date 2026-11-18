'use strict';
// Synthetic, bounded integration probe. Never print keys, prompts or audio.
const WebSocket=require('ws');
const key=process.env.SENTINEL_PROBE_API_KEY;
if(!key)throw new Error('probe_credential_required');
async function probe(modality,withTool=false){
  return new Promise(resolve=>{
    let ended=false,turn=0,ready=false,nextPending=false,toolCalls=0,outputBytes=0;
    const records=[];
    const ws=new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
      {headers:{'x-goog-api-key':key},handshakeTimeout:10000,maxPayload:1024*1024});
    const finish=value=>{if(ended)return;ended=true;clearTimeout(timer);ws.terminate();resolve({modality,withTool,ready,turn,toolCalls,outputBytes,records,...value});};
    const timer=setTimeout(()=>finish({ok:false,reason:'deadline'}),40000);
    const sendTurn=()=>{turn++;ws.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:withTool?'Call panthorium_probe_number, then say its number.':turn===1?'Say only the number four.':'Say only the number five.'}]}],turnComplete:true}}));};
    ws.on('open',()=>ws.send(JSON.stringify({setup:{model:'models/gemini-3.8-live-extended-thinking',
      generationConfig:{responseModalities:[modality],maxOutputTokens:2048,thinkingConfig:{thinkingLevel:'HIGH'}},
      ...(modality==='AUDIO'?{outputAudioTranscription:{}}:{}),
      ...(withTool?{systemInstruction:{parts:[{text:'When asked for the probe number, you must call panthorium_probe_number. The number is only available through that tool. After the result, say only its number.'}]}}:{}),
      ...(withTool?{tools:[{functionDeclarations:[{name:'panthorium_probe_number',description:'Return the test number.',behavior:'NON_BLOCKING',parameters:{type:'OBJECT',properties:{}}}]}]}:{})}})));
    ws.on('error',error=>finish({ok:false,errorType:error.name}));
    ws.on('close',(code,reason)=>finish({ok:false,code,reason:String(reason).replaceAll(key,'[redacted]').slice(0,240)}));
    ws.on('message',raw=>{
      if(ended)return;
      let frame;try{frame=JSON.parse(String(raw));}catch{return finish({ok:false,reason:'invalid_json'});}
      if(frame.error)return finish({ok:false,errorCode:frame.error.code,errorStatus:frame.error.status});
      if(frame.setupComplete||frame.setup_complete){ready=true;sendTurn();}
      const content=frame.serverContent||frame.server_content||{};
      const usage=frame.usageMetadata||frame.usage_metadata;
      if(usage)records.push({turn,usage});
      for(const part of content.modelTurn?.parts||content.model_turn?.parts||[]){const audio=part.inlineData||part.inline_data;if(audio?.data)outputBytes+=Buffer.from(audio.data,'base64').length;}
      const calls=(frame.toolCall||frame.tool_call)?.functionCalls||(frame.toolCall||frame.tool_call)?.function_calls||[];
      if(calls.length){
        toolCalls+=calls.length;
        if(calls.some(c=>c.name!=='panthorium_probe_number')||toolCalls>2)return finish({ok:false,reason:'unexpected_tool'});
        ws.send(JSON.stringify({toolResponse:{functionResponses:calls.map(c=>({id:c.id,name:c.name,response:{number:4}}))}}));
      }
      const status=content.interactionStatus||content.interaction_status||frame.interactionStatus||frame.interaction_status;
      if(status)records.push({turn,status,turnComplete:!!(content.turnComplete||content.turn_complete)});
      if(status==='IDLE'&&turn&&!nextPending){nextPending=true;setTimeout(()=>{if(ended)return;if(withTool||turn===2)finish({ok:records.some(r=>r.usage)&&(!withTool||toolCalls>0)});else{nextPending=false;sendTurn();}},400);}
    });
  });
}
(async()=>{const cases=process.env.SENTINEL_PROBE_CASE==='tool'?[['AUDIO',true]]:[['AUDIO',false],['TEXT',false],['AUDIO',true]];for(const args of cases)console.log(JSON.stringify(await probe(...args)));})().catch(error=>{console.log(JSON.stringify({ok:false,errorType:error.name}));process.exitCode=1;});
