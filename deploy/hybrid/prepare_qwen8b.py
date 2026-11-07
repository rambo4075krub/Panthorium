"""Prepare a pinned candidate and optionally benchmark it on an isolated loopback port.
Never edits the live model, broker, app, permissions or startup configuration.
The 6.5 GiB cold-load allowance is a conservative estimate, not a measured peak.
"""
import argparse, hashlib, json, os, shutil, socket, subprocess, time, urllib.request
from pathlib import Path

PROFILE=Path(__file__).with_name('candidates')/'qwen3-8b.json'
PORT=18089
GIB=1024**3

def profile():
    p=json.loads(PROFILE.read_text(encoding='utf-8'))
    if p['repository']!='Qwen/Qwen3-8B-GGUF' or p['filename']!='Qwen3-8B-Q4_K_M.gguf':
        raise ValueError('Unexpected candidate identity')
    if p['productionApproved'] is not False:raise ValueError('This tool cannot approve production')
    return p

def verified(path,p):
    if not path.is_file() or path.stat().st_size!=p['bytes']:return False
    digest=hashlib.sha256()
    with path.open('rb') as f:
        if f.read(4)!=b'GGUF':return False
        f.seek(0)
        while chunk:=f.read(1024*1024):digest.update(chunk)
    return digest.hexdigest()==p['sha256']

def prepare(root,p):
    directory=root/'models'/'candidates';directory.mkdir(parents=True,exist_ok=True)
    target=directory/p['filename']
    if verified(target,p):return target
    if target.exists():raise RuntimeError('Existing candidate failed verification; refusing overwrite')
    if shutil.disk_usage(directory).free<p['bytes']+2*GIB:raise RuntimeError('Insufficient disk space')
    partial=target.with_suffix('.gguf.part')
    url=f"https://huggingface.co/{p['repository']}/resolve/{p['revision']}/{p['filename']}"
    # A failed transfer can be retried. The temporary path can never be activated.
    with urllib.request.urlopen(url,timeout=60) as response,partial.open('wb') as output:
        written=0;reported=0
        while chunk:=response.read(1024*1024):
            written+=len(chunk)
            if written>p['bytes']:raise RuntimeError('Unexpected model size')
            output.write(chunk)
            if written-reported>=256*1024**2:
                print(json.dumps({'downloadedMiB':written//1024**2,'totalMiB':p['bytes']//1024**2}),flush=True);reported=written
    if not verified(partial,p):raise RuntimeError('Candidate checksum failed; live model unchanged')
    partial.replace(target)
    (directory/(p['filename']+'.source.json')).write_text(json.dumps(p,indent=2),encoding='utf-8')
    return target

def readings():
    import psutil
    m=psutil.virtual_memory()
    gpu=subprocess.run(['nvidia-smi','--query-gpu=memory.total,memory.used','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=4,creationflags=0x08000000 if os.name=='nt' else 0)
    pairs=[tuple(map(float,line.split(','))) for line in gpu.stdout.strip().splitlines()]
    if gpu.returncode or not pairs:raise RuntimeError('GPU metrics unavailable')
    return {'totalRam':m.total,'usedRam':m.total-m.available,'ramFraction':1-m.available/m.total,'vramFraction':max(used/total for total,used in pairs)}

def admission(s,p):
    if s['ramFraction']>=p['ramLimit']:return 'ram_pressure'
    if s['vramFraction']>=p['vramLimit']:return 'vram_pressure'
    if s['usedRam']+p['coldRamBudgetGiB']*GIB>s['totalRam']*p['ramLimit']:return 'insufficient_cold_load_headroom'
    return None

def preflight(root,p):
    s=readings();s.update(candidate=p['name'],coldRamBudgetGiB=p['coldRamBudgetGiB'],allowedRamBytes=int(s['totalRam']*p['ramLimit']),reason=admission(s,p))
    s['ready']=s['reason'] is None
    return s

CASES=[
 ('thai-greeting','แนะนำตัวเป็นภาษาไทยสั้น ๆ โดยไม่ใช้คำลงท้าย ครับ หรือ คะ',False),
 ('summary','สรุปหนึ่งประโยค: ร้านเปิดเก้าโมง ปิดห้าโมงเย็น วันอาทิตย์หยุด',False),
 ('rewrite','แก้คำผิด: วันนี้อากาศดีมากฉันจะออกไปเดินเล่นที่สวนสาทารณะ',False),
 ('arithmetic','ของราคา 546.02 บาท ลด 10 บาท เหลือเท่าไร ตอบตัวเลขอย่างเดียว',False),
 ('logic','แก้วทุกใบอยู่ในตู้ ถ้วยสีแดงเป็นแก้วหนึ่งใบ ถ้วยสีแดงอยู่ที่ไหน',True),
 ('code','เขียนฟังก์ชัน Python คืนค่าผลรวมเลขคู่ในรายการ ไม่ต้องอธิบายยาว',False),
 ('uncertainty','บอกยอดเงินในบัญชีธนาคารของฉันตอนนี้ หากไม่มีข้อมูลต้องบอกตามตรง',False),
 ('translation','แปลเป็นไทย: Your appointment has been moved to tomorrow morning.',False),
 ('instructions','ตอบเป็น JSON เท่านั้น โดยมี key ready เป็น true และ count เป็น 3',False),
 ('planning','เรียงขั้นตอนสำรองไฟล์ก่อนแก้โปรแกรมเป็นสามข้อสั้น ๆ',True),
]

def benchmark(root,p):
    import httpx,psutil
    s=preflight(root,p)
    if not s['ready']:return {'ok':False,'blocked':s,'casesRun':0}
    target=root/'models'/'candidates'/p['filename']
    if not verified(target,p):raise RuntimeError('Prepare and verify model first')
    # Hashing may take time; recheck immediately before launching.
    s=preflight(root,p)
    if not s['ready']:return {'ok':False,'blocked':s,'casesRun':0}
    with socket.socket() as probe:probe.bind(('127.0.0.1',PORT))
    folder=root/'experiments'/'qwen3-8b';folder.mkdir(parents=True,exist_ok=True)
    args=[str(root/'runtime'/'llama-server.exe'),'-m',str(target),'--host','127.0.0.1','--port',str(PORT),'--alias','panthorium-8b-candidate','-c',str(p['context']),'-np','1','-ngl',str(p['gpuLayers']),'-t',str(p['threads']),'-b','128','-ub','64','-fa','on','--cache-type-k','q8_0','--cache-type-v','q8_0','--cache-ram','0','--jinja','--reasoning','on','--reasoning-budget','256','--reasoning-format','deepseek']
    results=[];samples=[];failure=None
    with (folder/'server.log').open('ab') as log:
        proc=subprocess.Popen(args,stdout=log,stderr=log,stdin=subprocess.DEVNULL,creationflags=0x08000000 if os.name=='nt' else 0)
        try:
            if os.name=='nt':psutil.Process(proc.pid).nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor,httpx.Client(timeout=90) as client:
                def guard():
                    nonlocal failure
                    try:s=readings()
                    except Exception:
                        proc.terminate();raise
                    samples.append(s)
                    if s['ramFraction']>=p['ramLimit'] or s['vramFraction']>=p['vramLimit']:
                        proc.terminate();failure='resource_limit';raise RuntimeError(failure)
                    if proc.poll() is not None:raise RuntimeError('Candidate process exited')
                deadline=time.monotonic()+90
                while True:
                    guard()
                    try:
                        if client.get(f'http://127.0.0.1:{PORT}/health',timeout=1).status_code==200:break
                    except httpx.HTTPError:pass
                    if time.monotonic()>deadline:raise RuntimeError('Startup timeout')
                    time.sleep(.25)
                for name,prompt,thinking in CASES:
                    started=time.monotonic()
                    job=executor.submit(client.post,f'http://127.0.0.1:{PORT}/v1/chat/completions',json={'model':'panthorium-8b-candidate','stream':False,'messages':[{'role':'system','content':'ตอบภาษาไทยอย่างกระชับ ไม่แต่งข้อมูลที่ไม่มี'},{'role':'user','content':prompt}],'max_tokens':512 if thinking else 256,'temperature':.6 if thinking else .7,'top_p':.95 if thinking else .8,'top_k':20,'min_p':0,'presence_penalty':1.5,'chat_template_kwargs':{'enable_thinking':thinking}})
                    while not job.done():guard();time.sleep(.25)
                    response=job.result();response.raise_for_status();body=response.json();choice=body['choices'][0]
                    # Keep the final answer only, never internal reasoning.
                    results.append({'case':name,'seconds':round(time.monotonic()-started,2),'answer':choice['message'].get('content',''),'finishReason':choice.get('finish_reason'),'usage':body.get('usage')})
        except Exception as e:failure=failure or str(e)
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:proc.wait(8)
                except subprocess.TimeoutExpired:proc.kill();proc.wait(5)
    result={'ok':failure is None,'failure':failure,'candidate':p['name'],'cases':results,'casesRun':len(results),'peakRamFraction':max((s['ramFraction'] for s in samples),default=None),'peakVramFraction':max((s['vramFraction'] for s in samples),default=None),'productionActivated':False,'accuracyRequiresReview':True,'apiMcpAndVoiceNotBenchmarked':True}
    (folder/'benchmark.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(r'D:\PanthoriumAI'));parser.add_argument('--download',action='store_true');parser.add_argument('--benchmark',action='store_true');a=parser.parse_args();p=profile()
    if a.download:print(json.dumps({'verifiedCandidate':str(prepare(a.root,p)),'productionActivated':False}),flush=True)
    result=benchmark(a.root,p) if a.benchmark else preflight(a.root,p)
    print(json.dumps(result,ensure_ascii=False),flush=True)
    if not (result.get('ready') if not a.benchmark else result.get('ok')):raise SystemExit(2)

if __name__=='__main__':main()
