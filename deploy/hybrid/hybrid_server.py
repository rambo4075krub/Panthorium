"""Loopback-only free AI broker. One admitted operation across both app stages.
No credentials, remote tools or user content are persisted by this process.
"""
from pathlib import Path
import asyncio, contextlib, gc, io, json, os, subprocess, sys, time
import httpx, psutil, threading, re
from work_queue import WorkQueue, QueueError, resource_reason
queue=WorkQueue()
metrics_lock=threading.Lock()
pressure_latched=False
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import Response
BASE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get('PANTHORIUM_AI_ROOT',r'D:\PanthoriumAI'))
sys.path.insert(0,str(ROOT/'voice'))
RESERVE=1536*1024**2
LIMIT=.60
DISABLED=ROOT/'qwen.disabled'
FLAGS=0x08000000 if os.name=='nt' else 0
app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
busy=False
phase="idle"
last_use=time.monotonic()
engine=None
latest={'ready':False,'reason':'starting'}
last_gpu=0
cached_gpu=None

def run(args,timeout=15):
    return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,stdin=subprocess.DEVNULL,timeout=timeout,creationflags=FLAGS,text=True)
def model_process():
    try:
        p=psutil.Process(int((ROOT/'llm.pid').read_text().strip()))
        args=p.cmdline()
        if Path(p.exe()).resolve()!= (ROOT/'runtime'/'llama-server.exe').resolve():return None
        if str(ROOT/'models'/'Qwen3.5-4B-Q4_K_M.gguf') not in args:return None
        if args[args.index('--port')+1]!='8088' or args[args.index('--host')+1]!='127.0.0.1':return None
        return p
    except (OSError,ValueError,psutil.Error):return None

def stop_model():
    p=model_process()
    if p:
        p.terminate()
        try:p.wait(8)
        except psutil.TimeoutExpired:p.kill()

def snapshot(kind="chat"):
    with metrics_lock:return _snapshot(kind)

def _snapshot(kind="chat"):
    global cached_gpu,last_gpu,pressure_latched
    mem=psutil.virtual_memory()
    p=model_process()
    local=psutil.Process().memory_info().rss
    if p:
        try:local+=p.memory_info().rss
        except psutil.Error:pass
    if time.monotonic()-last_gpu>2:
        try:
            r=run(['nvidia-smi','--query-gpu=memory.total,memory.used','--format=csv,noheader,nounits'],4)
            pairs=[tuple(map(float,line.split(','))) for line in r.stdout.strip().splitlines()]
            cached_gpu=max(used/total for total,used in pairs)
        except Exception:cached_gpu=None
        last_gpu=time.monotonic()
    ram_used=1-mem.available/mem.total
    cpu=psutil.cpu_percent()
    hard='ram_pressure' if ram_used>=.65 or mem.available<RESERVE else 'vram_pressure' if cached_gpu is not None and cached_gpu>=.60 else None
    if hard:pressure_latched=True
    elif ram_used<.60 and cached_gpu is not None and cached_gpu<.55:pressure_latched=False
    reason='disabled' if DISABLED.exists() else resource_reason(ram_used=ram_used,total=mem.total,available=mem.available,local_ram=local,vram=cached_gpu,cpu=cpu,model_loaded=p is not None,voice_loaded=engine is not None,kind=kind,latched=pressure_latched)
    return {'ready':reason is None,'reason':reason,'pressure':hard,'busy':busy,'ramAvailableBytes':mem.available,'ramUsedFraction':ram_used,'ramLimit':.65,'cpuPercent':cpu,'localRamBytes':local,'localRamLimitBytes':int(mem.total*LIMIT),'vramUsedFraction':cached_gpu,'vramLimit':LIMIT,'modelLoaded':p is not None,'queue':queue.status()}

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
            if (await client.get('http://127.0.0.1:8088/health')).status_code==200:return
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
async def admission(request,kind='chat'):
    global busy,last_use,latest,phase
    async def ready():
        global latest
        latest=await asyncio.to_thread(snapshot,kind)
        if DISABLED.exists():raise QueueError('local_disabled',503)
        return latest['ready']
    try:
        async with queue.lease(owner(request),ready,request.is_disconnected):
            busy=True;phase='admission'
            try:yield
            finally:busy=False;phase='idle';last_use=time.monotonic()
    except QueueError as e:raise HTTPException(e.status,e.code,headers={'Retry-After':'10'})

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
            if DISABLED.exists() or latest.get('pressure') in ('ram_pressure','vram_pressure'):
                # Free our own process only. Never stop a database, app or other GPU task.
                await asyncio.to_thread(stop_model)
                if not busy:await asyncio.to_thread(drop_voice)
            elif not busy and time.monotonic()-last_use>180:
                await asyncio.to_thread(drop_voice)
                # Until production is migrated, its old local route still uses
                # port 8088 directly. Keep that model resident for compatibility.
                if (BASE/'production-installed.json').exists():
                    await asyncio.to_thread(stop_model)
        except Exception:latest={'ready':False,'reason':'resource_monitor_unavailable','busy':busy}
        await asyncio.sleep(2)

@app.on_event('startup')
async def start():
    with contextlib.suppress(psutil.Error):psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    app.state.monitor=asyncio.create_task(monitor())
@app.on_event('shutdown')
async def end():
    app.state.monitor.cancel()
@app.get('/status')
async def status(request:Request):return {**latest,'busy':busy,'phase':phase,'ready':latest.get('ready',False) and not DISABLED.exists(),'queue':queue.status(owner(request))}
@app.get('/health')
async def health():return {'ok':True,'service':'panthorium-free-ai-broker','version':'queue-v1'}

@app.post('/v1/chat/completions')
async def chat(request:Request):
    global phase
    if int(request.headers.get('content-length','0'))>60000:raise HTTPException(413,'too_large')
    raw=await request.body()
    if len(raw)>60000:raise HTTPException(413,'too_large')
    data=json.loads(raw)
    if data.get('model')!='panthorium-local' or data.get('stream') is not False:raise HTTPException(400,'invalid_request')
    data['max_tokens']=min(3072,max(1,int(data.get('max_tokens',768))))
    async with admission(request):
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
            try:
                done,_=await asyncio.wait({task,watcher},timeout=130,return_when=asyncio.FIRST_COMPLETED)
                if task not in done:
                    await asyncio.to_thread(stop_model)
                    raise HTTPException(499 if watcher in done else 503,'cancelled_or_timeout')
                r=await task
                return Response(r.content,status_code=r.status_code,media_type='application/json')
            except httpx.HTTPError:raise HTTPException(503,'local_inference_unavailable')
            finally:
                task.cancel();watcher.cancel()
                await asyncio.gather(task,watcher,return_exceptions=True)

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
