"""Pinned local model identity, startup arguments and fail-closed load admission."""
import hashlib, json, os, subprocess, sys
from pathlib import Path

PROFILE = json.loads((Path(__file__).with_name('model-profile.json')).read_text(encoding='utf-8'))
ROOT = Path(os.environ.get('PANTHORIUM_AI_ROOT', r'D:\PanthoriumAI'))

def model_path(root=ROOT):
    name = PROFILE['filename']
    if Path(name).name != name or '/' in name or '\\' in name:
        raise ValueError('Model filename must not contain a path')
    return root / 'models' / name

def verify_model(path):
    if path.stat().st_size != PROFILE['bytes']:
        raise ValueError('Model size mismatch')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        if stream.read(4) != b'GGUF': raise ValueError('Invalid GGUF file')
        stream.seek(0)
        for chunk in iter(lambda: stream.read(8 * 1024**2), b''): digest.update(chunk)
    if digest.hexdigest() != PROFILE['sha256']: raise ValueError('Model checksum mismatch')
    return digest.hexdigest()

def same_path(a, b):
    return str(a).replace('\\', '/').casefold() == str(b).replace('\\', '/').casefold()

def owns_model(exe, args, root=ROOT, filename=None):
    """Never trust a PID or a model path appearing in an unrelated argument."""
    try:
        selected = root / 'models' / filename if filename else model_path(root)
        return (same_path(exe, root / 'runtime' / 'llama-server.exe') and
                same_path(args[args.index('-m') + 1], selected) and
                args[args.index('--host') + 1] == '127.0.0.1' and
                args[args.index('--port') + 1] == '8088')
    except (ValueError, IndexError, TypeError): return False

def startup_args(root=ROOT):
    return ['-m', str(model_path(root)), '--host', '127.0.0.1', '--port', '8088',
            '-c', str(PROFILE['context']), '-np', '1', '-ngl', str(PROFILE['gpuLayers']),
            '-t', str(PROFILE['threads']), '-b', '128', '-ub', '64', '-fa', 'on',
            '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--cache-ram', '0',
            '--jinja', '--reasoning', 'on', '--reasoning-budget', '2048',
            '--reasoning-format', 'deepseek', '--alias', 'panthorium-local']

def preflight(root=ROOT):
    import psutil
    from work_queue import resource_reason
    mem = psutil.virtual_memory()
    vram = None
    try:
        result = subprocess.run(['nvidia-smi', '--query-gpu=memory.total,memory.used',
                                 '--format=csv,noheader,nounits'], capture_output=True,
                                text=True, check=True, timeout=4,
                                creationflags=0x08000000 if os.name == 'nt' else 0)
        pairs = [tuple(map(float, line.split(','))) for line in result.stdout.strip().splitlines()]
        vram = max(used / total for total, used in pairs)
    except (OSError, ValueError, subprocess.SubprocessError, ZeroDivisionError): pass
    used = 1 - mem.available / mem.total
    reason = resource_reason(ram_used=used, total=mem.total, available=mem.available,
                             local_ram=psutil.Process().memory_info().rss, vram=vram,
                             cpu=psutil.cpu_percent(interval=.2), model_loaded=False,
                             voice_loaded=False, cold_budget=PROFILE['coldRamBudgetGiB'])
    if (root / 'qwen.disabled').exists(): reason = 'disabled'
    return {'ready': reason is None, 'reason': reason, 'ramUsedFraction': used,
            'vramUsedFraction': vram, 'coldRamBudgetGiB': PROFILE['coldRamBudgetGiB']}

if __name__ == '__main__':
    # Check resources before hashing/loading a large file; direct launchers cannot bypass admission.
    result = preflight()
    if result['ready']:
        verify_model(model_path())
        result = preflight()
        if result['ready']: result['args'] = startup_args()
    print(json.dumps(result))
    sys.exit(0 if result['ready'] else 2)
