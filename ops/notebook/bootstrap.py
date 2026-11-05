"""One-time transition from the previously verified shared checkout."""
from agent import *
LEGACY=Path(r'D:\PanthoriumAI\panthorium-server')
def terminate(meta):
 if same_process(meta):command(['powershell.exe','-NoProfile','-NonInteractive','-Command','Stop-Process -Id '+str(meta['pid'])+' -ErrorAction Stop'])
 if same_process(meta):raise RuntimeError('process_did_not_stop')
def legacy_meta(stage):
 pid=int((HOST/stage/'server.pid').read_text().strip())
 data=command(['powershell.exe','-NoProfile','-NonInteractive','-Command',
  "Get-CimInstance Win32_Process -Filter 'ProcessId = "+str(pid)+"' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress"])
 info=json.loads(data)
 if Path(info['ExecutablePath']).resolve()!=NODE.resolve() or str(LEGACY/'server.js').lower() not in info['CommandLine'].lower():
  raise RuntimeError('legacy_process_identity_mismatch')
 identity=process_identity(pid)
 if not identity:raise RuntimeError('legacy_process_not_running')
 h=health(STAGES[stage]['front'])
 if h.get('release')!='notebook-'+stage:raise RuntimeError('legacy_listener_identity_mismatch')
 return {'pid':pid,'identity':identity}
def bootstrap(stage,sha,source):
 with lock(stage,wait=2):
  ensure_database()
  if active_path(stage).exists():
   current=read(active_path(stage))
   if current['sha']==sha and not current.get('maintenance'):
    verify_readiness(stage,current,front=True);log(stage+' already transitioned');return
   raise RuntimeError('existing_active_route_requires_review')
  old=legacy_meta(stage)
  new=prepare(stage,sha,source);new.update(port=STAGES[stage]['ports'][0],maintenance=False,activatedAt=utc())
  folder=ROOT/'bootstrap'/stage/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
  folder.mkdir(parents=True)
  journal={'stage':stage,'new':new,'legacyProcess':old,'phase':'preflight','startedAt':utc()}
  atomic(folder/'journal.json',journal)
  snapshot(stage,folder/'preflight-backup');probe(stage,new,folder/'preflight-backup',folder)
  journal['phase']='draining_legacy';atomic(folder/'journal.json',journal)
  terminate(old)
  maintain(stage,new);start_edge(stage)
  candidate_started=False;final=folder/'before-activation'
  try:
   snapshot(stage,final)
   candidate_started=True
   start_backend(stage,new);verify_readiness(stage,new)
   atomic(active_path(stage),new)
   verify_readiness(stage,new,front=True)
  except BaseException:
   current=read(active_path(stage))
   if current.get('maintenance'):
    stop_backend(stage,new)
    if candidate_started:restore_before_exposure(stage,final)
    edge=HOST/stage/'edge.json'
    if edge.exists():terminate(read(edge))
    active_path(stage).rename(folder/'failed-active.json')
    command(['powershell.exe','-NoProfile','-File',HOST/'Start-Host.Legacy.ps1','-Stage',stage],timeout=90,logfile=folder/'legacy-restart.log')
    journal['phase']='rolled_back'
   else:journal['phase']='exposed_requires_review'
   atomic(folder/'journal.json',journal);raise
  journal.update(phase='complete',finishedAt=utc());atomic(folder/'journal.json',journal)
  log(stage+' transitioned to separate release '+sha)
if __name__=='__main__':
 if len(sys.argv)!=4 or sys.argv[1] not in STAGES or not valid_sha(sys.argv[2]):raise SystemExit('Usage: bootstrap.py stage sha source')
 bootstrap(*sys.argv[1:])
