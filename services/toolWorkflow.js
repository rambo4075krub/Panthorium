'use strict';
const {StateGraph,Annotation,START,END}=require('@langchain/langgraph');
// Request-scoped graph: no configured tracer, persistence, retries or action replay.
// Identity, permissions and approval stay in the existing tool executor.
const State=Annotation.Root({round:Annotation(),done:Annotation()});
async function runToolWorkflow({modelStep,toolStep,signal}) {
  const check=()=>signal?.throwIfAborted();
  const graph=new StateGraph(State)
    .addNode('model',async state=>{check();return {done:await modelStep(state.round)};})
    .addNode('tools',async state=>{check();return {done:await toolStep(),round:state.round+1};})
    .addEdge(START,'model')
    .addConditionalEdges('model',s=>s.done?END:'tools')
    .addConditionalEdges('tools',s=>s.done?END:'model')
    .compile();
  return graph.invoke({round:0,done:false},{recursionLimit:10,signal,callbacks:[]});
}
module.exports={runToolWorkflow};
