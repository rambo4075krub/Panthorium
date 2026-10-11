'use strict';
class LiveQuotaMeter {
  constructor({entitlements,userId}){this.entitlements=entitlements;this.userId=userId;this.seconds={voiceInputSeconds:0,voiceOutputSeconds:0};this.charged={voiceInputSeconds:0,voiceOutputSeconds:0,textInputTokens:0,textOutputTokens:0};}
  audio(part,key){
    const mime=part?.mimeType || part?.mime_type || '';
    if(!part)return;
    if(!mime.startsWith('audio/pcm'))throw new Error('unsupported_media_usage');
    const rate=Number(/rate=(\d+)/.exec(mime)?.[1]);
    if(![16000,24000,48000].includes(rate) || typeof part.data!=='string')throw new Error('invalid_audio_usage');
    this.seconds[key]+=Buffer.from(part.data,'base64').length/(rate*2);
  }
  async input(frame){
    const input=frame.realtimeInput || frame.realtime_input;
    if(input){if(input.audio)this.audio(input.audio,'voiceInputSeconds');for(const p of input.mediaChunks || input.media_chunks || [])this.audio(p,'voiceInputSeconds');}
    for(const turn of (frame.clientContent || frame.client_content)?.turns || [])for(const part of turn.parts || [])if(part.inlineData || part.inline_data)this.audio(part.inlineData || part.inline_data,'voiceInputSeconds');
    await this.charge({voiceInputSeconds:Math.ceil(this.seconds.voiceInputSeconds)});
  }
  async output(frame){
    const content=frame.serverContent || frame.server_content;
    for(const part of content?.modelTurn?.parts || content?.model_turn?.parts || [])this.audio(part.inlineData || part.inline_data,'voiceOutputSeconds');
    const totals={voiceOutputSeconds:Math.ceil(this.seconds.voiceOutputSeconds)};
    const usage=frame.usageMetadata || frame.usage_metadata;
    if(usage){
      for(const [key,list] of [['textInputTokens',usage.promptTokensDetails || usage.prompt_tokens_details],['textOutputTokens',usage.responseTokensDetails || usage.response_tokens_details || usage.candidatesTokensDetails || usage.candidates_tokens_details]]){
        if(Array.isArray(list))totals[key]=list.filter(p=>String(p.modality).toUpperCase()==='TEXT').reduce((n,p)=>n+Number(p.tokenCount ?? p.token_count ?? 0),0);
      }
    }
    await this.charge(totals);
  }
  async charge(totals){
    const delta={};for(const [k,v] of Object.entries(totals)){if(!Number.isSafeInteger(v)||v<0)throw new Error('invalid_usage');if(v>this.charged[k])delta[k]=v-this.charged[k];}
    if(Object.keys(delta).length){await this.entitlements.consume(this.userId,delta);for(const [k,v] of Object.entries(delta))this.charged[k]+=v;}
  }
}
module.exports={LiveQuotaMeter};
