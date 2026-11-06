"""Install the broker only from the active production release; keep a rollback copy.
Run with the voice venv Python after GitHub main CI and notebook deployment succeed.
Does not change model settings, credentials, database or scheduled tasks.
"""
import argparse, datetime, hashlib, json, os, shutil, subprocess, time
from pathlib import Path
import httpx, psutil

ROOT=Path(r'D:\PanthoriumAI')
BASE=ROOT/'hybrid'
ACTIVE=Path(r'D:\Panthorium\Host\production\active.json')
FILES=('hybrid_server.py','work_queue.py')

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
    args=parser.parse_args();active=json.loads(ACTIVE.read_text(encoding='utf-8-sig'))
    source=Path(__file__).resolve().parent
    if active['sha']!=args.expected_sha or source!=Path(active['path']).resolve()/'deploy'/'hybrid':
        raise SystemExit('Source must be the exact active production release')
    if active.get('maintenance'): raise SystemExit('Production maintenance is active')
    if get('health').get('service')!='panthorium-free-ai-broker':raise SystemExit('Unexpected service')
    for name in FILES: compile((source/name).read_text(encoding='utf-8'),name,'exec')
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
        stop_broker()
        installed=True
        for name in FILES:shutil.copy2(source/name,BASE/name)
        start_broker()
        if get('health').get('version')!='queue-v1':raise RuntimeError('New broker health version mismatch')
        receipt={'sha':args.expected_sha,'backup':str(backup),'files':{name:hashlib.sha256((BASE/name).read_bytes()).hexdigest() for name in FILES}}
        (BASE/'queue-installed.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
        print(json.dumps({'ok':True,**receipt}))
    except Exception:
        if installed:
            stop_broker()
            for name in FILES:
                if (backup/name).exists():shutil.copy2(backup/name,BASE/name)
                else:(BASE/name).unlink(missing_ok=True)
            start_broker()
        raise
    finally:
        if not already_disabled:disabled.unlink(missing_ok=True)

if __name__=='__main__':main()
