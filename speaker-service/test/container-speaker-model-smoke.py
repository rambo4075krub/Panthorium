"""Run the exact installed encoder offline on synthetic, non-biometric PCM.

Run only in the full runtime image, as its ordinary unprivileged user, with
Docker --network none and an outer wall-clock/memory/CPU limit. This validates
model/runtime compatibility; it does not measure speaker recognition accuracy.
"""

import json
import math
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Establish the same irreversible restriction as the application launcher
# before importing the application, model loader, NumPy, Torch or SpeechBrain.
from runtime_guard import harden_process

security = harden_process()
assert security["NoNewPrivs"] == 1
assert sys.argv[1:] == [], "This smoke does not accept alternate model inputs"
assert os.environ.get("HF_HUB_OFFLINE") == "1", "Model downloads must be disabled"
assert os.environ.get("TORCH_FORCE_WEIGHTS_ONLY_LOAD") == "1", "Safe checkpoint loading must be enabled"
assert {entry.name for entry in Path("/sys/class/net").iterdir()} == {"lo"}, "Run with --network none"

network_attempts = []


def reject_network(event, _args):
    # Record attempts even if a dependency catches the resulting exception.
    # The container network namespace is the independent enforcement boundary.
    if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto"}:
        network_attempts.append(event)
        raise RuntimeError("model_smoke_network_attempt")


sys.addaudithook(reject_network)

from model_assets import read_lock, verify_model

model_directory = ROOT / "model"
assert not model_directory.is_symlink(), "Model directory must be part of the image"
assert model_directory.is_dir(), "Full runtime model is missing"
assert Path(os.environ.get("SPEAKER_MODEL_PATH", "")).resolve() == model_directory
lock = read_lock()
assert {entry.name for entry in model_directory.iterdir()} == set(lock["files"]), "Unexpected model files"
verify_model(model_directory)

import numpy as np
from app import SpeakerEncoder

# Two seconds of deterministic tones exercise feature extraction and inference
# without using a person's recording or representing any person's identity.
time_axis = np.arange(32_000, dtype=np.float32) / 16_000
pcm = (0.12 * np.sin(2 * np.pi * 220 * time_axis)
       + 0.06 * np.sin(2 * np.pi * 437 * time_axis)).astype(np.float32)
assert pcm.shape == (32_000,) and np.isfinite(pcm).all()

encoder = SpeakerEncoder()
assert encoder.torch.version.cuda is None, "Expected the CPU Torch build"
embedding = np.asarray(encoder.encode(pcm), dtype=np.float64)
# The hash-verified hyperparams.yaml declares lin_neurons: 192.
assert embedding.shape == (192,), f"Unexpected embedding shape: {embedding.shape}"
assert np.isfinite(embedding).all(), "Embedding contains non-finite values"
norm = float(np.linalg.norm(embedding))
assert math.isfinite(norm) and norm > 1e-8, "Embedding must have a finite nonzero norm"
assert not network_attempts, f"Model attempted network operations: {network_attempts}"

print(json.dumps({
    "status": "PASS",
    "modelRevision": lock["revision"],
    "verifiedFiles": len(lock["files"]),
    "syntheticSamples": int(pcm.size),
    "sampleRate": 16_000,
    "embeddingDimensions": int(embedding.size),
    "embeddingNorm": norm,
    "networkAttempts": len(network_attempts),
    "NoNewPrivs": security["NoNewPrivs"],
}, sort_keys=True))
