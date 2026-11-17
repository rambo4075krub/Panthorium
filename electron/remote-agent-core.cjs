'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {CAPABILITIES,validateSteps,relative,fail}=require('./remote-protocol.cjs');
const MAX_READ=48000;
const inside=(root,file)=>file===root || file.startsWith(root+path.sep);

class RemoteAgentCore {
  constructor({root,userId,request,scopes=[],platform=process.platform,desktop,openUrl,now=Date.now}) {
    this.root=path.resolve(root);this.userId=userId;this.request=request;this.scopes=new Set(scopes);
    this.platform=platform;this.desktop=desktop;this.openUrl=openUrl;this.now=now;this.running=null;
    this.stopped=false;this.timer=null;this.polling=false;this.limitBytes=0;this.onStatus=()=>{};
  }
  async init() {
    await fs.mkdir(this.root,{recursive:true,mode:0o700});this.root=await fs.realpath(this.root);
    await fs.mkdir(path.join(this.root,'.panthorium','jobs'),{recursive:true,mode:0o700});
    await this.pruneJournals();
  }
  async resolve(relativePath,{write=false,internal=false}={}) {
    if(!relative(relativePath)) fail('invalid_workspace_path');
    const parts=relativePath.replace(/\\/g,'/').split('/');
    if(!internal && parts.some(p=>p.toLowerCase()==='.panthorium'))fail('protected_workspace_path',403);
    const target=path.resolve(this.root,...parts);if(!inside(this.root,target))fail('workspace_path_denied',403);
    let cursor=target;
    for(;;) {
      try { const actual=await fs.realpath(cursor);if(!inside(this.root,actual))fail('workspace_symlink_denied',403);break; }
      catch(e) { if(e.code!=='ENOENT'||!write)throw e;const parent=path.dirname(cursor);if(parent===cursor)throw e;cursor=parent; }
    }
    // Reject symlinks even when they happen to point inside the workspace. This
    // prevents a later rename from changing the meaning of a stored workflow.
    cursor=this.root;
    for(const part of parts) {
      cursor=path.join(cursor,part);
      try { if((await fs.lstat(cursor)).isSymbolicLink())fail('workspace_symlink_denied',403); }
      catch(e){if(e.code==='ENOENT'&&write)break;throw e;}
    }
    return target;
  }
  async usage() {
    let bytes=0,count=0;
    const walk=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
      if(++count>100000)fail('workspace_file_count_limit',413);
      const p=path.join(dir,entry.name);
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()) { if(['chats','jobs'].some(name=>p===path.join(this.root,'.panthorium',name)))continue; await walk(p); }
      else if(entry.isFile())bytes+=(await fs.stat(p)).size;
    }};
    await walk(this.root);return bytes;
  }
  async journal(id,value) {
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))fail('invalid_job_id');
    const file=path.join(this.root,'.panthorium','jobs',id+'.json');
    if(value===undefined) {try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
    const temporary=file+'.tmp';await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600});await fs.rename(temporary,file);
  }
  async pruneJournals() {
    const folder=path.join(this.root,'.panthorium','jobs'),entries=[];
    for(const name of await fs.readdir(folder)) {
      if(!/^[A-Za-z0-9_-]+\.json$/.test(name))continue;
      const file=path.join(folder,name),stat=await fs.lstat(file);
      if(stat.isFile())entries.push({file,time:stat.mtimeMs});
    }
    entries.sort((a,b)=>b.time-a.time);
    for(let i=0;i<entries.length;i++)if(i>=500||entries[i].time<this.now()-30*86400000)await fs.rm(entries[i].file,{force:true});
  }
  async writeFile(relativePath,content,{overwrite=false,internal=false,accounted=true}={}) {
    const target=await this.resolve(relativePath,{write:true,internal});
    let old=0;try{const s=await fs.stat(target);if(!s.isFile())fail('workspace_not_a_file');if(!overwrite)fail('workspace_file_exists',409);old=s.size;}catch(e){if(e.code!=='ENOENT')throw e;}
    const bytes=Buffer.byteLength(content);
    if(accounted&&(await this.usage())-old+bytes>this.limitBytes)fail('personal_storage_full',413);
    await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    // Revalidate after directory creation, and never follow a final symlink.
    await this.resolve(relativePath,{write:true,internal});
    if(!overwrite) {const h=await fs.open(target,'wx',0o600);try{await h.writeFile(content);}finally{await h.close();}}
    else {const temp=target+'.panthorium-'+require('node:crypto').randomUUID()+'.tmp';await fs.writeFile(temp,content,{mode:0o600,flag:'wx'});await fs.rename(temp,target);}
    return {path:relativePath,bytes};
  }
  async process(command,timeoutSeconds=120,signal) {
    // This capability is separately consented to on the computer. cwd is NOT
    // presented as an OS sandbox: a granted shell has this OS user's privileges.
    const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','LANG','LC_ALL']) if(process.env[key])env[key]=process.env[key];
    return new Promise((resolve,reject)=>{
      const child=spawn(command,[],{cwd:this.root,shell:true,windowsHide:true,env,detached:this.platform!=='win32',stdio:['ignore','pipe','pipe']});
      let output='',truncated=false,reason='',timer,monitor,checking=false;
      const kill=why=>{if(reason)return;reason=why;
        if(this.platform==='win32') {const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}
        else try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}
      };
      const abort=()=>kill('cancelled');
      const add=chunk=>{const remaining=MAX_READ-Buffer.byteLength(output);if(remaining>0)output+=chunk.subarray(0,remaining).toString('utf8');else truncated=true;};
      child.stdout.on('data',add);child.stderr.on('data',add);
      child.once('error',error=>{clearTimeout(timer);clearInterval(monitor);signal?.removeEventListener('abort',abort);reject(error);});
      child.once('close',(code,sig)=>{clearTimeout(timer);clearInterval(monitor);signal?.removeEventListener('abort',abort);resolve({exitCode:code,signal:sig,output,truncated,...(reason?{error:reason}:{})});});
      timer=setTimeout(()=>kill('process_timeout'),timeoutSeconds*1000);
      monitor=setInterval(async()=>{if(checking)return;checking=true;try{if(await this.usage()>this.limitBytes)kill('personal_storage_full');}catch{kill('workspace_usage_unavailable');}finally{checking=false;}},1000);
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });
  }
  async executeStep(step,signal) {
    if(signal?.aborted)fail('cancelled');
    if(!this.scopes.has(CAPABILITIES[step.op]))fail('device_permission_denied',403);
    const a=step.args;
    if(step.op.startsWith('chat.')) {
      const relativePath='.panthorium/chats/'+a.id+'.json';
      if(step.op==='chat.write') {
        const file=await this.resolve(relativePath,{write:true,internal:true});
        try{const previous=JSON.parse(await fs.readFile(file,'utf8'));if(previous.serverVersion>a.version)fail('chat_version_conflict',409);}catch(e){if(e.code!=='ENOENT')throw e;}
        const data=JSON.parse(a.content);if(data.owner!==this.userId||data.id!==a.id||data.serverVersion!==a.version)fail('chat_owner_mismatch',403);
        return this.writeFile(relativePath,a.content,{overwrite:true,internal:true,accounted:false});
      }
      const file=await this.resolve(relativePath,{internal:true});
      if(step.op==='chat.delete'){await fs.unlink(file);return {deleted:a.id};}
      const stat=await fs.stat(file);if(stat.size>512*1024)fail('personal_chat_too_large',413);
      const content=await fs.readFile(file,'utf8'),data=JSON.parse(content);if(data.owner!==this.userId)fail('chat_owner_mismatch',403);
      return {content,version:data.serverVersion};
    }
    if(step.op==='files.list') {
      const dir=await this.resolve(a.path||'.');const entries=[];
      for(const item of await fs.readdir(dir,{withFileTypes:true})) {if(item.name==='.panthorium'||item.isSymbolicLink())continue;if(entries.length>=300)break;entries.push({name:item.name,type:item.isDirectory()?'directory':'file'});}
      return {entries,limit:300};
    }
    if(step.op==='files.read'||step.op==='memory.read') {
      const file=await this.resolve(step.op==='memory.read'?'memory/'+a.path:a.path);const stat=await fs.stat(file);
      if(!stat.isFile())fail('workspace_not_a_file');
      const handle=await fs.open(file,'r');try{const buffer=Buffer.alloc(Math.min(stat.size,MAX_READ));const {bytesRead}=await handle.read(buffer,0,buffer.length,0);return {path:a.path,content:buffer.subarray(0,bytesRead).toString('utf8'),bytes:stat.size,truncated:stat.size>MAX_READ};}finally{await handle.close();}
    }
    if(step.op==='files.write'||step.op==='memory.write')return this.writeFile(step.op==='memory.write'?'memory/'+a.path:a.path,a.content,{overwrite:a.overwrite===true});
    if(step.op==='files.mkdir'){const file=await this.resolve(a.path,{write:true});await fs.mkdir(file,{recursive:true,mode:0o700});return {path:a.path};}
    if(step.op==='files.move'){const from=await this.resolve(a.path),to=await this.resolve(a.destination,{write:true});if(from===this.root)fail('workspace_root_protected');try{await fs.lstat(to);fail('workspace_file_exists',409);}catch(e){if(e.code!=='ENOENT')throw e;}await fs.rename(from,to);return {path:a.destination};}
    if(step.op==='files.remove'){const file=await this.resolve(a.path);if(file===this.root)fail('workspace_root_protected');const s=await fs.lstat(file);if(s.isDirectory())await fs.rmdir(file);else await fs.unlink(file);return {removed:a.path};}
    if(step.op==='process.run')return this.process(a.command,a.timeoutSeconds,signal);
    if(step.op==='browser.open'){if(!this.openUrl)fail('browser_unavailable');await this.openUrl(a.url);return {opened:true,url:a.url};}
    if(step.op.startsWith('desktop.')){if(!this.desktop)fail('desktop_unavailable');return this.desktop(step.op,a,signal);}
    fail('unsupported_remote_operation');
  }
  async run(job) {
    const old=await this.journal(job.id);
    if(old) {
      // A crashed/running record must never replay a side effect automatically.
      return {...old,state:old.state==='running'?'unknown':old.state,result:old.state==='running'?{error:'agent_restarted_outcome_unknown',inactive:true,journal:'.panthorium/jobs/'+job.id+'.json'}:old.result};
    }
    const steps=validateSteps(job.steps);const controller=new AbortController();
    this.running={job,controller};
    const record={id:job.id,leaseToken:job.leaseToken,state:'running',startedAt:this.now(),steps:[]};
    await this.journal(job.id,record);
    try {
      for(let i=0;i<steps.length;i++) {
        if(controller.signal.aborted)fail('cancelled');
        const output=await this.executeStep(steps[i],controller.signal);
        record.steps.push({index:i,op:steps[i].op,output});await this.journal(job.id,record);
        if(output.error||steps[i].op==='process.run'&&output.exitCode!==0)fail(output.error||'process_failed');
      }
      record.state='succeeded';
    }catch(e){record.state=controller.signal.aborted||e.message==='cancelled'?'cancelled':'failed';record.error=e.code||e.message;}
    record.completedAt=this.now();
    const outputs=record.steps.map(({index,op,output})=>({index,op,output}));
    const candidate={steps:outputs,error:record.error,journal:'.panthorium/jobs/'+job.id+'.json'};
    record.result=Buffer.byteLength(JSON.stringify(candidate))<=700*1024?candidate:{steps:outputs.map(s=>({index:s.index,op:s.op})),error:record.error,truncated:true,journal:candidate.journal};
    await this.journal(job.id,record);return record;
  }
  async report(record) {
    const response=await this.request('/agent/jobs/'+encodeURIComponent(record.id)+'/result',{state:record.state,leaseToken:record.leaseToken,result:record.result,workspaceBytes:await this.usage()});
    // The relay acknowledged the result. Keep a small replay-prevention receipt,
    // without retaining a second copy of transcripts, screenshots or file data.
    await this.journal(record.id,{id:record.id,leaseToken:record.leaseToken,state:record.state,completedAt:record.completedAt||this.now(),acknowledged:true,result:{delivered:true}});
    await this.pruneJournals();return response;
  }
  async tick() {
    if(this.stopped||this.polling)return;this.polling=true;
    try {
      const result=await this.request('/agent/poll',{workspaceBytes:await this.usage(),...(this.running?{jobId:this.running.job.id,leaseToken:this.running.job.leaseToken}:{})});
      this.limitBytes=result.maxWorkspaceBytes;this.scopes=new Set(result.scopes.filter(scope=>this.localScopes?.has(scope)??true));
      this.onStatus({online:true,quota:result.quota,running:this.running?.job.id||null});
      if(result.cancelRequested)this.running?.controller.abort();
      if(result.reconcile&&!this.running) {
        const record=await this.journal(result.reconcile.jobId);
        await this.report(record&&record.state!=='running'?record:{id:result.reconcile.jobId,leaseToken:result.reconcile.leaseToken,state:'unknown',result:{error:'execution_outcome_unknown',inactive:true}});
      }
      if(result.job&&!this.running) {
        const promise=this.run(result.job);
        promise.then(record=>this.report(record)).catch(error=>this.onStatus({online:false,error:error.message})).finally(()=>{this.running=null;});
      }
    }catch(e){this.onStatus({online:false,error:e.message});if(e.status===401||e.status===403){this.running?.controller.abort();this.stop();}}
    finally{this.polling=false;}
  }
  async start() {await this.init();this.stopped=false;this.localScopes=new Set(this.scopes);await this.tick();this.timer=setInterval(()=>this.tick(),10000);this.timer.unref?.();}
  stop(){this.stopped=true;clearInterval(this.timer);this.timer=null;this.running?.controller.abort();}
}
module.exports={RemoteAgentCore,inside};
