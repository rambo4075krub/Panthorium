'use strict';
const { TOOL_DEFINITIONS } = require('./agentFunctionCallingService');
const UI_IDS = new Set(['screen.command', ...['open','close','refresh','minimize','maximize','fullscreen','restore'].map(op=>`window.${op}`)]);
function withChatUiActions(base, {user,broker,signal,send,authorize}) {
  if (!base || typeof broker?.dispatch !== 'function' || typeof send !== 'function' || !user?.sub || !user.sid || user.roles?.includes('guest') || user.sub.startsWith('guest:')) return base;
  return {
    declarationsFor(principal) {
      return [...base.declarationsFor(principal), ...base.declarationsFor(principal,{surface:'gemini-live'}).filter(item=>UI_IDS.has(TOOL_DEFINITIONS.find(def=>def.name===item.name)?.toolId))];
    },
    async execute(input) {
      const definition=TOOL_DEFINITIONS.find(item=>item.name===input.call?.name);
      if (!UI_IDS.has(definition?.toolId)) return base.execute(input);
      const execution=await base.execute({...input,source:'gemini-live'});
      if (!execution.ok || !execution.output?.uiAction) return execution;
      let args=input.call.args;
      if(typeof args==='string') args=JSON.parse(args);
      const receipt=await broker.dispatch({user,toolId:definition.toolId,args,action:execution.output.uiAction,signal,send,authorize});
      const text=receipt.ok
        ? receipt.confirmationRequired ? 'คำสั่งหน้าจอยังไม่ดำเนินการ โปรดตรวจรายละเอียดและกดยืนยันหรือยกเลิกในบัตรบนหน้าจอ' : receipt.text || 'เบราว์เซอร์ยืนยันผลคำสั่งแล้ว'
        : 'ยังยืนยันผลคำสั่งหน้าจอไม่ได้ โปรดตรวจหน้าต่างก่อนสั่งซ้ำ';
      return {...execution,ok:receipt.ok,output:receipt,uiCompletion:text,functionResponse:{...execution.functionResponse,response:{output:receipt}}};
    }
  };
}
module.exports={withChatUiActions,UI_IDS};
