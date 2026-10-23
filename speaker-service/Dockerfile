FROM python:3.11-slim AS runtime-dependencies
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.14.1 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir speechbrain==1.1.2 numpy==1.26.4 soundfile==0.13.1 requests==2.34.2 huggingface_hub==0.36.2 && pip check
# TorchAudio 2.11 uses the stable Torch ABI (2.11+); validate actual CPU imports.
# This does not load a model or make an inference request.
RUN HF_HUB_OFFLINE=1 python -c "import torch, torchaudio; from speechbrain.inference.classifiers import EncoderClassifier; assert torch.__version__.split('+')[0] == '2.14.1'; assert torchaudio.__version__.split('+')[0] == '2.11.0'; assert torch.version.cuda is None"
FROM runtime-dependencies AS runtime
WORKDIR /app
COPY model-lock.json model_assets.py /app/
# Download immutable, hash-verified bytes only. Never execute a model at build time.
RUN python /app/model_assets.py download /app/model
COPY app.py /app/app.py
RUN useradd --system --uid 10001 --create-home speaker
ENV SPEAKER_MODEL_PATH=/app/model PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TORCH_FORCE_WEIGHTS_ONLY_LOAD=1
USER speaker
CMD ["python", "app.py"]
