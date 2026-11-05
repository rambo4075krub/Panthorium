"""Private Windows host controller; deployed app code cannot replace this copy."""
import contextlib, ctypes, datetime, hashlib, json, os, re, secrets, shutil
import socket, sqlite3, subprocess, sys, tarfile, time, urllib.request, uuid
from pathlib import Path
ROOT=Path(os.environ.get('PANTHORIUM_DEPLOY_ROOT',r'D:\Panthorium\Deploy'))
HOST=Path(r'D:\Panthorium\Host')
DBROOT=Path(r'D:\Panthorium\Database')
BIN=DBROOT/'tools'/'pgsql'/'bin'
UPLOADS=Path(r'D:\Panthorium\Uploads')
NODE=Path(r'C:\Program Files\nodejs\node.exe')
GIT=Path(r'C:\Program Files\Git\cmd\git.exe')
NPM=NODE.parent/'node_modules'/'npm'/'bin'/'npm-cli.js'
REPO='https://github.com/rambo4075krub/Panthorium.git'
STAGES={
 'production':{'branch':'main','db':'panthorium_phase2_db','role':'panthorium_production_local','ports':[8810,8811],'front':8790,'probe':8890,'host':'panthorium.net'},
 'staging':{'branch':'staging','db':'panthorium_staging_db','role':'panthorium_staging_local','ports':[8820,8821],'front':8791,'probe':8891,'host':'preview.panthorium.net'}}
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def valid_sha(value):return isinstance(value,str) and re.fullmatch(r'[0-9a-f]{40}',value) is not None
def atomic(path,value):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
 with tmp.open('w',encoding='utf-8',newline='\n') as f:
  json.dump(value,f,indent=2);f.flush();os.fsync(f.fileno())
 for _ in range(50):
  try:os.replace(tmp,path);return
  except PermissionError:time.sleep(.1)
 raise RuntimeError('atomic_file_replace_failed')
def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def active_path(stage):return HOST/stage/'active.json'
def log(message):
 print(utc()+' '+message,flush=True)
def command(args,*,env=None,cwd=None,input=None,timeout=300,logfile=None):
 p=subprocess.run([str(a) for a in args],input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                  text=True,encoding='utf-8',errors='replace',env=env,cwd=cwd,timeout=timeout,
                  creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 if logfile:
  Path(logfile).parent.mkdir(parents=True,exist_ok=True)
  Path(logfile).write_text(p.stdout+'\n'+p.stderr,encoding='utf-8')
 if p.returncode:raise RuntimeError(Path(str(args[0])).name+' failed; inspect operation log')
 return p.stdout.strip()
def private(path):
 env=dict(os.environ,PANTHORIUM_SECRET_FILE=str(path))
 return command(['powershell.exe','-NoProfile','-NonInteractive','-Command',
  "$ErrorActionPreference='Stop';([pscredential]::new('local',(Get-Content -LiteralPath $env:PANTHORIUM_SECRET_FILE | ConvertTo-SecureString))).GetNetworkCredential().Password"],env=env,timeout=20)
def pg_env(stage=None,db=None):
 if stage:
  item=STAGES[stage];user=item['role'];pw=private(DBROOT/'private'/(stage+'-app.dpapi'));db=db or item['db']
 else:user='panthorium_local_admin';pw=private(DBROOT/'private'/'local-admin.dpapi');db=db or 'postgres'
 return dict(os.environ,PGHOST='127.0.0.1',PGPORT='55432',PGDATABASE=db,PGUSER=user,
             PGPASSWORD=pw,PGSSLMODE='disable',PGCONNECT_TIMEOUT='8',PGCLIENTENCODING='UTF8',
             PGAPPNAME='panthorium-notebook-deploy',PGOPTIONS='-c default_transaction_read_only=off')
def ident(value):
 if not re.fullmatch(r'[a-z0-9_]+',value):raise ValueError('invalid_database_identifier')
 return '"'+value+'"'
def sql(query,db='postgres',env=None):
 return command([BIN/'psql.exe','-X','-w','-qAt','-v','ON_ERROR_STOP=1'],env=env or pg_env(db=db),input=query,timeout=120)
def ensure_database():
 p=subprocess.run([str(BIN/'pg_isready.exe'),'-q','-h','127.0.0.1','-p','55432'],capture_output=True,
                  creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 if p.returncode:
  # A Windows postmaster can retain pg_ctl's pipe handles after pg_ctl exits.
  # Use a file, not capture_output/PIPE: waiting for pipe EOF would hang startup.
  with (DBROOT/'logs'/'startup-controller.log').open('ab') as output:
   started=subprocess.run([str(BIN/'pg_ctl.exe'),'start','-w','-t','45','-D',str(DBROOT/'data'),'-l',str(DBROOT/'logs'/'postgresql.log')],
     stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,timeout=55,
     creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
  if started.returncode:raise RuntimeError('database_start_failed; inspect startup-controller.log')
@contextlib.contextmanager
def lock(name,wait=0):
 import msvcrt
 path=ROOT/'locks'/(name+'.lock');path.parent.mkdir(parents=True,exist_ok=True)
 f=path.open('a+b');f.seek(0);f.write(b'0');f.flush()
 deadline=time.monotonic()+wait
 while True:
  try:f.seek(0);msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1);break
  except OSError:
   if time.monotonic()>=deadline:f.close();raise RuntimeError('operation_already_running')
   time.sleep(.2)
 try:yield
 finally:f.seek(0);msvcrt.locking(f.fileno(),msvcrt.LK_UNLCK,1);f.close()
def process_identity(pid):
 from ctypes import wintypes as w
 k=ctypes.WinDLL('kernel32',use_last_error=True)
 k.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];k.OpenProcess.restype=w.HANDLE
 k.CloseHandle.argtypes=[w.HANDLE]
 k.GetExitCodeProcess.argtypes=[w.HANDLE,ctypes.POINTER(w.DWORD)]
 k.GetProcessTimes.argtypes=[w.HANDLE]+[ctypes.POINTER(ctypes.c_ulonglong)]*4
 k.QueryFullProcessImageNameW.argtypes=[w.HANDLE,w.DWORD,w.LPWSTR,ctypes.POINTER(w.DWORD)]
 h=k.OpenProcess(0x1000,False,int(pid))
 if not h:return None
 try:
  code=w.DWORD()
  if not k.GetExitCodeProcess(h,ctypes.byref(code)) or code.value!=259:return None
  times=[ctypes.c_ulonglong() for _ in range(4)]
  if not k.GetProcessTimes(h,*[ctypes.byref(x) for x in times]):return None
  buf=ctypes.create_unicode_buffer(32768);n=w.DWORD(len(buf))
  if not k.QueryFullProcessImageNameW(h,0,buf,ctypes.byref(n)):return None
  return [buf.value.lower(),times[0].value]
 finally:k.CloseHandle(h)
def same_process(meta):return process_identity(meta['pid'])==meta['identity']
def health(port):
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/api/health',timeout=3) as r:return json.load(r)
def matches(h,stage,sha):return h.get('ok') is True and h.get('release')=='notebook-'+stage+'-'+sha[:12] and h.get('deployment',{}).get('sha')==sha and h.get('deployment',{}).get('stage')==stage
def spawn(args,cwd,env,meta_path,logprefix):
 logprefix=Path(logprefix);logprefix.parent.mkdir(parents=True,exist_ok=True)
 with Path(str(logprefix)+'.out.log').open('ab') as out,Path(str(logprefix)+'.err.log').open('ab') as err:
  p=subprocess.Popen([str(a) for a in args],cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,
    creationflags=subprocess.DETACHED_PROCESS|subprocess.CREATE_NEW_PROCESS_GROUP)
 identity=process_identity(p.pid)
 if not identity:raise RuntimeError('process_exited_during_start')
 meta={'pid':p.pid,'identity':identity,'args':[str(a) for a in args],'startedAt':utc()}
 atomic(meta_path,meta);return meta
def release_path(state):
 if not valid_sha(state['sha']):raise RuntimeError('invalid_release_sha')
 p=Path(state['path']).resolve()
 if p!= (ROOT/'releases'/state['stage']/state['sha']).resolve():raise RuntimeError('unexpected_release_path')
 if not (p/'server.js').is_file():raise RuntimeError('release_missing')
 return p
def runtime_env(stage,state,probe=None):
 item=STAGES[stage];release_path(state)
 env=dict(os.environ);env.update({k:str(v) for k,v in read_runtime(stage).items()})
 for k in ['K_REVISION','PANTHORIUM_LOCAL_PROFILE','PGSERVICE','PGSERVICEFILE','NODE_OPTIONS']:env.pop(k,None)
 from urllib.parse import quote
 db=probe['db'] if probe else item['db']
 pw=private(DBROOT/'private'/(stage+'-app.dpapi'))
 control=private(HOST/stage/'deploy-control.dpapi')
 data=Path(probe['root']) if probe else HOST/stage
 origins=set(filter(None,env.get('ALLOWED_ORIGINS','').split(',')))
 origins.update(['https://'+item['host'],'http://127.0.0.1:'+str(state['port']),'http://localhost:'+str(state['port'])])
 env.update(NODE_ENV='production',HOST='127.0.0.1',PORT=str(state['port']),TRUST_PROXY='1',
  DATABASE_URL='postgresql://'+item['role']+':'+quote(pw,safe='')+'@127.0.0.1:55432/'+db,
  DATABASE_SSL_MODE='disable',PGOPTIONS='-c default_transaction_read_only=off',
  PANTHORIUM_OBJECT_ROOT=str(data/'uploads' if probe else UPLOADS/stage),
  PANTHORIUM_RELEASE='notebook-'+stage+'-'+state['sha'][:12],PANTHORIUM_DEPLOY_SHA=state['sha'],PANTHORIUM_DEPLOY_STAGE=stage,
  PANTHORIUM_AI_MODE='gemini-live-only',PANTHORIUM_LOCAL_QWEN='1',LOCAL_LLM_MODEL='panthorium-local',
  PANTHORIUM_DEPLOY_CONTROL_TOKEN=control,ALLOWED_ORIGINS=','.join(sorted(origins)),
  DATA_FILE=str(data/'state.json'),AUDIT_FILE=str(data/'audit.log'),
  FFMPEG_PATH=str(HOST/'tools'/'media'/'ffmpeg.exe'),FFPROBE_PATH=str(HOST/'tools'/'media'/'ffprobe.exe'),
  TEMP=str(HOST/'media-temp'),TMP=str(HOST/'media-temp'),BIOMETRIC_SPEAKER_URL='http://127.0.0.1:18086',
  SENTINEL_AUTO_TRAINING='0',SENTINEL_AUTO_CAPTURE='0',PANTHORIUM_GOVERNANCE_MODE='off',
  PANTHORIUM_SENTINEL_CONTROL_MODE='off',PANTHORIUM_SCHEDULER_INTERVAL_FALLBACK='0',
  PANTHORIUM_DEPLOY_PROBE='1' if probe else '0')
 if probe:env.update(JWT_SECRET=secrets.token_urlsafe(48),MAILBOX_SEND_ENABLED='0',PANTHORIUM_PUSH_INTERVAL_FALLBACK='0',PANTHORIUM_FCM_PROJECT_ID='',PANTHORIUM_MCP_ENABLED='0')
 return env
def read_runtime(stage):return json.loads(private(HOST/stage/'runtime-ready.dpapi'))
def start_backend(stage,state,probe=None):
 root=Path(probe['root']) if probe else HOST/stage;root.mkdir(parents=True,exist_ok=True)
 meta_path=root/'node.json'
 if meta_path.exists():
  old=read(meta_path)
  if same_process(old):
   if matches(health(state['port']),stage,state['sha']):return old
   raise RuntimeError('existing_backend_identity_mismatch')
 try:
  h=health(state['port'])
  raise RuntimeError('unexpected_existing_backend_listener')
 except (OSError,ValueError):pass
 env=runtime_env(stage,state,probe);app=release_path(state)
 meta=spawn([NODE,app/'server.js'],app,env,meta_path,root/'logs'/('app-'+state['sha'][:12]+'-'+str(time.time_ns())))
 for _ in range(75):
  if not same_process(meta):raise RuntimeError('backend_exited; inspect stage logs')
  try:
   if matches(health(state['port']),stage,state['sha']):return meta
  except (OSError,ValueError):pass
  time.sleep(1)
 raise RuntimeError('backend_readiness_timeout')
def stop_backend(stage,state,probe=None):
 root=Path(probe['root']) if probe else HOST/stage;path=root/'node.json'
 if not path.exists():return
 meta=read(path)
 if not same_process(meta):return
 token=private(HOST/stage/'deploy-control.dpapi')
 request=urllib.request.Request('http://127.0.0.1:'+str(state['port'])+'/__notebook/shutdown',method='POST',data=b'{}',
  headers={'Content-Type':'application/json','x-panthorium-control':token})
 try:
  with urllib.request.urlopen(request,timeout=4) as r:
   if r.status!=202:raise RuntimeError('shutdown_rejected')
 except OSError:pass
 for _ in range(60):
  if not same_process(meta):return
  time.sleep(.2)
 if same_process(meta):
  command(['powershell.exe','-NoProfile','-NonInteractive','-Command','Stop-Process -Id '+str(meta['pid'])+' -ErrorAction Stop'],timeout=10)
 if same_process(meta):raise RuntimeError('backend_stop_failed')
def start_edge(stage):
 root=HOST/stage;meta_path=root/'edge.json'
 if meta_path.exists() and same_process(read(meta_path)):return
 edge=HOST/'deploy'/'edge.cjs'
 spawn([NODE,edge,stage],HOST,dict(os.environ),meta_path,root/'logs'/('edge-'+str(time.time_ns())))
 for _ in range(30):
  try:
   with socket.create_connection(('127.0.0.1',STAGES[stage]['front']),timeout=1):return
  except OSError:time.sleep(.3)
 raise RuntimeError('edge_readiness_timeout')
def start_stage(stage):
 with lock(stage,wait=45):
  ensure_database();state=read(active_path(stage))
  if state.get('maintenance'):start_edge(stage);raise RuntimeError('deployment_maintenance_requires_recovery')
  start_backend(stage,state);start_edge(stage)
def file_hash(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def snapshot(stage,folder):
 folder=Path(folder);folder.mkdir(parents=True,exist_ok=False)
 archive=folder/'database.dump'
 command([BIN/'pg_dump.exe','--no-password','--format=custom','--compress=none','--no-owner','--no-privileges','--file',archive],
   env=pg_env(db=STAGES[stage]['db']),timeout=600,logfile=folder/'dump.log')
 command([BIN/'pg_restore.exe','--list',archive],timeout=30)
 with sqlite3.connect((UPLOADS/stage/'objects.sqlite3').as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(folder/'objects.sqlite3') as dest:
  src.backup(dest)
  if dest.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise RuntimeError('upload_backup_invalid')
 source=HOST/stage/'state.json'
 if source.exists():shutil.copy2(source,folder/'state.json')
 receipt={'stage':stage,'createdAt':utc(),'databaseSha256':file_hash(archive),'objectsSha256':file_hash(folder/'objects.sqlite3')}
 atomic(folder/'backup.json',receipt);return receipt
def restore_copy(stage,backup,db):
 ident(db);item=STAGES[stage];backup=Path(backup)
 if file_hash(backup/'database.dump')!=read(backup/'backup.json')['databaseSha256']:raise RuntimeError('backup_checksum_mismatch')
 sql('CREATE DATABASE '+ident(db)+' TEMPLATE template0 OWNER '+ident(item['role'])+';')
 sql('REVOKE ALL ON DATABASE '+ident(db)+' FROM PUBLIC;')
 command([BIN/'pg_restore.exe','--no-password','--single-transaction','--exit-on-error','--no-owner','--no-privileges','--dbname',db,backup/'database.dump'],
   env=pg_env(stage,db),timeout=600,logfile=backup/(db+'-restore.log'))
def drop_probe(db):
 if not re.fullmatch(r'panthorium_probe_(production|staging)_[a-f0-9]{8}',db):raise ValueError('not_a_probe_database')
 sql('DROP DATABASE IF EXISTS '+ident(db)+' WITH (FORCE);')
def restore_before_exposure(stage,backup):
 """Only called while the proxy is in maintenance and candidate was never exposed."""
 item=STAGES[stage];suffix=uuid.uuid4().hex[:8];restored='panthorium_rollback_'+stage+'_'+suffix
 failed='panthorium_failed_'+stage+'_'+suffix
 restore_copy(stage,backup,restored)
 db=item['db']
 sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+db+"' AND pid<>pg_backend_pid();")
 sql('BEGIN; ALTER DATABASE '+ident(db)+' RENAME TO '+ident(failed)+'; ALTER DATABASE '+ident(restored)+' RENAME TO '+ident(db)+'; COMMIT;')
 store=UPLOADS/stage/'objects.sqlite3'
 # Preserve a possibly corrupt candidate without requiring SQLite to open it.
 failed_store=Path(backup)/'failed-objects';failed_store.mkdir(exist_ok=True)
 for suffixfile in ['', '-wal', '-shm']:
  p=Path(str(store)+suffixfile)
  if p.exists():shutil.copy2(p,failed_store/p.name)
 replacement=store.with_name('objects.rollback-'+uuid.uuid4().hex+'.sqlite3')
 shutil.copy2(Path(backup)/'objects.sqlite3',replacement)
 for suffixfile in ['-wal','-shm']:
  p=Path(str(store)+suffixfile)
  if p.exists():p.unlink()
 os.replace(replacement,store)
 if (Path(backup)/'state.json').exists():shutil.copy2(Path(backup)/'state.json',HOST/stage/'state.json')
 return failed
def verify_readiness(stage,state,front=False):
 if sql('SELECT 1',env=pg_env(stage))!='1':raise RuntimeError('database_not_ready')
 port=STAGES[stage]['front'] if front else state['port']
 h=health(port)
 if not matches(h,stage,state['sha']):raise RuntimeError('unexpected_served_release')
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/app-release.json',timeout=5) as r:
  if json.load(r).get('release')!=h['release'] or 'no-store' not in r.headers.get('Cache-Control',''):raise RuntimeError('client_update_release_mismatch')
 for route,expected in [('/',200),('/qwen-local.js',200),('/api/files',401)]:
  req=urllib.request.Request('http://127.0.0.1:'+str(port)+route)
  try:
   with urllib.request.urlopen(req,timeout=5) as r:status=r.status
  except urllib.error.HTTPError as e:status=e.code
  if status!=expected:raise RuntimeError('http_smoke_failed_'+route)
 if front:
  try:urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(port)+'/__notebook/shutdown',data=b'{}'),timeout=3);raise RuntimeError('control_endpoint_exposed')
  except urllib.error.HTTPError as e:
   if e.code!=404:raise
 return True
if __name__=='__main__':
 if len(sys.argv)!=3 or sys.argv[1]!='start' or sys.argv[2] not in STAGES:raise SystemExit('Usage: runtime.py start production|staging')
 start_stage(sys.argv[2])
