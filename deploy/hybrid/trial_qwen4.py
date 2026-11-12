"""Bounded, isolated 4B fit/vision trial. Never changes the production profile."""
import argparse, base64, datetime, hashlib, io, json, os
import secrets, socket, subprocess, sys, threading, time
from pathlib import Path

GIB, MIB = 1024**3, 1024**2
PORT = 18090
FLAGS = 0x08000000 if os.name == 'nt' else 0


def parse_memory(output):
    rows = {}
    for line in output.splitlines():
        parts = line.split()
        if len(parts) == 4 and parts[0] in ('Host', 'CUDA0'):
            rows[parts[0]] = sum(int(n) for n in parts[1:]) * MIB
    if set(rows) != {'Host', 'CUDA0'}:
        raise ValueError('Unknown memory estimate')
    return rows


def admission(s, estimate=None):
    if s['productionBusy']: return 'production_busy'
    if s['ramFraction'] >= .82 or s['available'] < 2.5*GIB: return 'ram_pressure'
    if s['gpuUsed'] >= s['gpuTotal']*.80 or s['gpuTemperature'] >= 82: return 'gpu_pressure'
    if estimate:
        if s['used'] + estimate['Host'] + 512*MIB > s['total']*.82: return 'insufficient_ram_headroom'
        if s['gpuUsed'] + estimate['CUDA0'] + 384*MIB > s['gpuTotal']*.80: return 'insufficient_gpu_headroom'
    return None


def run(profile_directory):
    import httpx, psutil
    from PIL import Image
    sys.path.insert(0, str(profile_directory))
    from model_profile import PROFILE, ROOT, model_path, projector_path, startup_args, verify_model
    if PROFILE['name'] != 'Qwen3.5-4B-Q4_K_M': raise ValueError('Unexpected model')
    folder = ROOT/'experiments'/'qwen4-fit'
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report_path = folder/(stamp+'.json')
    key_path = folder/(stamp+'.key')
    profile_path = ROOT/'hybrid'/'model-profile.json'
    before = hashlib.sha256(profile_path.read_bytes()).hexdigest()
    report = {'model':PROFILE['name'], 'gpuLayers':31, 'productionActivated':False, 'passed':False,
              'cases':[], 'limits':{'ram':.82,'vram':.80,'minimumFreeGiB':2.5,'seconds':480}}
    proc = None
    stop = threading.Event()
    failure = []
    peak_ram, peak_gpu, minimum_free = [0.0], [0.0], [float('inf')]
    watcher = gpu_watcher = None
    started = time.monotonic()

    def snapshot():
        mem = psutil.virtual_memory()
        gpu = subprocess.run(['nvidia-smi','--query-gpu=memory.total,memory.used,temperature.gpu',
                              '--format=csv,noheader,nounits'],capture_output=True,text=True,
                             check=True,timeout=4,creationflags=FLAGS)
        total,used,temperature = map(float,gpu.stdout.strip().split(','))
        status = httpx.get('http://127.0.0.1:8765/status',timeout=3,trust_env=False).raise_for_status().json()
        return {'total':mem.total,'available':mem.available,'used':mem.total-mem.available,
                'ramFraction':1-mem.available/mem.total,'gpuTotal':total*MIB,'gpuUsed':used*MIB,
                'gpuTemperature':temperature,'productionBusy':bool(status.get('busy') or
                status.get('modelLoaded') or status.get('queue',{}).get('waiting'))}

    def terminate_trial():
        if proc is not None and proc.poll() is None: proc.terminate()

    def watch():
        while not stop.wait(.05):
            try:
                m = psutil.virtual_memory()
                fraction = 1-m.available/m.total
                peak_ram[0] = max(peak_ram[0],fraction)
                minimum_free[0] = min(minimum_free[0],m.available/GIB)
                if fraction >= .82 or m.available < 2.5*GIB: raise RuntimeError('ram_pressure')
                if time.monotonic()-started > 480: raise RuntimeError('trial_deadline')
            except Exception as exc:
                failure.append(str(exc)); terminate_trial(); return

    def watch_gpu():
        # GPU subprocesses cannot delay the separate 50 ms RAM watcher.
        while not stop.wait(1):
            try:
                s = snapshot()
                peak_gpu[0] = max(peak_gpu[0],s['gpuUsed']/s['gpuTotal'])
                reason = admission(s)
                if reason: raise RuntimeError(reason)
            except Exception as exc:
                failure.append(str(exc)); terminate_trial(); return

    try:
        verify_model(model_path(ROOT)); verify_model(projector_path(ROOT),PROFILE['projector'])
        s = snapshot(); report['before'] = s
        common = ['-m',str(model_path(ROOT)),'-c',str(PROFILE['context']),'-np','1',
                  '-b','128','-ub','64','-t','4','-fa','on','-ctk','f16','-ctv','f16','-ngl','31']
        fit = subprocess.run([str(ROOT/'runtime'/'llama-fit-params.exe'),*common,'--fit-print','on'],
                             capture_output=True,text=True,check=True,timeout=40,creationflags=FLAGS)
        estimate = parse_memory(fit.stdout)
        # The estimator excludes the CPU vision projector; reserve its full size.
        estimate['Host'] += PROFILE['projector']['bytes']
        report['estimateBytes'] = estimate
        reason = admission(snapshot(),estimate)
        if reason: raise RuntimeError(reason)
        with socket.socket() as probe: probe.bind(('127.0.0.1',PORT))
        key = secrets.token_urlsafe(32); key_path.write_text(key,encoding='ascii')
        args = startup_args(ROOT)
        for flag,value in [('--port',str(PORT)),('-ngl','31'),('--alias','panthorium-4b-trial')]:
            args[args.index(flag)+1] = value
        args += ['--api-key-file',str(key_path)]
        with (folder/(stamp+'.log')).open('wb') as log:
            proc = subprocess.Popen([str(ROOT/'runtime'/'llama-server.exe'),*args],
                                    stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=FLAGS)
        psutil.Process(proc.pid).nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
        watcher = threading.Thread(target=watch,daemon=True); watcher.start()
        gpu_watcher = threading.Thread(target=watch_gpu,daemon=True); gpu_watcher.start()
        with httpx.Client(base_url=f'http://127.0.0.1:{PORT}',headers={'Authorization':'Bearer '+key},
                          timeout=135,trust_env=False) as client:
            deadline = time.monotonic()+80
            while True:
                if failure or proc.poll() is not None: raise RuntimeError(failure or 'model_exited')
                try:
                    if client.get('/health',timeout=1).status_code == 200: break
                except httpx.HTTPError: pass
                if time.monotonic()>deadline: raise RuntimeError('startup_timeout')
                time.sleep(.3)

            def complete(name,content,**extra):
                t = time.monotonic()
                body = {'model':'panthorium-4b-trial','stream':False,'max_tokens':768,
                        'temperature':0,'messages':[{'role':'user','content':content}],
                        'chat_template_kwargs':{'enable_thinking':False},**extra}
                r = client.post('/v1/chat/completions',json=body); r.raise_for_status()
                if failure: raise RuntimeError(failure[0])
                choice = r.json()['choices'][0]
                if choice['finish_reason']=='length': raise RuntimeError(name+'_truncated')
                msg = choice['message']
                report['cases'].append({'name':name,'seconds':round(time.monotonic()-t,2),
                                        'text':msg.get('content'), 'tools':msg.get('tool_calls')})
                print(json.dumps({'completed':name,'seconds':report['cases'][-1]['seconds']}),flush=True)
                return msg

            if 'READY' not in complete('text','Reply with the single word READY.').get('content',''):
                raise RuntimeError('text_failed')
            tool={'type':'function','function':{'name':'verify_add','description':'Add numbers',
                  'parameters':{'type':'object','properties':{'a':{'type':'integer'},'b':{'type':'integer'}},'required':['a','b']}}}
            calls=complete('tools','Call verify_add with a=2 and b=3.',tools=[tool],tool_choice='required').get('tool_calls',[])
            if len(calls)!=1 or calls[0]['function']['name']!='verify_add' or json.loads(calls[0]['function']['arguments'])!={'a':2,'b':3}:
                raise RuntimeError('tools_failed')
            pics=[]
            for colour in ('red','blue','green','yellow'):
                data=io.BytesIO(); Image.new('RGB',(224,224),colour).save(data,format='PNG')
                pics.append({'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(data.getvalue()).decode()}})
            answer=complete('vision',[{'type':'text','text':'What is the dominant color? Reply with one English color word.'},pics[0]])
            if answer.get('content','').strip().strip('.').lower()!='red': raise RuntimeError('vision_failed')
            answer=complete('video-frames',[{'type':'text','text':'These are four ordered video frames. Name their dominant colors in order, in English.'},*pics])
            text=answer.get('content','').lower()
            positions=[text.find(c) for c in ('red','blue','green','yellow')]
            if min(positions)<0 or positions!=sorted(positions): raise RuntimeError('frames_failed')
            answer=complete('thinking','Calculate 17 times 19. Reply with only the number.',chat_template_kwargs={'enable_thinking':True})
            if '323' not in answer.get('content',''): raise RuntimeError('thinking_failed')
            answer=complete('thai','ตอบเป็นภาษาไทยสั้น ๆ ว่า ทดสอบสำเร็จ')
            if not any('\u0e00'<=c<='\u0e7f' for c in answer.get('content','')): raise RuntimeError('thai_failed')
        if failure: raise RuntimeError(failure[0])
        report['passed']=True
    except Exception as exc:
        report['failure']=str(exc)
    finally:
        stop.set()
        terminate_trial()
        if proc is not None:
            try: proc.wait(10)
            except subprocess.TimeoutExpired: proc.kill();proc.wait(5)
        if watcher: watcher.join(6)
        if gpu_watcher: gpu_watcher.join(8)
        key_path.unlink(missing_ok=True)
        report.update(peakRamPercent=round(peak_ram[0]*100,2),peakVramPercent=round(peak_gpu[0]*100,2),
                      minimumFreeGiB=round(minimum_free[0],3) if minimum_free[0]!=float('inf') else None,
                      productionProfileUnchanged=hashlib.sha256(profile_path.read_bytes()).hexdigest()==before)
        if not report['productionProfileUnchanged']: report['passed']=False
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'report':str(report_path),**report},ensure_ascii=False),flush=True)
    return report['passed']


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--profile-directory',type=Path,default=Path(__file__).parent)
    sys.exit(0 if run(parser.parse_args().profile_directory) else 1)
