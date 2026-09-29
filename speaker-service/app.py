"""Private Cloud Run speaker embedding endpoint for Panthorium staging.

Cloud Run IAM authenticates the caller. Audio is decoded in memory, never
written to disk, and no raw recording is retained by this service.
"""

import base64
import binascii
import json
import math
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 1_500_000
MAX_AUDIO = 1_000_000
MAX_SAMPLES = 16_000 * 18
MIN_SAMPLES = 16_000


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
        result = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", "pipe:0", "-ac", "1",
             "-ar", "16000", "-f", "f32le", "pipe:1"],
            input=raw, capture_output=True, timeout=12, check=True,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise ValueError("audio_decode_failed") from exc
    import numpy as np

    samples = np.frombuffer(result.stdout, dtype="<f4")
    if len(samples) < MIN_SAMPLES or len(samples) > MAX_SAMPLES:
        raise ValueError("invalid_audio_duration")
    if not np.all(np.isfinite(samples)) or float(np.sqrt(np.mean(samples ** 2))) < 0.003:
        raise ValueError("voice_signal_missing")
    return samples.copy()


class SpeakerEncoder:
    def __init__(self):
        import torch
        from speechbrain.inference.classifiers import EncoderClassifier

        torch.set_num_threads(2)
        self.torch = torch
        self.model = EncoderClassifier.from_hparams(
            source=os.environ.get("SPEAKER_MODEL_PATH", "/app/model"),
            savedir="/tmp/speaker-model",
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


def handler_class(encoder):
    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, payload):
            body = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/healthz":
                self.respond(200, {"ok": True})
            else:
                self.respond(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/embed":
                return self.respond(404, {"error": "not_found"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size <= 0 or size > MAX_BODY:
                    return self.respond(413, {"error": "audio_too_large"})
                data = json.loads(self.rfile.read(size))
                samples = decode_audio(data.get("audio"))
                self.respond(200, {"signalPresent": True, "embedding": encoder.encode(samples)})
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                self.respond(400, {"error": str(exc)[:80]})
            except Exception:
                self.respond(503, {"error": "embedding_unavailable"})

    return Handler


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), handler_class(SpeakerEncoder())).serve_forever()
