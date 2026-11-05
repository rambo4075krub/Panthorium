"""Poll CI-published Git refs; no GitHub credential or inbound webhook is used."""
from runtime import *
CACHE=ROOT/'source.git'
def git(args,**kwargs):
 env=dict(os.environ,GIT_TERMINAL_PROMPT='0',GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL=os.devnull)
 return command([GIT,'-c','credential.helper=','-c','core.hooksPath='+os.devnull,*args],env=env,**kwargs)
def remote_refs():
 names=['refs/heads/'+v['branch'] for v in STAGES.values()]+['refs/heads/deploy/notebook-'+s for s in STAGES]
 output=git(['ls-remote','--heads',REPO,*names],timeout=45)
 refs={}
 for line in output.splitlines():
  sha,name=line.split()
  if name in names and valid_sha(sha):refs[name]=sha
 return refs
def eligible(refs,stage):
 source=refs.get('refs/heads/'+STAGES[stage]['branch'])
 pointer=refs.get('refs/heads/deploy/notebook-'+stage)
 return source if valid_sha(source) and source==pointer else None
def prepare(stage,sha,source=None):
 if not valid_sha(sha):raise ValueError('invalid_release_sha')
 final=ROOT/'releases'/stage/sha
 ready=final/'notebook-release.json'
 if ready.exists():
  if read(ready).get('sha')!=sha:raise RuntimeError('release_receipt_mismatch')
  return {'stage':stage,'sha':sha,'path':str(final)}
 if final.exists():raise RuntimeError('incomplete_release_requires_review')
 final.parent.mkdir(parents=True,exist_ok=True)
 dest=ROOT/'builds'/stage/(sha+'-'+uuid.uuid4().hex[:8]);dest.mkdir(parents=True)
 try:
  if source:
   repo=Path(source)
  else:
   if not CACHE.exists():git(['init','--bare',CACHE])
   git(['-C',CACHE,'fetch','--no-tags',REPO,sha],timeout=180);repo=CACHE
  archive=dest/'source.tar'
  git(['-C',repo,'archive','--format=tar','--output',archive,sha],timeout=120)
  with tarfile.open(archive) as tf:
   for item in tf.getmembers():
    name=item.name.replace('\\','/')
    if item.issym() or item.islnk() or name.startswith('/') or ':' in name or '..' in name.split('/'):
     raise RuntimeError('unsafe_archive_member')
   tf.extractall(dest,filter='data')
  archive.unlink()
  for name in ['server.js','package-lock.json','services/diskObjectClient.js','services/notebookControl.js']:
   if not (dest/name).is_file():raise RuntimeError('notebook_runtime_support_missing')
  command([NODE,NPM,'ci','--omit=dev','--ignore-scripts','--engine-strict','--no-audit','--no-fund'],cwd=dest,timeout=600,logfile=dest/'install.log')
  for p in [dest/'server.js',dest/'routes'/'api.js',dest/'services'/'diskObjectClient.js',dest/'services'/'notebookControl.js']:
   command([NODE,'--check',p],timeout=30)
  compatibility=HOST/'deploy'/'compatibility.json'
  if compatibility.exists() and runtime_fingerprint(dest)!=read(compatibility)['fingerprint']:
   raise RuntimeError('host_runtime_update_required; app release deferred')
  atomic(dest/'notebook-release.json',{'sha':sha,'stage':stage,'preparedAt':utc(),'node':command([NODE,'--version'])})
  os.replace(dest,final)
 except BaseException:
  # Preserve failed build logs without treating the directory as a valid release.
  raise
 return {'stage':stage,'sha':sha,'path':str(final)}
def runtime_fingerprint(root):
 root=Path(root);files=set()
 for name in ['Dockerfile','ops/notebook/runtime.py','ops/notebook/agent.py','ops/notebook/edge.cjs','ops/notebook/smoke.cjs']:
  files.add(root/name)
 for prefix in ['speaker-service','build/media','build/libsndfile','build/zlib','build/security','build/alpine-security']:
  files.update(p for p in (root/prefix).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
 h=hashlib.sha256()
 for p in sorted(files,key=lambda p:p.relative_to(root).as_posix()):
  h.update(p.relative_to(root).as_posix().encode()+b'\0'+p.read_bytes()+b'\0')
 return h.hexdigest()
def probe(stage,new,backup,operation):
 root=operation/'probe';root.mkdir()
 db='panthorium_probe_'+stage+'_'+uuid.uuid4().hex[:8]
 spec={'db':db,'root':str(root)}
 state={**new,'port':STAGES[stage]['probe']}
 atomic(root/'probe.json',{'spec':spec,'state':state})
 try:
  restore_copy(stage,backup,db)
  (root/'uploads').mkdir()
  shutil.copy2(backup/'objects.sqlite3',root/'uploads'/'objects.sqlite3')
  start_backend(stage,state,spec);verify_readiness(stage,state)
  env=runtime_env(stage,state,spec)
  env.update(TEST_RELEASE=new['path'],TEST_STAGE=stage,TEST_PORT=str(state['port']),
    TEST_DB=env['DATABASE_URL'],TEST_UPLOADS=str(root/'uploads'/'objects.sqlite3'),
    TEST_SHA=new['sha'],TEST_INFERENCE='0')
  command([NODE,HOST/'deploy'/'smoke.cjs'],env=env,cwd=new['path'],timeout=120,logfile=operation/'probe-smoke.log')
 finally:
  stop_backend(stage,state,spec)
  drop_probe(db)
  if root.exists():shutil.rmtree(root)
def journal_path(stage):return HOST/stage/'deploy-journal.json'
def maintain(stage,state):
 value={**state,'maintenance':True}
 atomic(active_path(stage),value);return value
def rollback(stage,journal):
 old,new=journal['old'],journal['new'];maintain(stage,old)
 stop_backend(stage,new)
 failed=restore_before_exposure(stage,Path(journal['finalBackup']))
 atomic(active_path(stage),{**old,'maintenance':True})
 start_backend(stage,old);verify_readiness(stage,old)
 atomic(active_path(stage),{**old,'maintenance':False})
 verify_readiness(stage,old,front=True)
 journal.update(phase='rolled_back',failedDatabase=failed,finishedAt=utc())
 atomic(journal_path(stage),journal)
 atomic(HOST/stage/'failed-release.json',{'sha':new['sha'],'failedAt':utc(),'operation':journal['operation']})
 log(stage+' restored previous release before exposure')
def recover(stage):
 path=journal_path(stage)
 if not path.exists():return
 j=read(path);phase=j.get('phase')
 if phase in ['complete','rolled_back','preflight_failed','aborted']:return
 active=read(active_path(stage))
 # Never restore a database after users could have written to the new version.
 if active.get('sha')==j['new']['sha'] and not active.get('maintenance'):
  start_backend(stage,active);start_edge(stage);verify_readiness(stage,active,front=True)
  j.update(phase='complete',recoveredAt=utc());atomic(path,j);return
 start_edge(stage)
 if phase in ['candidate_starting','candidate_verified','rolling_back']:
  j['phase']='rolling_back';atomic(path,j);rollback(stage,j);return
 leftover=Path(j['operation'])/'probe'
 if (leftover/'probe.json').exists():
  info=read(leftover/'probe.json')
  stop_backend(stage,info['state'],info['spec']);drop_probe(info['spec']['db']);shutil.rmtree(leftover)
 old=j['old']
 # Candidate was not started: current data remains authoritative.
 start_backend(stage,old);atomic(active_path(stage),{**old,'maintenance':False})
 j.update(phase='aborted',finishedAt=utc());atomic(path,j)
def retention(stage):
 completed=[]
 for p in (ROOT/'operations'/stage).glob('*/operation.json'):
  try:
   item=read(p)
   if item.get('phase')=='complete':completed.append((p.parent,item))
  except (OSError,ValueError):continue
 completed.sort(key=lambda x:x[0].name,reverse=True)
 for folder,_ in completed[3:]:
  # Only generated, completed operations are eligible; preserve failures.
  if folder.parent==(ROOT/'operations'/stage) and re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}',folder.name):shutil.rmtree(folder)
 keep={read(active_path(stage))['sha']}
 for _,item in completed[:3]:
  keep.update([item['old']['sha'],item['new']['sha']])
 for p in (ROOT/'releases'/stage).iterdir():
  if p.is_dir() and valid_sha(p.name) and p.name not in keep and (p/'notebook-release.json').exists():
   shutil.rmtree(p)
def deploy(stage,sha,source=None,force=False):
 with lock(stage,wait=2):
  recover(stage)
  old=read(active_path(stage))
  if old['sha']==sha:return
  failed=HOST/stage/'failed-release.json'
  if not force and failed.exists() and read(failed).get('sha')==sha:
   log(stage+' candidate previously failed; awaiting a new commit');return
  if shutil.disk_usage(ROOT).free<8*1024**3:raise RuntimeError('less_than_8_GiB_free; deployment deferred')
  new=prepare(stage,sha,source)
  new['port']=next(p for p in STAGES[stage]['ports'] if p!=old['port'])
  new['maintenance']=False;new['activatedAt']=utc()
  operation=ROOT/'operations'/stage/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8])
  operation.mkdir(parents=True)
  j={'stage':stage,'old':old,'new':new,'phase':'preflight','operation':str(operation),'startedAt':utc()}
  atomic(journal_path(stage),j)
  try:
   snapshot(stage,operation/'preflight-backup')
   probe(stage,new,operation/'preflight-backup',operation)
  except BaseException:
   j.update(phase='preflight_failed',finishedAt=utc());atomic(journal_path(stage),j);atomic(operation/'operation.json',j)
   atomic(failed,{'sha':sha,'failedAt':utc(),'operation':str(operation)})
   raise
  # Re-check exact branch heads after potentially lengthy build and database tests.
  if source is None and eligible(remote_refs(),stage)!=sha:
   j.update(phase='aborted',reason='superseded_before_cutover',finishedAt=utc());atomic(journal_path(stage),j);return
  j['phase']='draining';atomic(journal_path(stage),j)
  maintain(stage,old);stop_backend(stage,old)
  try:
   final=operation/'before-activation';snapshot(stage,final)
  except BaseException:
   start_backend(stage,old);atomic(active_path(stage),old)
   j.update(phase='aborted',reason='backup_failed');atomic(journal_path(stage),j);raise
  j.update(finalBackup=str(final),phase='candidate_starting');atomic(journal_path(stage),j)
  try:
   start_backend(stage,new);verify_readiness(stage,new)
   j['phase']='candidate_verified';atomic(journal_path(stage),j)
  except BaseException:
   j['phase']='rolling_back';atomic(journal_path(stage),j);rollback(stage,j);atomic(operation/'operation.json',j);raise
  # This atomic route switch is the exposure boundary. No data restore after it.
  atomic(active_path(stage),new)
  verify_readiness(stage,new,front=True)
  j.update(phase='complete',finishedAt=utc());atomic(journal_path(stage),j);atomic(operation/'operation.json',j)
  log(stage+' deployed '+sha)
  retention(stage)
def once():
 with lock('agent'):
  ensure_database();refs=remote_refs()
  status={'checkedAt':utc(),'stages':{}}
  for stage in ['staging','production']:
   try:
    with lock(stage,wait=2):recover(stage)
    sha=eligible(refs,stage)
    if sha:deploy(stage,sha)
    current=read(active_path(stage))
    with lock(stage,wait=2):
     if not current.get('maintenance'):start_backend(stage,current);start_edge(stage)
    status['stages'][stage]={'deployed':current['sha'],'eligible':sha,'maintenance':current.get('maintenance',False)}
   except Exception as e:
    status['stages'][stage]={'error':str(e)[:200]};log(stage+' '+str(e)[:200])
  atomic(ROOT/'status.json',status)
  if any('error' in x for x in status['stages'].values()):raise RuntimeError('deployment_attention_required')
if __name__=='__main__':
 try:
  if sys.argv[1:]==['once']:once()
  elif len(sys.argv)==5 and sys.argv[1]=='deploy' and sys.argv[2] in STAGES:deploy(sys.argv[2],sys.argv[3],source=sys.argv[4],force=True)
  else:raise SystemExit('Usage: agent.py once')
 except RuntimeError as e:
  if str(e)=='operation_already_running':log('Deployment already running')
  else:log(str(e));sys.exit(1)
