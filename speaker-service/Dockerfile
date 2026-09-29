FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir speechbrain==1.0.3 numpy==1.26.4 soundfile==0.13.1
WORKDIR /app
# Pin the model snapshot in a release before production promotion.
RUN python -c "from speechbrain.inference.classifiers import EncoderClassifier; EncoderClassifier.from_hparams(source='speechbrain/spkrec-ecapa-voxceleb', savedir='/app/model')"
COPY app.py /app/app.py
ENV SPEAKER_MODEL_PATH=/app/model PYTHONUNBUFFERED=1
CMD ["python", "app.py"]
