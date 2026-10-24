"""Private Cloud Run speaker embedding endpoint for Panthorium staging.

Cloud Run IAM authenticates the caller. Audio is decoded in memory, never
written to disk, and no raw recording is retained by this service.
"""

import base64
import binascii
import json
import math
import os
import selectors
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from model_assets import verify_model

MAX_BODY = 1_500_000
MAX_AUDIO = 1_000_000
MAX_SAMPLES = 16_000 * 18
MIN_SAMPLES = 16_000
MAX_DECODER_STDERR = 64 * 1024
READ_TIMEOUT = 10


def bounded_process(command, raw, timeout=12, stdout_limit=(MAX_SAMPLES + 1) * 4,
                    stderr_limit=MAX_DECODER_STDERR):
    """Drain all pipes concurrently, with hard byte caps and a wall-clock deadline."""
    deadline = time.monotonic() + timeout
    output = bytearray()
    errors = 0
    offset = 0
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, bufsize=0, start_new_session=True,
                          env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C",
                               "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1"}) as child:
        try:
            with selectors.DefaultSelector() as selector:
                for stream, event in ((child.stdin, selectors.EVENT_WRITE),
                                      (child.stdout, selectors.EVENT_READ),
                                      (child.stderr, selectors.EVENT_READ)):
                    os.set_blocking(stream.fileno(), False)
                    selector.register(stream, event)
                while selector.get_map():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ValueError("audio_decode_failed")
                    for key, _ in selector.select(remaining):
                        stream = key.fileobj
                        if stream is child.stdin:
                            try:
                                offset += os.write(stream.fileno(), raw[offset:offset + 65536])
                            except BrokenPipeError:
                                offset = len(raw)
                            if offset == len(raw):
                                selector.unregister(stream)
                                stream.close()
                            continue
                        chunk = os.read(stream.fileno(), 65536)
                        if not chunk:
                            selector.unregister(stream)
                            stream.close()
                        elif stream is child.stdout:
                            if len(output) + len(chunk) > stdout_limit:
                                raise ValueError("audio_decode_failed")
                            output.extend(chunk)
                        else:
                            errors += len(chunk)
                            if errors > stderr_limit:
                                raise ValueError("audio_decode_failed")
                if child.wait(timeout=max(0.001, deadline - time.monotonic())) != 0:
                    raise ValueError("audio_decode_failed")
        finally:
            # Terminate descendants too if native code misbehaves or a decoder
            # leaves pipe-owning children behind. No preexec_fn in this server.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
    return bytes(output)


class BoundedHTTPServer(ThreadingHTTPServer):
    """Bound application workers independently of the reverse proxy's lifetime."""
    daemon_threads = True

    def __init__(self, address, handler, max_requests=2):
        self.request_slots = threading.BoundedSemaphore(max_requests)
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        if not self.request_slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nConnection: close\r\n"
                                b"Retry-After: 1\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()


def trim_edge_silence(samples):
    """Trim quiet edges before embedding, while preserving brief speech onsets and tails."""
    import numpy as np

    frame_size = 320  # 20 ms at 16 kHz
    frame_count = len(samples) // frame_size
    if frame_count == 0:
        return samples
    frames = samples[:frame_count * frame_size].reshape(frame_count, frame_size)
    frame_rms = np.sqrt(np.mean(frames * frames, axis=1))
    peak_rms = float(np.percentile(frame_rms, 95))
    threshold = max(0.002, peak_rms * 0.06)
    active = np.flatnonzero(frame_rms >= threshold)
    if active.size == 0:
        return samples

    padding = 2_400  # Preserve 150 ms around speech for natural consonant edges.
    start = max(0, int(active[0]) * frame_size - padding)
    end = min(len(samples), (int(active[-1]) + 1) * frame_size + padding)
    trimmed = samples[start:end].copy()
    if len(trimmed) < MIN_SAMPLES:
        raise ValueError("voice_signal_too_short")
    return trimmed


def decode_audio(data_url):
    if not isinstance(data_url, str) or not data_url.startswith("data:audio/"):
        raise ValueError("invalid_audio")
    try:
        header, encoded = data_url.split(",", 1)
        if ";base64" not in header or len(encoded) > MAX_BODY:
            raise ValueError("invalid_audio")
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("invalid_audio") from exc
    if len(raw) < 1000 or len(raw) > MAX_AUDIO:
        raise ValueError("invalid_audio_size")
    try:
        decoded = bounded_process(
            [sys.executable, str(Path(__file__).with_name("decode_worker.py")),
             "-nostdin", "-v", "error", "-xerror", "-max_alloc", "67108864",
             "-threads", "1", "-filter_threads", "1",
             "-protocol_whitelist", "pipe", "-i", "pipe:0", "-map", "0:a:0",
             "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000",
             # Bound decoded bytes before capture, while retaining one extra
             # sample so overlong recordings are rejected rather than truncated.
             "-t", str((MAX_SAMPLES + 1) / 16000), "-f", "f32le", "pipe:1"],
            raw,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise ValueError("audio_decode_failed") from exc
    import numpy as np

    samples = np.frombuffer(decoded, dtype="<f4")
    if len(samples) < MIN_SAMPLES:
        raise ValueError("voice_signal_too_short")
    if len(samples) > MAX_SAMPLES:
        raise ValueError("invalid_audio_duration")
    if not np.all(np.isfinite(samples)):
        raise ValueError("voice_signal_missing")
    samples = trim_edge_silence(samples)
    if float(np.sqrt(np.mean(samples ** 2))) < 0.003:
        raise ValueError("voice_signal_missing")
    return samples


class SpeakerEncoder:
    def __init__(self):
        # Reject changed checkpoints/YAML before SpeechBrain can deserialize them.
        # The pinned YAML only references installed SpeechBrain classes; all its
        # checkpoint paths are overridden to the verified local model directory.
        model_dir = Path(os.environ.get("SPEAKER_MODEL_PATH", "/app/model")).resolve()
        verify_model(model_dir)
        import torch
        from speechbrain.inference.classifiers import EncoderClassifier

        torch.set_num_threads(2)
        self.torch = torch
        self.model = EncoderClassifier.from_hparams(
            source=str(model_dir),
            savedir="/tmp/speaker-model",
            overrides={"pretrained_path": str(model_dir)},
            run_opts={"device": "cpu"},
        )

    def encode(self, samples):
        with self.torch.inference_mode():
            waveform = self.torch.from_numpy(samples).unsqueeze(0)
            vector = self.model.encode_batch(waveform).reshape(-1)
            values = vector.tolist()
        if len(values) < 16 or not all(math.isfinite(x) for x in values):
            raise RuntimeError("invalid_voice_embedding")
        return values


def handler_class(encoder, read_timeout=READ_TIMEOUT):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(read_timeout)
            # A socket inactivity timeout alone permits an endless slow trickle.
            self.read_deadline = threading.Timer(read_timeout, self.abort_read)
            self.read_deadline.daemon = True
            self.read_deadline.start()

        def abort_read(self):
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

        def finish(self):
            self.read_deadline.cancel()
            super().finish()

        def respond(self, status, payload):
            body = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.close_connection = True
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                self.respond(200, {"ok": True, "modelReady": encoder is not None})
            else:
                self.respond(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/embed":
                return self.respond(404, {"error": "not_found"})
            try:
                lengths = self.headers.get_all("Content-Length", [])
                if (self.headers.get_all("Transfer-Encoding") or len(lengths) != 1
                        or not lengths[0].isascii() or not lengths[0].isdigit()):
                    return self.respond(400, {"error": "invalid_request_framing"})
                if self.headers.get_content_type() != "application/json":
                    return self.respond(415, {"error": "json_required"})
                size = int(lengths[0])
                if size <= 0 or size > MAX_BODY:
                    return self.respond(413, {"error": "audio_too_large"})
                body = self.rfile.read(size)
                self.read_deadline.cancel()
                if len(body) != size:
                    return self.respond(400, {"error": "incomplete_request"})
                data = json.loads(body)
                if not isinstance(data, dict):
                    return self.respond(400, {"error": "invalid_request"})
                samples = decode_audio(data.get("audio"))
                self.respond(200, {
                    "signalPresent": True,
                    "speechDurationSeconds": round(len(samples) / 16000, 3),
                    "embedding": encoder.encode(samples),
                })
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                allowed = {"invalid_audio", "invalid_audio_size", "audio_decode_failed",
                           "voice_signal_too_short", "invalid_audio_duration", "voice_signal_missing"}
                self.respond(400, {"error": str(exc) if str(exc) in allowed else "invalid_request"})
            except (OSError, TimeoutError):
                self.close_connection = True
            except Exception:
                self.respond(503, {"error": "embedding_unavailable"})

    return Handler


if __name__ == "__main__":
    BoundedHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), handler_class(SpeakerEncoder())).serve_forever()
