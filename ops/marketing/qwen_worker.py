"""One bounded, loopback-only inference on the production notebook."""
import concurrent.futures
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

import psutil

ROOT = Path(r"D:\PanthoriumAI")
MODEL = ROOT / "models" / "Qwen3.5-2B-Q4_K_M.gguf"
SERVER = ROOT / "runtime" / "llama-server.exe"
GIB = 1024 ** 3
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Pressure(Exception):
    pass


def memory_guard(reserve=0):
    ram = psutil.virtual_memory()
    if ram.available - reserve < max(2.5 * GIB, ram.total * .18):
        raise Pressure()


def gpu_guard(smi, starting=False):
    values = subprocess.check_output(
        [smi, "--query-gpu=memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits", "-i", "0"],
        text=True, timeout=2, creationflags=subprocess.CREATE_NO_WINDOW)
    used, total, temp = map(int, values.strip().split(","))
    if used + (1400 if starting else 0) >= total * .80 or temp >= 82:
        raise Pressure()


def kill_on_close_job():
    # A kernel Job owns the model server even if the supervisor is force-stopped.
    class Basic(ctypes.Structure):
        _fields_ = [("per_process_time", ctypes.c_int64), ("per_job_time", ctypes.c_int64),
                    ("flags", wintypes.DWORD), ("min_ws", ctypes.c_size_t), ("max_ws", ctypes.c_size_t),
                    ("process_limit", wintypes.DWORD), ("affinity", ctypes.c_size_t),
                    ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
    class Limits(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", ctypes.c_uint64 * 6), ("memory", ctypes.c_size_t * 4)]
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    k.CreateJobObjectW.restype = wintypes.HANDLE
    k.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    job = k.CreateJobObjectW(None, None)
    limits = Limits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not job or not k.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        raise OSError("worker_supervision_unavailable")
    return k, job


def completion(port, token, facts):
    schema = {"type": "object", "additionalProperties": False, "properties": {
        "objective": {"type": "string", "enum": ["discovery", "activation", "retention"]},
        "product": {"type": "string", "enum": [p["id"] for p in facts["products"]]},
        **{key: {"type": "string"} for key in ("audience", "channel", "experiment", "searchQuery")}}}
    schema["required"] = list(schema["properties"])
    messages = [{"role": "system", "content": (
        "คุณเป็นนักการตลาดไทยของ Panthorium ซึ่งมีผู้ช่วยเสียง AI, Social Feed, Chat และ Market "
        "เสนอการทดลองขนาดเล็กหนึ่งอย่างที่ทีมลงมือทำได้ เขียน audience, channel, experiment และ searchQuery เป็นภาษาไทย "
        "ระบุกลุ่มเฉพาะกับปัญหาที่ต้องการแก้ ช่องทางสาธารณะที่เข้าถึงกลุ่มนั้น และกิจกรรมที่วัดผลได้จริง "
        "ตัวอย่างระดับรายละเอียด: เจ้าของร้านที่ตอบคำถามซ้ำในเพจร้าน, กลุ่มเฟซบุ๊กผู้ขายของออนไลน์ไทย, "
        "ทำคลิปสาธิตการร่างคำตอบแล้วเปรียบเทียบจำนวนคนที่เปิดหน้าลองใช้, ชุมชนผู้ค้าออนไลน์ไทย "
        "ห้ามแต่งส่วนลด ราคา หรือยอดลูกค้า ข้อมูล activity เป็นจำนวนผู้ยินยอมที่เข้าหมวดในเจ็ดวัน "
        "ถ้าไม่มีข้อมูล ให้เสนอสิ่งที่ควรทดลองโดยไม่อ้างว่ามีอุปสงค์ ส่งเฉพาะ JSON ตามโครงสร้าง")},
                {"role": "user", "content": "วางแผนให้ทีมการตลาดไทยโดยใช้ข้อมูลนี้ " + json.dumps(facts, ensure_ascii=False)}]
    body = {"model": "panthorium-local", "messages": messages, "temperature": .25, "max_tokens": 500,
            "chat_template_kwargs": {"enable_thinking": False},
            "response_format": {"type": "json_schema", "json_schema": {"name": "brief", "schema": schema}}}
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",
                                 data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with HTTP.open(req, timeout=95) as r:
        return json.loads(json.load(r)["choices"][0]["message"]["content"])


def run(facts):
    if MODEL.stat().st_size != 1280835840:
        raise RuntimeError("unexpected_model")
    parent = psutil.Process(os.getppid())
    smi = shutil.which("nvidia-smi") or str(Path(os.environ["SystemRoot"]) / "System32/nvidia-smi.exe")
    memory_guard(1.58 * GIB)
    gpu_guard(smi, starting=True)
    token = secrets.token_urlsafe(32)
    with socket.socket() as bound:
        bound.bind(("127.0.0.1", 0))
        port = bound.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="panthorium-marketing-") as root:
        key = Path(root) / "session.key"
        key.write_text(token, encoding="ascii")
        args = [str(SERVER), "-m", str(MODEL), "--host", "127.0.0.1", "--port", str(port),
                "--api-key-file", str(key), "--alias", "panthorium-local", "-c", "2048", "-np", "1",
                "-ngl", "99", "-t", "2", "--threads-batch", "2", "-b", "64", "-ub", "32", "-fa", "on",
                "--cache-ram", "0", "--load-mode", "none", "--fit", "off", "--no-agent", "--no-webui",
                "--poll", "0", "--jinja", "--reasoning", "off", "--reasoning-budget", "0"]
        kernel, job = kill_on_close_job()
        proc = None
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            proc = subprocess.Popen(args, cwd=SERVER.parent, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS)
            if not kernel.AssignProcessToJobObject(job, wintypes.HANDLE(int(proc._handle))):
                raise OSError("cannot_supervise_model")
            end = time.monotonic() + 120
            next_gpu = next_health = 0
            future = None
            while time.monotonic() < end and proc.poll() is None and parent.is_running():
                memory_guard()
                now = time.monotonic()
                if now >= next_gpu:
                    gpu_guard(smi)
                    next_gpu = now + .45
                if future:
                    if future.done():
                        return future.result()
                elif now >= next_health:
                    next_health = now + .35
                    try:
                        with HTTP.open(f"http://127.0.0.1:{port}/health", timeout=.2) as response:
                            if json.load(response).get("status") == "ok":
                                future = executor.submit(completion, port, token, facts)
                    except (OSError, ValueError):
                        pass
                time.sleep(.075)
            raise RuntimeError("worker_timed_out")
        finally:
            if proc and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)
            kernel.CloseHandle(job)
            executor.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    try:
        print(json.dumps(run(json.load(sys.stdin)), ensure_ascii=False))
    except Pressure:
        sys.exit(75)
    except Exception as err:
        print(type(err).__name__, file=sys.stderr)
        sys.exit(1)
