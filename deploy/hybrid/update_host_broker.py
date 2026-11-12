"""Install the broker only from the active production release; keep a rollback copy.
Run with the voice venv Python after GitHub main CI and notebook deployment succeed.
Installs the pinned 4B multimodal profile and launchers. Never changes credentials, database
or scheduled tasks. Old Qwen weights are removed only with explicit options.
"""
import argparse, datetime, hashlib, json, os, shutil, subprocess, time
from pathlib import Path
import httpx, psutil
from model_profile import PROFILE, model_path, projector_path, verify_model, owns_model

ROOT=Path(r'D:\PanthoriumAI')
BASE=ROOT/'hybrid'
ACTIVE=Path(r'D:\Panthorium\Host\production\active.json')
FILES=('hybrid_server.py','work_queue.py','model_profile.py','model-profile.json','media_input.py')
HOST_FILES=('Start-LLM.ps1','Stop-LLM.ps1')
PREVIOUS_WEIGHTS=('Qwen3.5-9B-Q3_K_S.gguf','Qwen3.5-9B-Q4_K_M.gguf')
OWNED_WEIGHTS=(PROFILE['filename'],*PREVIOUS_WEIGHTS,'Qwen3-8B-Q4_K_M.gguf')

def stop_owned_models():
    found=[]
    recorded=ROOT/'llm.pid'
    if recorded.exists():
        try:
            p=psutil.Process(int(recorded.read_text().strip()))
            if not any(owns_model(p.exe(),p.cmdline(),ROOT,name) for name in OWNED_WEIGHTS):
                raise RuntimeError('Recorded model PID is not owned; refusing replacement')
        except psutil.NoSuchProcess:pass
    for p in psutil.process_iter(['exe','cmdline']):
        try:
            if any(owns_model(p.info['exe'],p.info['cmdline'] or [],ROOT,name)
                   for name in OWNED_WEIGHTS):found.append(p)
        except (psutil.NoSuchProcess,psutil.AccessDenied):continue
    for p in found:
        try:p.terminate()
        except psutil.NoSuchProcess:pass
    _,alive=psutil.wait_procs(found,timeout=15)
    if alive:raise RuntimeError('Owned model did not stop')
    (ROOT/'llm.pid').unlink(missing_ok=True)

def remove_previous_weights(root, health, verified):
    if (health.get('version')!=PROFILE['brokerVersion'] or health.get('model')!=PROFILE['name'] or
        health.get('ramGuardAlive') is not True or health.get('inferenceVerified') is not True or
        health.get('visionVerified') is not True or verified != {'text':True,'tools':True,'vision':True}):
        raise RuntimeError('4B text, tools, vision and live resource guard must pass before removing 9B')
    paths=[root/'models'/sub/name for sub in ('','candidates') for weight in PREVIOUS_WEIGHTS
           for name in (weight,weight+'.source.json')]
    if any(path.is_symlink() or path.parent.is_symlink() for path in paths):
        raise RuntimeError('Refusing linked previous weights')
    removed=[]
    for path in paths:
        if path.is_file():path.unlink();removed.append(str(path.relative_to(root)))
    return removed

def verify_inference():
    import base64, io
    from PIL import Image
    def complete(messages, **extra):
        response=httpx.post('http://127.0.0.1:8765/v1/chat/completions',timeout=195,json={
            'model':'panthorium-local','stream':False,'max_tokens':128,
            'chat_template_kwargs':{'enable_thinking':False},'messages':messages,**extra})
        response.raise_for_status()
        choice=response.json()['choices'][0]
        if choice.get('finish_reason')=='length':raise RuntimeError('4B verification response truncated')
        return choice['message']
    if 'READY' not in complete([{'role':'user','content':'Reply with the single word READY.'}]).get('content',''):
        raise RuntimeError('4B text verification failed; 9B retained')
    tool={'type':'function','function':{'name':'verify_add','description':'Add two numbers',
          'parameters':{'type':'object','properties':{'a':{'type':'integer'},'b':{'type':'integer'}},'required':['a','b']}}}
    calls=complete([{'role':'user','content':'Call verify_add with a=2 and b=3.'}],tools=[tool],tool_choice='required').get('tool_calls',[])
    if len(calls)!=1 or calls[0]['function']['name']!='verify_add' or json.loads(calls[0]['function']['arguments'])!={'a':2,'b':3}:
        raise RuntimeError('4B tool verification failed; 9B retained')
    picture=io.BytesIO();Image.new('RGB',(224,224),(255,0,0)).save(picture,format='PNG')
    url='data:image/png;base64,'+base64.b64encode(picture.getvalue()).decode()
    answer=complete([{'role':'user','content':[{'type':'text','text':'What is the dominant color? Reply with one English color word.'},{'type':'image_url','image_url':{'url':url}}]}]).get('content','')
    if answer.strip().strip('.').lower()!='red':raise RuntimeError('4B vision verification failed; 9B retained')
    return {'text':True,'tools':True,'vision':True}

def get(path):
    return httpx.get('http://127.0.0.1:8765/'+path,timeout=3).raise_for_status().json()

def stop_broker():
    script=str((BASE/'hybrid_server.py').resolve()).lower()
    found=[]
    for p in psutil.process_iter(['exe','cmdline']):
        try:
            args=[str(a).lower() for a in p.info['cmdline'] or []]
            if script not in args: continue
            if Path(p.info['exe']).name.lower() not in ('python.exe','pythonw.exe'):
                raise RuntimeError('Unexpected broker executable')
            found.append(p)
        except (psutil.NoSuchProcess,psutil.AccessDenied): continue
    for p in found:
        try: p.terminate()
        except psutil.NoSuchProcess: pass
    _,alive=psutil.wait_procs(found,timeout=8)
    if alive: raise RuntimeError('Broker did not stop; refusing replacement')

def start_broker():
    subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(BASE/'Start-Hybrid.ps1')],check=True,timeout=40,creationflags=0x08000000)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--expected-sha',required=True)
    parser.add_argument('--remove-9b',action='store_true')
    args=parser.parse_args();active=json.loads(ACTIVE.read_text(encoding='utf-8-sig'))
    source=Path(__file__).resolve().parent
    if active['sha']!=args.expected_sha or source!=Path(active['path']).resolve()/'deploy'/'hybrid':
        raise SystemExit('Source must be the exact active production release')
    if active.get('maintenance'): raise SystemExit('Production maintenance is active')
    if get('health').get('service')!='panthorium-free-ai-broker':raise SystemExit('Unexpected service')
    for name in FILES:
        if name.endswith('.py'):compile((source/name).read_text(encoding='utf-8'),name,'exec')
    final_model=model_path(ROOT)
    candidate=ROOT/'models'/'candidates'/PROFILE['filename']
    selected=final_model if final_model.exists() else candidate
    verify_model(selected)
    final_projector=projector_path(ROOT)
    candidate_projector=ROOT/'models'/'candidates'/PROFILE['projector']['filename']
    verify_model(final_projector if final_projector.exists() else candidate_projector,PROFILE['projector'])
    status=get('status')
    if status.get('busy') or status.get('queue',{}).get('waiting'):raise SystemExit('Broker has active work; retry when idle')
    # Close admission briefly so no new work arrives between the idle check and stop.
    disabled=ROOT/'qwen.disabled';already_disabled=disabled.exists()
    if already_disabled:raise SystemExit('Qwen is disabled; keep the existing installation')
    backup=BASE/'backups'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup.mkdir(parents=True)
    installed=False
    try:
        disabled.write_text('broker upgrade in progress',encoding='utf-8')
        status=get('status')
        if status.get('busy') or status.get('queue',{}).get('waiting'):raise RuntimeError('Work arrived during upgrade; retry later')
        for name in FILES:
            if (BASE/name).exists():shutil.copy2(BASE/name,backup/name)
        for name in HOST_FILES:
            if (ROOT/name).exists():shutil.copy2(ROOT/name,backup/name)
        if (BASE/'queue-installed.json').exists():shutil.copy2(BASE/'queue-installed.json',backup/'queue-installed.json')
        stop_broker()
        installed=True
        stop_owned_models()
        if not final_model.exists():
            candidate.replace(final_model)
            receipt_source=candidate.with_suffix('.gguf.source.json')
            if receipt_source.exists():receipt_source.replace(final_model.with_suffix('.gguf.source.json'))
        if not final_projector.exists():candidate_projector.replace(final_projector)
        for name in FILES:shutil.copy2(source/name,BASE/name)
        for name in HOST_FILES:shutil.copy2(source/'host'/name,ROOT/name)
        start_broker()
        health=get('health')
        if health.get('version')!=PROFILE['brokerVersion'] or health.get('model')!=PROFILE['name'] or not health.get('ramGuardAlive'):raise RuntimeError('New broker model/version/guard mismatch')
        disabled.unlink(missing_ok=True)
        verified=verify_inference()
        health=get('health')
        if not health.get('ramGuardAlive') or not get('status').get('ready'):
            raise RuntimeError('Resource guard/readiness failed during verification')
        receipt={'verification':verified,'sha':args.expected_sha,'backup':str(backup),'model':PROFILE['name'],
                 'modelSha256':PROFILE['sha256'],'inferenceTested':True,
                 'files':{name:hashlib.sha256((BASE/name).read_bytes()).hexdigest() for name in FILES},
                 'launchers':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in HOST_FILES}}
        (BASE/'queue-installed.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    except Exception:
        if installed:
            disabled.write_text('broker rollback in progress',encoding='utf-8')
            stop_broker()
            stop_owned_models()
            for name in FILES:
                if (backup/name).exists():shutil.copy2(backup/name,BASE/name)
                else:(BASE/name).unlink(missing_ok=True)
            for name in HOST_FILES:
                if (backup/name).exists():shutil.copy2(backup/name,ROOT/name)
                else:(ROOT/name).unlink(missing_ok=True)
            if (backup/'queue-installed.json').exists():shutil.copy2(backup/'queue-installed.json',BASE/'queue-installed.json')
            start_broker()
        raise
    finally:
        if not already_disabled:disabled.unlink(missing_ok=True)
    # Commit the installation before irreversible removal. A removal failure leaves
    # the selected service installed and can be retried without deleting a fallback.
    if args.remove_9b:
        receipt['removed9B']=remove_previous_weights(ROOT,get('health'),verified)
        receipt['removed9BLaunchers']=[]
        for old,new in [('start_llm_9b.cmd','start_llm_4b.cmd'),('Use-Qwen35-9B.cmd','Use-Qwen35-4B.cmd')]:
            legacy=ROOT/old
            if legacy.exists():
                if legacy.is_symlink():raise RuntimeError('Refusing linked launcher')
                content=legacy.read_text(encoding='utf-8-sig')
                if 'Start-Hybrid.ps1' not in content and 'Start-LLM.ps1' not in content:
                    raise RuntimeError('Unexpected legacy launcher content; inspect before removal')
                shutil.copy2(legacy,backup/old)
                replacement=ROOT/new
                if replacement.is_symlink():raise RuntimeError('Refusing linked replacement launcher')
                if not replacement.exists():
                    replacement.write_text('@echo off\npowershell.exe -NoProfile -File "D:\\PanthoriumAI\\Start-LLM.ps1"\n',encoding='ascii')
                legacy.unlink();receipt['removed9BLaunchers'].append(old)
    time.sleep(2.5)
    receipt['status']=get('status')
    (BASE/'queue-installed.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps({'ok':True,**receipt}))

if __name__=='__main__':main()
