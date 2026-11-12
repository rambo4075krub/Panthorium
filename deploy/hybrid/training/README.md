# Qwen3.5-4B weight training

This bundle runs real supervised BF16 LoRA training on the pinned Qwen3.5-4B base.
It is separate from Sentinel's retrieval/examples learning. It trains text answers
and freezes vision layers. It does not claim to train speech, image generation or
new vision skills. Those require separate data/models. Text tuning can still
change reasoning and vision answers; evaluate all capabilities before deployment.

The notebook's 4 GiB GPU is too small. Use a dedicated Linux CUDA runner with
at least 10 GiB **free** VRAM (16 GiB total recommended), BF16 support and 35 GiB
free disk. The runner checks before downloading the model. No cloud GPU is
provisioned, no dataset is uploaded and no paid API is invoked by Panthorium.

1. Export at least 20 approved examples in Training Lab → ฝึกโมเดล Qwen 4B.
   Private examples need explicit global publication consent and anonymization;
   quality approval alone is insufficient. Synthetic acceptance fixtures and
   conflicting answers are excluded. Review both JSONL files before transferring.
2. Extract the bundle on your chosen runner. Use a fresh virtual environment:

   ```sh
   python -m venv .venv
   . .venv/bin/activate
   python train_qwen4.py --preflight
   python -m pip install -r requirements-training.txt
   python train_qwen4.py --steps 50 --output qwen4-candidate --export-gguf
   ```

3. `status.json` records checksums, software versions, baseline and held-out loss.
   An adapter and optional Q4_K_M GGUF are candidates only. Failed/regressed runs
   never replace production. Do not infer answer quality from training loss alone.
4. Review Thai answers, reasoning, tool calls, image/video frames and existing
   safety/permission tests against the base model. Measure latency and memory on
   the target notebook. Keep the matching projector. Promoting a candidate requires
   a separately reviewed profile with exact file hashes and the normal release
   and host verification process; there is no automatic production promotion.

Recommended recipe source:
https://unsloth.ai/docs/models/qwen3.5/fine-tune

Reasoning data and a representative held-out benchmark matter. A small set of
direct answers is not enough evidence to retain reasoning quality. This runner
does not synthesize reasoning traces or silently train on users' conversations.
