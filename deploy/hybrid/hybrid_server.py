"""Loopback-only free AI broker. One admitted operation across both app stages.
No credentials, remote tools or user content are persisted by this process.
"""
from pathlib import Path
import asyncio, contextlib, gc, io, json, os, subprocess, sys, time
import httpx, psutil, threading, re
from work_queue import WorkQueue, QueueError, resource_reason, admission_ready, memory_budget, ram_pressure
from model_profile import PROFILE, model_path, projector_path, owns_model
from media_input import normalize_messages, MAX_BODY_BYTES
queue=WorkQueue()
metrics_lock=threading.Lock()
pressure_latched=False
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import Response
BASE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get('PANTHORIUM_AI_ROOT',r'D:\PanthoriumAI'))
sys.path.insert(0,str(ROOT/'voice'))
RESERVE=PROFILE['minimumAvailableGiB']*1024**3
LIMIT=.60
guard_stop=threading.Event()
guard_failed=threading.Event()
ram_guard=None
inference_verified=False
vision_verified=False
DISABLED=ROOT/'qwen.disabled'
FLAGS=0x08000000 if os.name=='nt' else 0
app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
busy=False
phase="idle"
last_use=time.monotonic()
background_cancel=None
engine=None
latest={'ready':False,'reason':'starting'}
last_gpu=0
cached_gpu=None
cached_gpu_total=None
cached_temperature=None

def run(args,timeout=15):
    return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,stdin=subprocess.DEVNULL,timeout=timeout,creationflags=FLAGS,text=True)
def model_process():
    try:
        p=psutil.Process(int((ROOT/'llm.pid').read_text().strip()))
        args=p.cmdline()
        if not owns_model(p.exe(),args,ROOT):return None
        return p
    except (OSError,ValueError,psutil.Error):return None

def stop_model():
    p=model_process()
    if p:
        with contextlib.suppress(psutil.NoSuchProcess):
            p.terminate()
            try:p.wait(8)
            except psutil.TimeoutExpired:p.kill()

def fast_ram_watch():
    """Separate from GPU subprocesses: watch startup RAM every 50 ms."""
    global pressure_latched
    while not guard_stop.wait(.05):
        try:
            mem=psutil.virtual_memory()
            if ram_pressure(1-mem.available/mem.total,mem.available,PROFILE) or DISABLED.exists():
                pressure_latched=True
                stop_model()
        except Exception:
            guard_failed.set()
            with contextlib.suppress(Exception):stop_model()
            return

def snapshot(kind="chat"):
    with metrics_lock:return _snapshot(kind)

def _snapshot(kind="chat"):
    global cached_gpu,cached_gpu_total,cached_temperature,last_gpu,pressure_latched
    mem=psutil.virtual_memory()
    p=model_process()
    local=psutil.Process().memory_info().rss
    if p:
        try:local+=p.memory_info().rss
        except psutil.Error:pass
    if time.monotonic()-last_gpu>2:
        try:
            r=run(['nvidia-smi','--query-gpu=memory.total,memory.used,temperature.gpu','--format=csv,noheader,nounits'],4)
            pairs=[tuple(map(float,line.split(','))) for line in r.stdout.strip().splitlines()]
            if r.returncode or len(pairs)!=1:raise ValueError('GPU metrics unavailable')
            total,used,cached_temperature=pairs[0]
            cached_gpu=used/total;cached_gpu_total=total*1024**2
        except Exception:cached_gpu=cached_gpu_total=cached_temperature=None
        last_gpu=time.monotonic()
    ram_used=1-mem.available/mem.total
    cpu=psutil.cpu_percent()
    hard='ram_pressure' if ram_pressure(ram_used,mem.available,PROFILE) else 'vram_pressure' if cached_gpu is not None and cached_gpu>=PROFILE['vramLimit'] else 'gpu_temperature' if cached_temperature is not None and cached_temperature>=PROFILE['gpuTemperatureLimit'] else None
    if hard:pressure_latched=True
    elif ram_used<PROFILE['ramRecovery'] and cached_gpu is not None and cached_gpu<PROFILE['vramRecovery'] and cached_temperature<PROFILE['gpuTemperatureRecovery']:pressure_latched=False
    reason='disabled' if DISABLED.exists() else resource_reason(ram_used=ram_used,total=mem.total,available=mem.available,local_ram=local,vram=cached_gpu,cpu=cpu,model_loaded=p is not None,voice_loaded=engine is not None,kind=kind,latched=pressure_latched,cold_budget=PROFILE['coldRamBudgetGiB'],limits=PROFILE,vram_total=cached_gpu_total,gpu_temperature=cached_temperature)
    if guard_failed.is_set() or not ram_guard or not ram_guard.is_alive():reason='resource_monitor_unavailable'
    if kind=='chat' and (not model_path(ROOT).is_file() or model_path(ROOT).stat().st_size!=PROFILE['bytes']):reason='model_not_installed'
    if kind=='chat' and (not projector_path(ROOT).is_file() or projector_path(ROOT).stat().st_size!=PROFILE['projector']['bytes']):reason='model_not_installed'
    budget=memory_budget(ram_used=ram_used,total=mem.total,model_loaded=p is not None,voice_loaded=engine is not None,kind=kind,cold_budget=PROFILE['coldRamBudgetGiB'],limits=PROFILE)
    return {'ready':reason is None,'reason':reason,'pressure':hard,'busy':busy,'ramAvailableBytes':mem.available,'ramUsedFraction':ram_used,'ramLimit':PROFILE['ramLimit'],'cpuPercent':cpu,'localRamBytes':local,'localRamLimitBytes':int(mem.total*LIMIT),'vramUsedFraction':cached_gpu,'vramLimit':PROFILE['vramLimit'],'gpuTemperature':cached_temperature,'modelLoaded':p is not None,'queue':queue.status(),**budget}

def drop_voice():
    global engine
    engine=None;gc.collect()

def voice_engine():
    global engine
    if engine is None:
        from voice_engine import ThaiVoiceEngine
        engine=ThaiVoiceEngine(threads=2)
    return engine

async def ensure_model():
    global last_gpu,phase
    phase='model_health'
    async with httpx.AsyncClient(timeout=2) as client:
        try:
            if (await client.get('http://127.0.0.1:8088/health')).status_code==200:
                if model_process():return
                raise HTTPException(503,'local_model_identity_mismatch')
        except httpx.HTTPError:pass
    phase='model_start'
    def launch():
        # Windows descendants can inherit PIPE handles and keep communicate()
        # blocked after PowerShell exits. File handles have no EOF dependency.
        with (BASE/'model-start.log').open('a',encoding='utf-8') as log:
            return subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'Start-LLM.ps1')],stdout=log,stderr=log,stdin=subprocess.DEVNULL,timeout=80,creationflags=FLAGS)
    r=await asyncio.to_thread(launch)
    if r.returncode:raise HTTPException(503,'local_start_failed')
    p=model_process()
    if p:
        with contextlib.suppress(psutil.Error):p.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    last_gpu=0
    s=await asyncio.to_thread(snapshot)
    if not s['ready']:
        await asyncio.to_thread(stop_model)
        raise HTTPException(503,s['reason'])

def owner(request):
    value=request.headers.get('x-panthorium-account','legacy')
    if value!='legacy' and not re.fullmatch(r'[0-9a-f]{64}',value):raise HTTPException(400,'invalid_account_key')
    return value

@contextlib.asynccontextmanager
async def admission(request,kind='chat',background=False):
    global busy,last_use,latest,phase,background_cancel
    cancel=None
    if not background and background_cancel is not None:background_cancel.set()
    if background:
        # Never queue background work, cold-load an engine, or compete with speech.
        if queue.active is not None or queue.pending or engine is not None or time.monotonic()-last_use<30:
            raise HTTPException(503,'background_waiting_idle')
        cancel=asyncio.Event();background_cancel=cancel
    async def ready():
        global latest
        # The queue calls readiness only when no operation is active. Reclaim the
        # other engine before forecasting a cold load; speech follows text turns.
        if background:
            if cancel.is_set() or len(queue.pending)>1:raise QueueError('background_preempted',503)
        elif kind=='voice':await asyncio.to_thread(stop_model)
        else:await asyncio.to_thread(drop_voice)
        latest=await asyncio.to_thread(snapshot,kind)
        if background and (not latest.get('modelLoaded') or cancel.is_set() or len(queue.pending)>1):
            raise QueueError('background_waiting_idle',503)
        if DISABLED.exists():raise QueueError('local_disabled',503)
        return admission_ready(latest)
    try:
        async with queue.lease(owner(request),ready,request.is_disconnected):
            busy=True;phase='admission'
            try:yield cancel
            finally:busy=False;phase='idle';last_use=time.monotonic()
    except QueueError as e:raise HTTPException(e.status,e.code,headers={'Retry-After':'10'})
    finally:
        if cancel is not None and background_cancel is cancel:background_cancel=None

async def voice_work(call):
    # A cancelled HTTP task must not release the slot while native synthesis still runs.
    task=asyncio.create_task(asyncio.to_thread(call))
    try:return await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise

async def monitor():
    global latest
    while True:
        try:
            latest=await asyncio.to_thread(snapshot)
            if DISABLED.exists() or latest.get('pressure') in ('ram_pressure','vram_pressure','gpu_temperature') or latest.get('reason') in ('gpu_metrics_unavailable','resource_monitor_unavailable'):
                # Free our own process only. Never stop a database, app or other GPU task.
                await asyncio.to_thread(stop_model)
                if not busy:await asyncio.to_thread(drop_voice)
            elif not busy and time.monotonic()-last_use>180:
                await asyncio.to_thread(drop_voice)
                # Until production is migrated, its old local route still uses
                # port 8088 directly. Keep that model resident for compatibility.
                if (BASE/'production-installed.json').exists():
                    await asyncio.to_thread(stop_model)
        except Exception:
            latest={'ready':False,'reason':'resource_monitor_unavailable','busy':busy}
            with contextlib.suppress(Exception):await asyncio.to_thread(stop_model)
        await asyncio.sleep(2)

@app.on_event('startup')
async def start():
    global ram_guard
    with contextlib.suppress(psutil.Error):psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    guard_stop.clear();guard_failed.clear()
    ram_guard=threading.Thread(target=fast_ram_watch,name='local-ai-ram-guard',daemon=True)
    ram_guard.start()
    app.state.monitor=asyncio.create_task(monitor())
@app.on_event('shutdown')
async def end():
    app.state.monitor.cancel()
    guard_stop.set()
    await asyncio.to_thread(stop_model)
    if ram_guard:await asyncio.to_thread(ram_guard.join,2)
@app.get('/status')
async def status(request:Request):return {**latest,'model':PROFILE['name'],'capabilities':PROFILE['capabilities'],'vision':PROFILE['vision'],'visionVerified':vision_verified,'voice':'external-asr-tts','training':{'method':'bf16-lora','minimumFreeVramGiB':10,'totalVramGiB':round(cached_gpu_total/1024**3,2) if cached_gpu_total else None,'execution':'dedicated-runner','canTrainOnThisHost':False},'busy':busy,'phase':phase,'ready':latest.get('ready',False) and not DISABLED.exists(),'queue':queue.status(owner(request))}
@app.get('/health')
async def health():return {'ok':True,'service':'panthorium-free-ai-broker','version':PROFILE['brokerVersion'],'backgroundPreemption':True,'model':PROFILE['name'],'capabilities':PROFILE['capabilities'],'vision':PROFILE['vision'],'visionVerified':vision_verified,'voice':'external-asr-tts','ramGuardAlive':bool(ram_guard and ram_guard.is_alive() and not guard_failed.is_set()),'inferenceVerified':inference_verified}

@app.post('/v1/chat/completions')
async def chat(request:Request):
    global phase,inference_verified,vision_verified
    raw=bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw)>MAX_BODY_BYTES:raise HTTPException(413,'too_large')
    try:
        data=json.loads(raw)
        if not isinstance(data,dict):raise ValueError('invalid_request')
        data['messages'], image_count = await asyncio.to_thread(normalize_messages,data.get('messages'))
        data['max_tokens']=min(3072,max(1,int(data.get('max_tokens',768))))
    except (ValueError,TypeError) as exc:raise HTTPException(400,'invalid_request') from exc
    if data.get('model')!='panthorium-local' or data.get('stream') is not False:raise HTTPException(400,'invalid_request')
    background=request.headers.get('x-panthorium-background')=='1'
    data['max_tokens']=min(256 if background else 3072,max(1,int(data.get('max_tokens',768))))
    if background:
        if image_count:raise HTTPException(400,'background_media_forbidden')
        if data.get('tools') or data.get('tool_choice'):raise HTTPException(400,'background_tools_forbidden')
        data['chat_template_kwargs']={'enable_thinking':False}
    async with admission(request,background=background) as cancel:
        if not background:
            await asyncio.to_thread(drop_voice)
            await ensure_model()
        phase="inference"
        async with httpx.AsyncClient(timeout=135) as client:
            task=asyncio.create_task(client.post('http://127.0.0.1:8088/v1/chat/completions',json=data))
            async def disconnected():
                while True:
                    event=await request.receive()
                    if event['type']=='http.disconnect':return
            watcher=asyncio.create_task(disconnected())
            preemption=asyncio.create_task(cancel.wait()) if cancel is not None else None
            try:
                waiting={task,watcher}
                if preemption is not None:waiting.add(preemption)
                done,_=await asyncio.wait(waiting,timeout=30 if background else 130,return_when=asyncio.FIRST_COMPLETED)
                if task not in done:
                    await asyncio.to_thread(stop_model)
                    raise HTTPException(499 if watcher in done else 503,'cancelled_or_timeout')
                r=await task
                if r.status_code==200:
                    with contextlib.suppress(ValueError,KeyError,IndexError,TypeError):
                        choice=r.json()['choices'][0]
                        if choice.get('finish_reason')!='length' and (choice['message'].get('content') or choice['message'].get('tool_calls')):
                            inference_verified=True
                            if image_count:vision_verified=True
                return Response(r.content,status_code=r.status_code,media_type='application/json')
            except asyncio.CancelledError:
                if background:await asyncio.to_thread(stop_model)
                raise
            except httpx.HTTPError:
                if background:await asyncio.to_thread(stop_model)
                raise HTTPException(503,'local_inference_unavailable')
            finally:
                task.cancel();watcher.cancel()
                if preemption is not None:preemption.cancel()
                await asyncio.gather(*waiting,return_exceptions=True)

@app.post('/speech')
async def speech(request:Request):
    data=await request.json();text=data.get('text','')
    if not isinstance(text,str) or not text.strip() or len(text)>1200:raise HTTPException(400,'invalid_text')
    async with admission(request,'voice'):
        audio,meta=await voice_work(lambda:voice_engine().speech(text,'th_m_1',1.0))
        return Response(audio,media_type='audio/wav',headers={'Cache-Control':'no-store','X-Audio-Duration':str(meta['audio_seconds'])})

@app.post('/transcribe')
async def transcribe(request:Request,file:UploadFile=File(...)):
    audio=await file.read(1024*1024+1);await file.close()
    if not audio or len(audio)>1024*1024:raise HTTPException(413,'invalid_audio_size')
    async with admission(request,'voice'):
        result=await voice_work(lambda:voice_engine().transcribe(io.BytesIO(audio)))
        return {'text':result['text'][:2000]}

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=8765,access_log=False,log_level='warning',limit_concurrency=32)
