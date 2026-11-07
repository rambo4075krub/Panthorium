# Qwen3-8B candidate — not activated

This candidate is Qwen3-8B Q4_K_M from the model publisher, pinned to a revision,
size and SHA-256. Its weights are 5.03 decimal GB (4.68 GiB). This is a larger
text/reasoning/tool model, not a newer generation than the installed Qwen3.5-4B,
and is not assumed to outperform it on every task. It does not accept images;
voice still needs separate ASR/TTS. A Qwen3-VL-8B variant would be a separate
candidate if image input is required.

Observed notebook on 2026-11-07: Ryzen 9 5900HX, 15.41 GiB usable RAM, RTX 3050 Ti
4 GiB. RAM used was 11.41 GiB (74%), already above the 10.01 GiB total-RAM target.
Restricting access to administrators/owner reduces demand, not model size.

`prepare_qwen8b.py --download` downloads only to `models/candidates`, verifies
the publisher checksum, and performs a resource preflight. Exit 2 after a
successful download means the resource check blocked loading. It does not
change production or edit the 4B files. `--benchmark` can start a separate
loopback-only port 18089 only after the memory checks pass, runs ten synthetic
Thai prompts, and stops its own process afterward. Resource monitoring aborts
the isolated run at the existing 65% RAM/60% VRAM targets. These are monitored
limits, not OS-enforced hard caps. The 6.5 GiB cold-load allowance is conservative
planning, not a measured requirement. GPU offload is deliberately limited.

Before any production switch:

1. Deploy and test the administrator/owner-only policy from PR #313 (or its
   successor). Never infer authorization from a client-supplied email.
2. Obtain enough free memory while keeping the existing resource limits.
3. Run and review the ten answers, latency, truncation and peak resources;
   separately validate actual API/MCP calls, user isolation and buffered voice.
4. Update the broker's model process identity and its model-specific forecast,
   startup arguments, provider sampling, and rollback together. Keep the public
   model alias stable. The current broker identifies the 4B path explicitly.
5. Follow GitHub → main → verified production deployment. This candidate tooling
   does not perform that activation and is not a production-ready upgrade.

No API per-call charge is introduced by downloading these Apache-2.0 weights.
Local hardware/electricity and separate external services remain independent.
