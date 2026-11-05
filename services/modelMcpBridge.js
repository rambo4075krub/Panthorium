'use strict';
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {Server} = require('@modelcontextprotocol/sdk/server/index.js');
const {InMemoryTransport} = require('@modelcontextprotocol/sdk/inMemory.js');
const {ListToolsRequestSchema,CallToolRequestSchema} = require('@modelcontextprotocol/sdk/types.js');
const scopes=['panthorium:read'];
// Internal, per-request MCP session: identity comes from verified UI auth, never
// from model arguments. This does not grant OAuth scopes to external clients.
async function requestMcp(service,user,requestId,name,args) {
  const server=new Server({name:'panthorium-internal-read',version:'1.0.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:service.listTools(user,{scopes})}));
  server.setRequestHandler(CallToolRequestSchema,async r=>service.callTool(user,r.params.name,r.params.arguments,requestId,{scopes}));
  const client=new Client({name:'panthorium-model-tools',version:'1.0.0'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  try {await server.connect(a);await client.connect(b);return name?await client.callTool({name,arguments:args}):await client.listTools();}
  finally {await client.close();await server.close();}
}
function attachModelMcp(functionCalling,service) {
  if(!service)return functionCalling;
  const originalDeclarations=functionCalling.declarationsFor.bind(functionCalling);
  const originalExecute=functionCalling.execute.bind(functionCalling);
  functionCalling.declarationsFor=function(user,options) {
    const tools=service.listTools(user,{scopes});
    if(!tools.length)return originalDeclarations(user,options);
    return [...originalDeclarations(user,options),
      {name:'panthorium_mcp_list',description:'List read-only tools on the Panthorium MCP server for this account. Call before mcp_call to get exact argument schemas.',parameters:{type:'OBJECT',properties:{}}},
      {name:'panthorium_mcp_call',description:'Call a read-only Panthorium MCP tool from mcp_list. Use its exact JSON schema. No external server URLs, credentials or account IDs are accepted.',parameters:{type:'OBJECT',properties:{name:{type:'STRING',enum:tools.map(t=>t.name)},argumentsJson:{type:'STRING',description:'JSON object matching the selected tool inputSchema.'}},required:['name','argumentsJson']}}];
  };
  functionCalling.execute=async function(input) {
    const {user,call,requestId}=input||{};
    if(!['panthorium_mcp_list','panthorium_mcp_call'].includes(call?.name))return originalExecute(input);
    let output;
    try {
      if(!this.declarationsFor(user).some(t=>t.name===call.name))throw new Error('function_not_available');
      if(typeof call.id!=='string'||call.id.length>128||/[\x00-\x1f]/.test(call.id))throw new Error('invalid_function_call_id');
      const args=call.args;
      if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('invalid_tool_args');
      if(call.name==='panthorium_mcp_list') {
        const r=await requestMcp(service,user,requestId);
        output={ok:true,tools:r.tools.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema}))};
      } else {
        if(typeof args.argumentsJson!=='string'||args.argumentsJson.length>8000||!service.listTools(user,{scopes}).some(t=>t.name===args.name))throw new Error('invalid_tool_args');
        const r=await requestMcp(service,user,requestId,args.name,JSON.parse(args.argumentsJson));
        output={ok:!r.isError,result:r.structuredContent||r.content};
      }
    }catch {output={ok:false,error:'mcp_tool_unavailable_or_denied'};}
    return {ok:output.ok,toolId:'mcp.read',output,functionResponse:{id:call.id,name:call.name,response:output}};
  };
  return functionCalling;
}
module.exports={attachModelMcp,requestMcp};
