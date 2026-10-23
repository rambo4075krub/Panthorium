FROM node:24.22.1-trixie-slim AS media-build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config nasm patch ca-certificates && rm -rf /var/lib/apt/lists/*
COPY build/media/ /build/media/
RUN node /build/media/build-ffmpeg.mjs ffmpeg-speaker-source.lock.json

FROM node:24.22.1-trixie-slim AS sndfile-build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake patch python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY build/libsndfile/ /build/libsndfile/
RUN node /build/libsndfile/build.mjs

FROM node:24.22.1-trixie-slim AS zlib-build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential binutils patch dpkg-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY build/zlib/ /build/zlib/
RUN node /build/zlib/build.mjs

FROM python:3.11-slim-trixie AS runtime-dependencies
# Keep required CPU numerical runtime libraries without the distro's full media stack.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=sndfile-build /opt/libsndfile/libsndfile1-panthorium.deb /tmp/libsndfile1-panthorium.deb
COPY --from=zlib-build /opt/zlib/zlib1g-panthorium.deb /tmp/zlib1g-panthorium.deb
# Replace the distro packages while retaining honest package/source inventory.
RUN dpkg -i /tmp/libsndfile1-panthorium.deb /tmp/zlib1g-panthorium.deb && ldconfig && rm /tmp/*-panthorium.deb
COPY --from=media-build /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe /usr/local/bin/
COPY --from=media-build /opt/ffmpeg/share/panthorium/ /usr/local/share/panthorium/
RUN pip install --no-cache-dir setuptools==84.2.1
RUN pip install --no-cache-dir torch==2.14.1 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cpu
# The official pure-Python SoundFile wheel uses the inventoried, source-patched libsndfile1.
# Avoid a second bundled native library invisible to the distro security feed.
RUN pip install --no-cache-dir https://files.pythonhosted.org/packages/64/28/e2a36573ccbcf3d57c00626a21fe51989380636e821b341d36ccca0c1c3a/soundfile-0.13.1-py2.py3-none-any.whl#sha256=a23c717560da2cf4c7b5ae1142514e0fd82d6bbd9dfc93a50423447142f2c445
RUN pip install --no-cache-dir speechbrain==1.1.2 numpy==1.26.4 requests==2.34.2 huggingface_hub==0.36.2 && pip check
# TorchAudio 2.11 uses the stable Torch ABI (2.11+); validate actual CPU imports.
# This does not load a model or make an inference request.
RUN HF_HUB_OFFLINE=1 python -c "import torch, torchaudio; from speechbrain.inference.classifiers import EncoderClassifier; assert torch.__version__.split('+')[0] == '2.14.1'; assert torchaudio.__version__.split('+')[0] == '2.11.0'; assert torch.version.cuda is None"
WORKDIR /app
COPY speaker-service/app.py speaker-service/model_assets.py speaker-service/decode_worker.py speaker-service/runtime_guard.py speaker-service/harden_runtime.py /app/
COPY speaker-service/test/container-speaker-media-smoke.py speaker-service/test/container-speaker-model-smoke.py /app/test/
COPY speaker-service/test/fixtures/container-audio/ /app/test/fixtures/container-audio/
COPY build/media/ffmpeg-speaker-source.lock.json /app/build/media/
COPY build/libsndfile/source.lock.json /app/build/libsndfile/
COPY build/zlib/source.lock.json /app/build/zlib/
RUN groupadd --system --gid 10001 speaker && useradd --system --uid 10001 --gid 10001 --create-home speaker && python /app/harden_runtime.py --apply-image-root
USER 10001:10001
CMD ["python", "runtime_guard.py"]

FROM runtime-dependencies AS runtime
USER root
COPY speaker-service/model-lock.json /app/
# Download immutable, hash-verified bytes only. Never execute a model at build time.
RUN python /app/model_assets.py download /app/model && python /app/harden_runtime.py --verify-image-root
ENV SPEAKER_MODEL_PATH=/app/model PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TORCH_FORCE_WEIGHTS_ONLY_LOAD=1
USER 10001:10001
CMD ["python", "runtime_guard.py"]
