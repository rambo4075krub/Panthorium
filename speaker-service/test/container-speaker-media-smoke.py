"""Offline real decoder checks; imports no model and makes no inference request."""
import base64
import email.parser
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
HOST = "--allow-host-ffmpeg" in sys.argv
NOBLE = sys.argv[1:] == ["--candidate-noble"]
assert sys.argv[1:] in ([], ["--allow-host-ffmpeg"], ["--candidate-noble"])
assert not (HOST and os.environ.get("CI")), "Host mode is forbidden in CI"
if NOBLE:
    release = Path("/etc/os-release").read_text()
    assert re.search(r"^ID=ubuntu$", release, re.M)
    assert re.search(r'^VERSION_ID="24\.04"$', release, re.M)
    assert sys.version_info[:2] == (3, 12)
if not HOST:
    from runtime_guard import harden_process
    assert harden_process()["NoNewPrivs"] == 1
    child_status = subprocess.check_output([sys.executable, "-c", "from pathlib import Path;print(Path('/proc/self/status').read_text())"], text=True)
    assert re.search(r"^NoNewPrivs:\s+1$", child_status, re.M)
from app import decode_audio
FIXTURES = Path(__file__).parent / "fixtures/container-audio"


def command(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=30, check=True)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


if not HOST:
    assert os.getuid() != 0, "Container must run as the nonroot speaker user"
    lock = json.loads((ROOT / "build/media/ffmpeg-speaker-source.lock.json").read_text())
    manifest = json.loads(Path("/usr/local/share/panthorium/ffmpeg-source.json").read_text())
    for key in ("schemaVersion", "name", "version", "license", "source", "patches", "configure", "purl", "cpe"):
        assert manifest[key] == lock[key], f"Provenance mismatch: {key}"
    for name in ("ffmpeg", "ffprobe"):
        binary = Path(manifest["binaries"][name]["path"])
        assert binary.read_bytes().startswith(b"\x7fELF")
        assert sha256(binary) == manifest["binaries"][name]["sha256"]
        version = command([str(binary), "-version"]).stdout
        assert re.search(r"version 9\.0\.2(?:\s|$)", version), version
        linked = command((["/lib64/ld-linux-x86-64.so.2", "--list"] if NOBLE else ["ldd"]) + [str(binary)]).stdout
        assert not re.search(r"not found|libcjson|librist|libasound|libpulse|libSDL|libvulkan|libcuda|libxml|libtiff|libsndfile", linked, re.I), linked
        # Static FFmpeg internals, only glibc's libc/libm and loader are needed.
        libraries = re.findall(r"^\s*([^ /\s]+)\s+=>", linked, re.M)
        assert set(libraries) <= {"libc.so.6", "libm.so.6"}, linked
        print(version.splitlines()[0], linked.strip(), sep="\n")
    config = command(["ffmpeg", "-buildconf"])
    config_flags = []
    for line in (config.stdout + config.stderr).splitlines():
        if line.strip().startswith("--"):
            parsed = shlex.split(line.strip())
            assert len(parsed) == 1, line
            config_flags.extend(parsed)
    for flag in lock["configure"]:
        assert flag in config_flags, f"Missing configure flag: {flag}"
    package_records = [email.parser.Parser().parsestr(part) for part in Path("/var/lib/dpkg/status").read_text().strip().split("\n\n")]
    # Chisel retains upstream control records, which do not contain dpkg's
    # installed-state field. Their package/file membership is independently
    # verified against the unmodified Chisel manifest in the candidate job.
    package_versions = {item["Package"]: item["Version"] for item in package_records
                        if item["Status"] == "install ok installed" or (NOBLE and item["Status"] is None)}
    packages = set(package_versions)
    assert "libsndfile1" in packages, "Required SoundFile native dependency must be inventoried"
    forbidden = {"ffmpeg", "libcjson1", "librist4", "libxml2", "libtiff6", "libx11-6", "libxi6", "libxrender1", "libasound2t64", "libpulse0"}
    assert not packages & forbidden, f"Unnecessary native packages: {packages & forbidden}"
    assert not any(re.match(r"lib(?:avcodec|avdevice|avfilter|avformat|avutil|swresample|swscale|postproc)\d", name) for name in packages)
    import soundfile
    assert importlib.metadata.version("soundfile") == "0.13.1"
    assert not any(path.name.endswith(".so") for path in (Path(soundfile.__file__).parent / "_soundfile_data").glob("*")), "Unexpected bundled libsndfile"
    assert not any(str(path).endswith(".so") for path in importlib.metadata.files("soundfile")), "SoundFile must use its pure-Python wheel"
    import io
    import numpy as np
    import zlib
    for name in (("libsndfile",) if NOBLE else ("libsndfile", "zlib")):
        native_lock = json.loads((ROOT / f"build/{name}/source.lock.json").read_text())
        native_manifest = json.loads(Path(f"/usr/local/share/panthorium/{name}-source.json").read_text())
        for key, value in native_lock.items():
            assert native_manifest[key] == value, f"{name} source lock mismatch: {key}"
        library = Path(native_manifest["library"]["path"])
        assert library.read_bytes().startswith(b"\x7fELF")
        assert sha256(library) == native_manifest["library"]["sha256"]
        version = package_versions[native_lock["debianPackageName"]]
        assert version == native_lock["debianPackageVersion"], (name, version)
        assert str(library) in Path("/proc/self/maps").read_text(), f"{name} actual import did not load reviewed library"
    if NOBLE:
        assert re.fullmatch(r"1:1\.3\.dfsg-3\.1ubuntu2\.(?:[3-9]|[1-9][0-9]+)", package_versions["zlib1g"])
        assert "/usr/lib/x86_64-linux-gnu/libz.so.1.3" in Path("/proc/self/maps").read_text()
        assert not packages & {"apt", "dpkg", "bash", "dash", "perl-base", "util-linux", "libacl1"}
    pcm = np.array([0.0, 0.25, -0.5, 0.75], dtype=np.float64)
    for container in ("WAV", "MAT4"):
        buffer = io.BytesIO()
        soundfile.write(buffer, pcm, 16000, format=container, subtype="DOUBLE")
        buffer.seek(0)
        decoded, rate = soundfile.read(buffer, dtype="float64")
        assert rate == 16000 and np.array_equal(decoded, pcm), container
    payload = b"Panthorium standard zlib roundtrip" * 100
    assert zlib.decompress(zlib.compress(payload)) == payload
    print(f"Source-patched libsndfile {soundfile.__libsndfile_version__} and zlib {zlib.ZLIB_RUNTIME_VERSION}: actual ELF hashes, package versions and standard roundtrips verified")
    assert importlib.metadata.version("setuptools") == "84.2.1"
    import torch
    import torchaudio
    from speechbrain.inference.classifiers import EncoderClassifier
    assert torch.__version__.split("+")[0] == "2.14.1"
    assert torchaudio.__version__.split("+")[0] == "2.11.0"
    assert torch.version.cuda is None
else:
    print("DEVELOPMENT ONLY: host native decoder matrix; container provenance/dependency checks skipped")

protocols = command(["ffmpeg", "-hide_banner", "-protocols"]).stdout
names = [line.strip() for line in protocols.splitlines() if re.fullmatch(r"\s*[a-z0-9_]+\s*", line)]
assert names and set(names) == {"pipe"}, protocols
for source in ("http://127.0.0.1:9/never", str(FIXTURES / "audio.mp3")):
    result = subprocess.run(["ffmpeg", "-v", "error", "-i", source, "-f", "f32le", "pipe:1"], capture_output=True, timeout=3)
    assert result.returncode != 0
    assert re.search(rb"Protocol not found|not on whitelist", result.stderr, re.I), result.stderr

fixture_manifest = json.loads((FIXTURES / "manifest.json").read_text())
passed = 0
for name, expected in fixture_manifest["files"].items():
    path = FIXTURES / name
    assert path.stat().st_size == expected["bytes"] and sha256(path) == expected["sha256"], name
    audio = "data:audio/x;base64," + base64.b64encode(path.read_bytes()).decode()
    if name == "overlong.opus.ogg":
        try:
            decode_audio(audio)
        except ValueError as error:
            assert str(error) == "invalid_audio_duration", str(error)
        else:
            raise AssertionError("Overlong audio was accepted")
        print("Rejected overlong recording after bounded decode")
        continue
    samples = decode_audio(audio)
    assert 28_800 <= len(samples) <= 36_800, (name, len(samples))
    print(f"Decoded {name}: {len(samples)} finite mono samples at 16 kHz")
    passed += 1
assert passed == 9
print(f"PASS: {passed} real audio formats, duration bound, pipe-only protocols; " + ("host preflight only" if HOST else "actual container provenance, ELF dependencies and CPU imports"))
