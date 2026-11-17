'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {RemoteAgentCore}=require('../electron/remote-agent-core.cjs');
const {createNativeRemoteAgent}=require('../electron/remote-agent.cjs');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'panthorium-native-'));
  const handlers=new Map(),events=new Map(),requests=[];let consent=0,revoked=false,background=false,encrypted=true;
  const electron={
    app:{getPath:name=>name==='exe'?process.execPath:path.join(root,name),setLoginItemSettings:()=>{},on:(name,fn)=>events.set(name,fn)},
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},
    dialog:{showMessageBox:async()=>({response:consent}),showOpenDialog:async()=>({filePaths:[path.join(root,'documents')],canceled:false})},
    safeStorage:{isEncryptionAvailable:()=>encrypted,getSelectedStorageBackend:()=> 'test-keyring',encryptString:s=>Buffer.from('protected:'+s),decryptString:b=>b.toString().slice(10)},
    shell:{openExternal:async()=>{}},
    net:{fetch:async(url,options)=>{
      requests.push({url,headers:options.headers,body:JSON.parse(options.body)});let body={ok:true},status=200;
      if(url.endsWith('/pairing/start'))body={ok:true,code:'ABCDEF012345',pairingId:'device-one',deviceSecret:'fixture-secret-do-not-return-to-renderer'};
      else if(url.endsWith('/pairing/status'))body={ok:true,userId:'account-a',deviceId:'device-one'};
      else if(url.endsWith('/agent/poll'))body={ok:true,scopes:['files.read','chat.sync','process.run'],maxWorkspaceBytes:1024*1024,quota:{}};
      else if(url.endsWith('/agent/disconnect')&&revoked){body={ok:false,error:'invalid_device_token'};status=401;}
      return {ok:status===200,status,json:async()=>body};
    }}
  };
  const security={isTrustedShellEvent:e=>e.trusted===true};
  const native=createNativeRemoteAgent({electron,security,origin:'https://panthorium.net',background:v=>{background=v;}});
  const event={trusted:true,sender:{id:7}};native.setAccount(event.sender,'account-a');
  const invoke=(name,input,eventOverride=event)=>handlers.get('panthorium:remote-'+name)(eventOverride,input);
  try{
    assert.equal((await invoke('status',{}, {trusted:false,sender:event.sender})).error,'untrusted_origin');
    const setup={token:'short-lived-user-token',name:'Home',scopes:['files.read','chat.sync'],autoScopes:['files.read','chat.sync']};
    assert.equal((await invoke('connect',setup)).cancelled,true);assert.equal(requests.length,0,'no registration before local consent');
    consent=1;encrypted=false;assert.equal((await invoke('connect',setup)).error,'secure_device_storage_unavailable');encrypted=true;
    assert.equal((await invoke('connect',{...setup,autoScopes:['process.run']})).error,'invalid_device_permissions');
    const connected=await invoke('connect',setup);assert.equal(connected.ok,true);assert.equal(background,true);
    assert.equal(connected.workspace.startsWith(path.join(root,'documents','PanthoriumWorkspace')),true);
    assert.equal(JSON.stringify(connected).includes('fixture-secret'),false);
    const state=await invoke('status');assert.deepEqual(state.scopes,['files.read','chat.sync']);assert.equal(JSON.stringify(state).includes('fixture-secret'),false);
    const persisted=await fs.readFile(path.join(root,'userData','remote-agent.enc'),'utf8');assert.equal(persisted.includes('short-lived-user-token'),false,'bearer token is not persisted');
    const poll=requests.find(r=>r.url.endsWith('/agent/poll'));assert.equal(poll.headers.Authorization,'Device device-one:fixture-secret-do-not-return-to-renderer');
    native.setAccount(event.sender,'account-b');assert.equal((await invoke('status')).pairedElsewhere,true);assert.equal((await invoke('pause',{paused:true})).error,'device_account_mismatch');
    native.setAccount(event.sender,'account-a');await invoke('pause',{paused:true});assert.equal(background,false);
    revoked=true;assert.equal((await invoke('disconnect')).ok,true,'revoked credentials can still be removed locally');
    await assert.rejects(fs.stat(path.join(root,'userData','remote-agent.enc')),e=>e.code==='ENOENT');

    const core=new RemoteAgentCore({root:path.join(root,'executor'),userId:'account-a',scopes:['process.run','files.read'],request:async()=>({ok:true})});
    await core.init();core.limitBytes=1024*1024;
    const command='"'+process.execPath+'" -e "setInterval(()=>{},1000)"';
    const timeout=await core.process(command,0.08);assert.equal(timeout.error,'process_timeout');
    const controller=new AbortController(),running=core.process(command,10,controller.signal);setTimeout(()=>controller.abort(),80);assert.equal((await running).error,'cancelled');
    const success=await core.process('"'+process.execPath+'" -e "process.stdout.write(\'native-ok\')"',2);assert.equal(success.output,'native-ok');assert.equal(success.exitCode,0);
    await assert.rejects(core.executeStep({op:'files.write',args:{path:'denied.txt',content:'denied'}},new AbortController().signal),/device_permission_denied/);
    await core.journal('receipt',{id:'receipt',leaseToken:'lease',state:'succeeded',result:{content:'private transcript'}});
    assert.equal(await core.usage(),0,'bounded transport receipts are separate from user workspace accounting');
    await core.report(await core.journal('receipt'));assert.equal(JSON.stringify(await core.journal('receipt')).includes('private transcript'),false);
    core.limitBytes=0;const unarchived=await core.run({id:'no-space-read',title:'Read at full quota',leaseToken:'fixture',steps:[{op:'files.list',args:{path:'.'}}]});assert.equal(unarchived.state,'succeeded');assert.equal(unarchived.result.archiveError,'personal_storage_full','archive failure must be explicit without changing the actual work outcome');
    core.stop();
    console.log('PASS native remote: consent, trusted-origin and account checks, local grants, credential lifecycle, cancellation, timeout and receipt minimization');
  }finally{native.close();await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
