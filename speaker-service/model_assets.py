"""Fetch and verify the reviewed speaker snapshot without loading model code."""

import hashlib
import json
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

LOCK_PATH = Path(__file__).with_name("model-lock.json")
MODEL_FILES = {
    "hyperparams.yaml", "embedding_model.ckpt", "mean_var_norm_emb.ckpt",
    "classifier.ckpt", "label_encoder.txt",
}


def read_lock(path=LOCK_PATH):
    lock = json.loads(Path(path).read_text())
    if (lock.get("repository") != "speechbrain/spkrec-ecapa-voxceleb"
            or not re.fullmatch(r"[0-9a-f]{40}", lock.get("revision", ""))
            or set(lock.get("files", {})) != MODEL_FILES):
        raise ValueError("invalid_model_lock")
    for item in lock["files"].values():
        if (not re.fullmatch(r"[0-9a-f]{64}", item.get("sha256", ""))
                or type(item.get("size")) is not int
                or not 0 < item["size"] <= 128_000_000):
            raise ValueError("invalid_model_lock")
    return lock


def verify_file(path, expected):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size != expected["size"]:
        raise ValueError("model_file_integrity_failed")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected["sha256"]:
        raise ValueError("model_file_integrity_failed")


def verify_model(directory, lock_path=LOCK_PATH):
    directory = Path(directory)
    lock = read_lock(lock_path)
    for filename, expected in lock["files"].items():
        verify_file(directory / filename, expected)


def download_model(directory, lock_path=LOCK_PATH, opener=urllib.request.urlopen):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    lock = read_lock(lock_path)
    for filename, expected in lock["files"].items():
        url = (f"https://huggingface.co/{lock['repository']}/resolve/"
               f"{lock['revision']}/{filename}")
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, delete=False) as target:
                temp_path = Path(target.name)
                count = 0
                with opener(url, timeout=60) as source:
                    while chunk := source.read(1024 * 1024):
                        count += len(chunk)
                        if count > expected["size"]:
                            raise ValueError("model_file_integrity_failed")
                        target.write(chunk)
            verify_file(temp_path, expected)
            # Readable by the unprivileged runtime; only the image builder writes.
            temp_path.chmod(0o644)
            temp_path.replace(directory / filename)
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
    verify_model(directory, lock_path)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "download":
        raise SystemExit("usage: model_assets.py download DIRECTORY")
    download_model(sys.argv[2])
