"""One-shot local Qwen3.5 trial. Never edits production or executes model tools."""
import concurrent.futures
import hashlib
import json
import os
import secrets
import socket
import subprocess
import threading
import time
from pathlib import Path

GIB = 1024 ** 3
MIB = 1024 ** 2
RAM_LIMIT = 0.82
VRAM_LIMIT = 0.80
PORT = 18090
ROOT = Path(r'D:\PanthoriumAI')
FOLDER = ROOT / 'experiments' / 'qwen3.5-9b'
FLAGS = 0x08000000 if os.name == 'nt' else 0


def parse_memory(output):
    rows = {}
    for line in output.splitlines():
        parts = line.split()
        if len(parts) == 4 and parts[0] in ('CUDA0', 'Host'):
            rows[parts[0]] = sum(int(n) for n in parts[1:]) * MIB
    if set(rows) != {'CUDA0', 'Host'}:
        raise ValueError('Unknown memory-estimate format')
    return rows


def admission(s, estimate=None):
    if s['productionBusy']:
        return 'production_busy'
    if s['ramFraction'] >= RAM_LIMIT or s['available'] < 2.5 * GIB:
        return 'ram_pressure'
    if s['gpuUsed'] >= s['gpuTotal'] * VRAM_LIMIT or s['gpuTemperature'] >= 82:
        return 'gpu_pressure'
    if estimate:
        if s['used'] + estimate['Host'] + 512 * MIB > s['total'] * RAM_LIMIT:
            return 'insufficient_ram_headroom'
        if s['gpuUsed'] + estimate['CUDA0'] + 384 * MIB > s['gpuTotal'] * VRAM_LIMIT:
            return 'insufficient_gpu_headroom'
    return None


def snapshot(client):
    import psutil
    mem = psutil.virtual_memory()
    gpu = subprocess.run(['nvidia-smi', '--query-gpu=memory.total,memory.used,temperature.gpu',
                          '--format=csv,noheader,nounits'], capture_output=True, text=True,
                         check=True, timeout=3, creationflags=FLAGS)
    total, used, temperature = map(float, gpu.stdout.strip().split(','))
    broker = client.get('http://127.0.0.1:8765/status', timeout=2)
    broker.raise_for_status()
    status = broker.json()
    return {'total': mem.total, 'available': mem.available, 'used': mem.total - mem.available,
            'ramFraction': 1 - mem.available / mem.total, 'gpuTotal': total * MIB,
            'gpuUsed': used * MIB, 'gpuTemperature': temperature,
            'cpuPercent': psutil.cpu_percent(),
            'productionBusy': bool(status.get('busy') or status.get('modelLoaded') or
                                   status.get('queue', {}).get('running') or
                                   status.get('queue', {}).get('waiting'))}


CASES = [
    ('thai-summary', 'สรุปเป็นภาษาไทยหนึ่งประโยค: ร้านเปิดวันจันทร์ถึงเสาร์ 09:00-17:00 น. ปิดวันอาทิตย์'),
    ('arithmetic', 'สินค้าราคา 1200, 890 และ 460 บาท ลดค่าสินค้ารวม 10% แล้วบวกค่าส่ง 50 บาท ต้องจ่ายเท่าไร ตอบเป็นตัวเลขอย่างเดียว'),
    ('json', 'ตอบเป็น JSON เท่านั้น โดยมี key ready เป็น true และ count เป็น 3'),
    ('thai-deadline', 'จากข้อความนี้ต้องส่งเอกสารเมื่อไร: นัดประชุมเปลี่ยนเป็นวันศุกร์ที่ 13 พฤศจิกายน เวลา 14:30 น. กรุณาส่งเอกสารก่อนวันพฤหัสบดีที่ 12 พฤศจิกายน เวลา 18:00 น. ตอบเฉพาะกำหนดส่งเอกสาร'),
    ('code', 'เขียนฟังก์ชัน Python ชื่อ sum_even รับรายการตัวเลขแล้วคืนผลรวมเฉพาะเลขคู่ ตอบโค้ดสั้น ๆ'),
    ('uncertainty', 'ตอนนี้บัญชีธนาคารของฉันมีเงินกี่บาท หากไม่มีข้อมูลต้องบอกตามตรง'),
]


def run():
    import httpx
    import psutil
    p = json.loads((FOLDER / 'candidate-q3.json').read_text(encoding='utf-8'))
    if p['name'] != 'Qwen3.5-9B-Q3_K_S' or p['productionApproved'] is not False:
        raise ValueError('Unexpected trial profile')
    model = ROOT / 'models' / 'candidates' / p['filename']
    from prepare_qwen8b import verified
    if not verified(model, p):
        raise ValueError('Model checksum failed')
    psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    production_profile = ROOT / 'hybrid' / 'model-profile.json'
    before_hash = hashlib.sha256(production_profile.read_bytes()).hexdigest()
    common = ['-m', str(model), '-c', '2048', '-b', '128', '-ub', '64', '-t', '4',
              '-fa', 'on', '-ctk', 'f16', '-ctv', 'f16']
    report = {'candidate': p['name'], 'productionActivated': False, 'cases': [], 'estimates': [],
              'limits': {'ramFraction': RAM_LIMIT, 'vramFraction': VRAM_LIMIT,
                         'minimumAvailableGiB': 2.5, 'maximumSeconds': 480},
              'visionTested': False, 'realToolsExecuted': False}
    proc = None
    peak_ram = 0.0
    peak_gpu = 0.0
    key_path = FOLDER / 'trial-api-key.txt'
    samples = []
    stop_watchdog = threading.Event()
    watchdog_failure = []
    watchdog = None
    try:
        with httpx.Client(timeout=120, trust_env=False) as client:
            initial = snapshot(client)
            report['before'] = initial
            selected = None
            for layers in (26, 24, 22, 20, 18):
                result = subprocess.run([str(ROOT / 'runtime' / 'llama-fit-params.exe'), *common,
                                         '-ngl', str(layers), '--fit-print', 'on'],
                                        capture_output=True, text=True, encoding='utf-8',
                                        errors='replace', timeout=40, creationflags=FLAGS)
                if result.returncode:
                    raise RuntimeError('Memory estimator failed: ' + result.stderr[-500:])
                estimate = parse_memory(result.stdout)
                current = snapshot(client)
                reason = admission(current, estimate)
                report['estimates'].append({'gpuLayers': layers, 'bytes': estimate, 'reason': reason})
                if reason is None:
                    selected = layers
                    break
            if selected is None:
                report['failure'] = 'resource_admission_blocked'
                return report
            # Recheck immediately before launch, with a separate loopback port and API key.
            reason = admission(snapshot(client), estimate)
            if reason:
                report['failure'] = reason
                return report
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', PORT))
            key = secrets.token_urlsafe(32)
            key_path.write_text(key, encoding='ascii')
            report['gpuLayers'] = selected
            args = [str(ROOT / 'runtime' / 'llama-server.exe'), *common, '-ngl', str(selected),
                    '--fit', 'off', '--host', '127.0.0.1', '--port', str(PORT), '-np', '1',
                    '--alias', 'panthorium-9b-trial', '--cache-ram', '0', '--jinja',
                    '--load-mode', 'none', '--no-agent', '--poll', '0', '--threads-batch', '4',
                    '--no-webui', '--api-key-file', str(key_path),
                    '--chat-template-kwargs', '{"enable_thinking":false}']
            report['loadMode'] = 'none'

            def watch_ram():
                nonlocal peak_ram
                while not stop_watchdog.wait(.05):
                    try:
                        mem = psutil.virtual_memory()
                        used = 1 - mem.available / mem.total
                        peak_ram = max(peak_ram, used)
                        if used >= RAM_LIMIT or mem.available < 2.5 * GIB:
                            watchdog_failure.append('ram_pressure')
                            if proc is not None and proc.poll() is None:
                                proc.terminate()
                            return
                    except Exception:
                        watchdog_failure.append('memory_monitor_failed')
                        if proc is not None and proc.poll() is None:
                            proc.terminate()
                        return

            watchdog = threading.Thread(target=watch_ram, daemon=True)
            watchdog.start()
            with (FOLDER / 'trial-server.log').open('wb') as log:
                proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                        creationflags=FLAGS)
            psutil.Process(proc.pid).nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
            report['trialPid'] = proc.pid
            deadline = time.monotonic() + 480
            cpu_pressure_count = 0

            def guard():
                nonlocal cpu_pressure_count, peak_ram, peak_gpu
                if watchdog_failure:
                    raise RuntimeError(watchdog_failure[0])
                s = snapshot(client)
                peak_ram = max(peak_ram, s['ramFraction'])
                peak_gpu = max(peak_gpu, s['gpuUsed'] / s['gpuTotal'])
                samples.append(s)
                cpu_pressure_count = cpu_pressure_count + 1 if s['cpuPercent'] >= 70 else 0
                failure = admission(s)
                if failure or cpu_pressure_count >= 3 or time.monotonic() > deadline:
                    raise RuntimeError(failure or 'cpu_pressure_or_trial_deadline')
                if proc.poll() is not None:
                    raise RuntimeError('Candidate process exited')

            startup_deadline = time.monotonic() + 90
            while True:
                guard()
                try:
                    health = client.get(f'http://127.0.0.1:{PORT}/health',
                                        headers={'Authorization': 'Bearer ' + key}, timeout=1)
                    if health.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                if time.monotonic() > startup_deadline:
                    raise RuntimeError('Candidate startup timeout')
                time.sleep(.5)
            report['loaded'] = True
            print(json.dumps({'loaded': True, 'gpuLayers': selected}), flush=True)
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                def chat(name, messages, tools=None):
                    payload = {'model': 'panthorium-9b-trial', 'messages': messages, 'stream': False,
                               'max_tokens': 256, 'temperature': .7, 'top_p': .8, 'top_k': 20,
                               'min_p': 0, 'presence_penalty': 1.5,
                               'chat_template_kwargs': {'enable_thinking': False}}
                    if tools:
                        payload.update(tools=tools, tool_choice='auto')
                    start = time.monotonic()
                    future = pool.submit(client.post, f'http://127.0.0.1:{PORT}/v1/chat/completions',
                                         json=payload, headers={'Authorization': 'Bearer ' + key})
                    try:
                        while not future.done():
                            guard()
                            time.sleep(.5)
                        response = future.result()
                        response.raise_for_status()
                    except BaseException:
                        if proc.poll() is None:
                            proc.terminate()
                        raise
                    body = response.json()
                    choice = body['choices'][0]
                    message = choice['message']
                    item = {'case': name, 'seconds': round(time.monotonic() - start, 2),
                            'answer': message.get('content'), 'toolCalls': message.get('tool_calls'),
                            'finishReason': choice.get('finish_reason'), 'usage': body.get('usage'),
                            'timings': body.get('timings')}
                    report['cases'].append(item)
                    print(json.dumps(item, ensure_ascii=True), flush=True)
                    return message

                system = {'role': 'system', 'content': 'ตอบภาษาไทยอย่างกระชับ ไม่แต่งข้อมูลที่ไม่มี'}
                for name, prompt in CASES:
                    chat(name, [system, {'role': 'user', 'content': prompt}])
                messages = [system, {'role': 'user', 'content': 'ตรวจจำนวนการแจ้งเตือนที่ยังไม่อ่านในกล่อง inbox ให้ฉัน'}]
                tools = [{'type': 'function', 'function': {
                    'name': 'get_notification_count', 'description': 'Get unread notifications for a channel',
                    'parameters': {'type': 'object', 'properties': {'channel': {'type': 'string'}},
                                   'required': ['channel'], 'additionalProperties': False}}}]
                message = chat('tool-selection', messages, tools)
                calls = message.get('tool_calls') or []
                valid = len(calls) == 1 and calls[0]['function']['name'] == 'get_notification_count'
                if valid:
                    valid = json.loads(calls[0]['function']['arguments']) == {'channel': 'inbox'}
                report['syntheticToolSelectionPassed'] = valid
                if valid:
                    # Synthetic result only. No Panthorium APIs, mail or user data are accessed.
                    messages.extend([{'role': 'assistant', 'content': message.get('content'), 'tool_calls': calls},
                                     {'role': 'tool', 'tool_call_id': calls[0]['id'],
                                      'content': '{"unread":7,"channel":"inbox"}'}])
                    chat('tool-result', messages, tools)
            report['completed'] = True
    except Exception as exc:
        report['failure'] = str(exc)
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(8)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(5)
        stop_watchdog.set()
        if watchdog is not None:
            watchdog.join(2)
        key_path.unlink(missing_ok=True)
        report['trialStopped'] = proc is None or proc.poll() is not None
        report['casesRun'] = len(report['cases'])
        report['peakRamFraction'] = peak_ram
        report['peakVramFraction'] = peak_gpu
        report['productionProfileUnchanged'] = before_hash == hashlib.sha256(production_profile.read_bytes()).hexdigest()
        with httpx.Client(trust_env=False) as client:
            try:
                report['after'] = snapshot(client)
            except Exception as exc:
                report['afterError'] = str(exc)
        (FOLDER / 'trial-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return report


if __name__ == '__main__':
    print(json.dumps(run(), ensure_ascii=True), flush=True)
