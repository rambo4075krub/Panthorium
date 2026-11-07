"""Install the broker only from the active production release; keep a rollback copy.
Run with the voice venv Python after GitHub main CI and notebook deployment succeed.
Installs the pinned 8B profile and launchers. Never changes credentials, database
or scheduled tasks. Removing the old 4B weights requires --remove-4b explicitly.
"""
import argparse, datetime, hashlib, json, os, shutil, subprocess, time
from pathlib import Path
import httpx, psutil
from model_profile import PROFILE, model_path, verify_model, owns_model

ROOT=Path(r'D:\PanthoriumAI')
BASE=ROOT/'hybrid'
ACTIVE=Path(r'D:\Panthorium\Host\production\active.json')
FILES=('hybrid_server.py','work_queue.py','model_profile.py','model-profile.json')
HOST_FILES=('Start-LLM.ps1','Stop-LLM.ps1')
LEGACY_WEIGHTS=('Qwen3.5-4B-Q4_K_M.gguf','Qwen3.5-4B-mmproj-F16.gguf')

def stop_owned_models():
    found=[]
    recorded=ROOT/'llm.pid'
    if recorded.exists():
        try:
            p=psutil.Process(int(recorded.read_text().strip()))
            if not any(owns_model(p.exe(),p.cmdline(),ROOT,name) for name in (PROFILE['filename'],LEGACY_WEIGHTS[0])):
                raise RuntimeError('Recorded model PID is not owned; refusing replacement')
        except psutil.NoSuchProcess:pass
    for p in psutil.process_iter(['exe','cmdline']):
        try:
            if any(owns_model(p.info['exe'],p.info['cmdline'] or [],ROOT,name)
                   for name in (PROFILE['filename'],LEGACY_WEIGHTS[0])):found.append(p)
        except (psutil.NoSuchProcess,psutil.AccessDenied):continue
    for p in found:
        try:p.terminate()
        except psutil.NoSuchProcess:pass
    _,alive=psutil.wait_procs(found,timeout=15)
    if alive:raise RuntimeError('Owned model did not stop')
    (ROOT/'llm.pid').unlink(missing_ok=True)

def remove_legacy_weights(root, health):
    # Exact names only. Never recurse or remove another model, user data or voice assets.
    if health.get('version')!='qwen8b-v1' or health.get('model')!=PROFILE['name']:
        raise RuntimeError('8B installation must be healthy before removing 4B')
    removed=[]
    paths=[root/'models'/name for name in LEGACY_WEIGHTS]
    if any(path.is_symlink() for path in paths):raise RuntimeError('Refusing a linked legacy weight')
    for path in paths:
        if path.exists():
            path.unlink();removed.append(path.name)
    return removed

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
    parser.add_argument('--remove-4b',action='store_true')
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
    status=get('status')
    if status.get('busy') or status.get('queue',{}).get('waiting'):raise SystemExit('Broker has active work; retry when idle')
    # Close admission briefly so no new work arrives between the idle check and stop.
    disabled=ROOT/'qwen.disabled';already_disabled=disabled.exists()
    if not already_disabled: disabled.write_text('broker upgrade in progress',encoding='utf-8')
    backup=BASE/'backups'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup.mkdir(parents=True)
    installed=False
    try:
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
        for name in FILES:shutil.copy2(source/name,BASE/name)
        for name in HOST_FILES:shutil.copy2(source/'host'/name,ROOT/name)
        start_broker()
        health=get('health')
        if health.get('version')!='qwen8b-v1' or health.get('model')!=PROFILE['name']:raise RuntimeError('New broker model/version mismatch')
        receipt={'sha':args.expected_sha,'backup':str(backup),'model':PROFILE['name'],
                 'modelSha256':PROFILE['sha256'],'inferenceTested':False,
                 'files':{name:hashlib.sha256((BASE/name).read_bytes()).hexdigest() for name in FILES},
                 'launchers':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in HOST_FILES}}
        (BASE/'queue-installed.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    except Exception:
        if installed:
            stop_broker()
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
    # the verified 8B service installed and can be retried without rolling back to 4B.
    if args.remove_4b:
        receipt['removed4B']=remove_legacy_weights(ROOT,get('health'))
        receipt['removed4BLaunchers']=[]
        for old,new in [('start_llm_4b.cmd','start_llm_8b.cmd'),('Use-Qwen35-4B.cmd','Use-Qwen3-8B.cmd')]:
            legacy=ROOT/old
            if legacy.exists():
                content=legacy.read_text(encoding='utf-8-sig')
                if 'Start-Hybrid.ps1' not in content and 'Start-LLM.ps1' not in content:
                    raise RuntimeError('Unexpected legacy launcher content; inspect before removal')
                if (ROOT/new).exists():raise RuntimeError('Replacement launcher already exists; inspect before overwriting')
                shutil.copy2(legacy,backup/old)
                (ROOT/new).write_text('@echo off\npowershell.exe -NoProfile -File "D:\\PanthoriumAI\\hybrid\\Start-Hybrid.ps1"\n',encoding='ascii')
                legacy.unlink();receipt['removed4BLaunchers'].append(old)
    time.sleep(2.5)
    receipt['status']=get('status')
    (BASE/'queue-installed.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps({'ok':True,**receipt}))

if __name__=='__main__':main()
