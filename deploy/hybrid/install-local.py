"""Apply a reviewed local override, backup source/config and roll back on failure."""
import hashlib,json,os,pathlib,shutil,sys,urllib.request
sys.path.insert(0,r'D:\Panthorium\Host\deploy')
import runtime as r
root=pathlib.Path(r'D:\PanthoriumAI\hybrid')
stage=sys.argv[1];assert stage in r.STAGES
manifest=json.loads((root/'app-manifest.json').read_text(encoding='utf-8'))
def blob(data):
    data=data.replace(b'\r\n',b'\n')
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
with r.lock(stage,wait=60):
    state=r.read(r.active_path(stage));assert not state.get('maintenance')
    assert state['sha']==manifest['baseSha'],'Deploy changed; review again'
    app=r.release_path(state);config=r.HOST/stage/'runtime-ready.dpapi'
    backup=root/'app-backup'/stage
    previous=r.read(root/(stage+'-installed.json')) if (root/(stage+'-installed.json')).exists() else None
    assert not backup.exists() or previous,'Unfinished prior install; inspect before retry'
    # Complete preflight before stopping anything.
    for name,expected in manifest['files'].items():
        src=root/'app-source'/name;target=app/name
        if previous and name in previous['files']:
            assert r.file_hash(target)==previous['files'][name],'Installed override changed: '+name
        elif target.exists():
            actual=hashlib.sha256(target.read_bytes()).hexdigest() if expected=='REASONING_OVERRIDE' else blob(target.read_bytes())
            wanted='c334dadedf5d0bc06cafadd5c931a4dfa57235070308acb574b67ed438a42824' if expected=='REASONING_OVERRIDE' else expected
            assert actual==wanted,'Source differs: '+name
        else:assert expected is None,'Missing original source: '+name
        if name.endswith('.js'):r.command([r.NODE,'--check',src],timeout=20)
    backup.mkdir(parents=True,exist_ok=True)
    if not (backup/'runtime-ready.dpapi').exists():shutil.copy2(config,backup/'runtime-ready.dpapi')
    for name in manifest['files']:
        target=app/name
        if target.exists():
            out=backup/'source'/name;out.parent.mkdir(parents=True,exist_ok=True)
            if not out.exists() and (not previous or name not in previous['files']):shutil.copy2(target,out)
    new=r.read_runtime(stage)
    new.update(PANTHORIUM_HYBRID_AI='1',PANTHORIUM_LOCAL_QWEN='1',LOCAL_LLM_REASONING='1',LOCAL_LLM_URL='http://127.0.0.1:8765/v1/chat/completions',LOCAL_VOICE_URL='http://127.0.0.1:8765',LOCAL_QWEN_DISABLE_FILE=r'D:\PanthoriumAI\qwen.disabled')
    cipher=r.command(['powershell.exe','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $s=[Console]::In.ReadToEnd(); ConvertTo-SecureString -String $s -AsPlainText -Force | ConvertFrom-SecureString"],input=json.dumps(new),timeout=20)
    tmp=config.with_suffix('.hybrid.new.dpapi');tmp.write_text(cipher,encoding='utf-8');assert json.loads(r.private(tmp))==new
    r.atomic(r.active_path(stage),dict(state,maintenance=True,maintenanceReason='hybrid-ai-local-install'))
    try:
        r.stop_backend(stage,state)
        for name in manifest['files']:
            target=app/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/'app-source'/name,target)
        os.replace(tmp,config)
        r.start_backend(stage,state);r.verify_readiness(stage,state)
        r.atomic(r.active_path(stage),state);r.verify_readiness(stage,state,front=True)
        req=urllib.request.Request('https://'+r.STAGES[stage]['host']+'/api/health',headers={'User-Agent':'Panthorium-release-verification','Cache-Control':'no-cache'})
        with urllib.request.urlopen(req,timeout=20) as response:assert r.matches(json.load(response),stage,state['sha'])
        receipt={'stage':stage,'baseSha':state['sha'],'localOverride':True,'files':{name:r.file_hash(app/name) for name in manifest['files']},'verifiedAt':r.utc(),'webAndDatabaseHealthy':True,'githubSynced':False}
        r.atomic(root/(stage+'-installed.json'),receipt);print(json.dumps({'stage':stage,'installedFiles':len(manifest['files']),'healthy':True,'githubSynced':False}),flush=True)
    except BaseException:
        r.stop_backend(stage,state)
        for name in manifest['files']:
            old=backup/'source'/name
            if old.exists():shutil.copy2(old,app/name)
            elif (app/name).exists():(app/name).unlink()
        shutil.copy2(backup/'runtime-ready.dpapi',config)
        r.start_backend(stage,state);r.verify_readiness(stage,state);r.atomic(r.active_path(stage),state)
        print(json.dumps({'stage':stage,'rolledBack':True}),flush=True);raise
