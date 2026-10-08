# Sentinel Autonomous Learning Loop

## Mission

ยกระดับ Training Lab จาก automatic RAG approval pipeline เป็นวงจรเรียนรู้แบบต่อเนื่องที่วัดผลได้ ย้อนกลับได้ และ fail-safe โดยไม่แก้น้ำหนักของโมเดลภายนอกโดยตรง

## Core loop

CAPTURE -> SANITIZE -> DEDUPLICATE -> QUARANTINE -> MULTI-EVALUATE -> SCORE -> RISK GATE -> SHADOW -> PROMOTE -> MONITOR -> DRIFT DETECT -> QUARANTINE/ROLLBACK -> RE-EVALUATE

## Design principles

1. Evidence before autonomy — ความรู้ใหม่ต้องมี provenance, evaluator evidence และ benchmark result ก่อน promotion
2. Fail closed — evaluator ไม่ครบ, provider ล้มเหลว, provenance ไม่ชัด หรือ safety ไม่ผ่าน = ห้าม promote
3. Reversible learning — ทุก promotion มี immutable version และ previous-good pointer สำหรับ rollback
4. Risk-tiered autonomy — low-risk knowledge อนุมัติอัตโนมัติได้เมื่อผ่านทุก gate; security/permissions/secrets/production policy และ high-impact actions ห้ามถูกเปลี่ยนโดย learning loop
5. Continuous evaluation — ประเมินทั้งก่อนและหลัง promotion และตรวจ drift จาก production samples
6. Independent evaluation — evaluator ต้องแยกจาก generator เท่าที่ provider ที่พร้อมใช้งานอนุญาต และเก็บ per-evaluator verdict
7. No self-granted privilege — Sentinel ไม่มีสิทธิ์เพิ่ม role/permission, ลด guardrail, เปลี่ยน secret, integration allowlist หรือ approval policy ให้ตัวเอง
8. Full auditability — capture, score, decision, promotion, rollback และ override ต้องมี audit event และ correlation id

## Learning states

- captured
- sanitized
- quarantined
- evaluating
- scored
- shadow
- approved
- active
- degraded
- rolled_back
- rejected

State transitions ต้องเป็น server-side policy เท่านั้น UI ไม่มีสิทธิ์ promote โดยข้าม gate

## Evaluation dimensions

คะแนน 0-100 ประกอบด้วย:

- correctness 30%
- groundedness/provenance 20%
- relevance 15%
- clarity 10%
- safety 20%
- novelty/non-duplication 5%

Hard gates:

- safety ต้องผ่าน evaluator ทุกตัว
- provenance ต้องมี source type + source id/fingerprint
- PII/secret scanner ต้องผ่าน
- prompt-injection/poisoning detector ต้องผ่าน
- benchmark regression ต้องไม่ต่ำกว่า baseline tolerance

Default promotion threshold: 90/100 สำหรับ autonomous promotion. ช่วง 85-89 อยู่ quarantine/re-evaluation. ต่ำกว่า 85 reject.

## Shadow evaluation

ก่อน active ให้ candidate อยู่ shadow state และ replay กับ benchmark + sampled production prompts โดยไม่ให้ candidate เปลี่ยนคำตอบ production. เปรียบเทียบ candidate กับ current-good knowledge version ตาม correctness, safety, groundedness, latency และ cost.

Promotion ต้องผ่าน minimum sample size และไม่มี critical regression.

## Production monitoring

หลัง promotion เก็บ outcome metrics แบบ privacy-preserving:

- retrieval hit/use rate
- answer evaluation score
- correction/retry rate
- refusal anomaly
- user negative feedback เมื่อมี
- safety intervention
- latency/cost delta

ถ้าคะแนน rolling window ต่ำกว่า baseline หรือมี critical safety event ให้ quarantine candidate และ rollback ไป previous-good version อัตโนมัติ

## Rollback

ทุก active knowledge item/version ต้องมี:

- version id
- parent/previous-good version
- promoted_at
- promotion evidence
- rollback reason
- rollback_at

Rollback ต้อง idempotent และไม่ลบหลักฐานเดิม

## Protected domains

Autonomous learning loop ห้าม promote เนื้อหาที่เปลี่ยน:

- authentication/RBAC/administrator permissions
- security policy/guardrails/risk thresholds
- secrets/API keys/passwords/tokens
- integration host allowlists
- production deployment configuration
- destructive/financial/legal authorization policy

รายการเหล่านี้ต้องใช้ explicit administrator-controlled change workflow แยกจาก Training Lab

## Research-aligned runtime controls

- Vertex-only deployments use `SENTINEL_VERTEX_EVALUATOR_MODELS` for two or three separate Google publisher models and `SENTINEL_VERTEX_EVALUATOR_LOCATION` for their endpoint location. Evaluator location is separate from the tuned Sentinel endpoint and must be explicitly chosen when the provider region does not support every configured model. Staging defaults to the `eu` multi-region endpoint with `gemini-3.5-flash,gemini-3.1-flash-lite`; production has no evaluator model or location default, to avoid routing evaluation prompts to an unconfigured region. Configure production repository variables only after selecting at least two distinct models supported in the approved region. The aliases `vertex_eval_1` and `vertex_eval_2` are available to training and evaluation only; they are not chat fallbacks. Set `SENTINEL_EVALUATOR_PROVIDERS=vertex_eval_1,vertex_eval_2` and `SENTINEL_MIN_EVALUATORS=2`. If no evaluator models are configured, manual learning refuses to start with `no_independent_evaluators`.
- Automatic training stays disabled in deployment. An administrator-started learning run explicitly evaluates the generated pending examples, records approved/rejected/evaluation-failure counts, and requires the configured evaluator quorum.
- Shadow evidence accumulates in batches of up to three new, uniquely identified held-out cases. The default promotion gate requires 30 measured cases, two distinct judge providers per comparison, no unsafe case, and regression within policy. Repeated cases do not increment the measured count.
- Promotion is checked by both the runtime learning policy and the research gate: deterministic safety, PII/secret scan, poisoning scan, provenance, evaluator quorum, benchmark evidence, protected-domain exclusion, and hourly promotion rate limit.
- Long-term memory retrieval segments Thai with `Intl.Segmenter`, ranks title and tags above body-only matches, then uses confidence, importance, and recency. Memories can carry a confidence score and optional expiry; expired items are excluded from list and retrieval. Memory queries remain scoped to the authenticated account.
- Reflection is an opt-in ablation through `POST /api/training/benchmark/reflection`. It compares direct answers with self-critique-and-revision on at most ten supplied cases, reports score delta, safety regressions, and latency, and never executes tools or changes the live chat path.
- Multi-agent orchestration now has an orchestration-wide tool-step budget (default 10, configurable with `PANTHORIUM_MULTI_AGENT_MAX_TOOL_STEPS`). Each role's workflow receives only the remaining budget; exhausted runs stop before another role can act.

## Remaining experiments

1. Run the reflection ablation on a fixed Thai/English suite with at least 30 cases; compare accuracy, safety, and added latency against direct generation before enabling reflection in normal chat.
2. Measure memory retrieval precision@k and recall@k on tenant-separated Thai, English, and mixed-language queries; compare the current weighted lexical baseline with a hybrid retriever before adding embeddings.
3. Compare 30-case shadow outcomes against a frozen baseline and inspect per-case judge disagreement. Treat generated paraphrases as held-out operational checks, not as a substitute for a curated benchmark.
4. Use admin-only `POST /api/agent/evaluate` with expected action/tool/argument labels to measure tool selection and argument accuracy in dry-run. Track confirmation rate, task completion, and tool-budget exhaustion separately; this benchmark never executes tools.
5. Production drift currently needs an explicit monitor action and benchmark evidence is not automatically attributed to each active knowledge version. Add a version-linked outcome stream before enabling autonomous drift rollback.

## API target

Admin/settings permission:

- `GET /api/training/autonomous/status`
- `GET /api/training/autonomous/candidates`
- `GET /api/training/autonomous/candidates/:id`
- `POST /api/training/autonomous/run`
- `POST /api/training/autonomous/candidates/:id/re-evaluate`
- `POST /api/training/autonomous/candidates/:id/rollback`
- `GET /api/training/autonomous/evaluations`
- `GET /api/training/autonomous/drift`

No API may directly set `active` without server-side promotion policy.

## Operational controls

Environment defaults:

- `SENTINEL_AUTONOMOUS_LEARNING=1`
- `SENTINEL_AUTONOMOUS_PROMOTION_THRESHOLD=90`
- `SENTINEL_AUTONOMOUS_SHADOW_MIN_SAMPLES=30`
- `SENTINEL_AUTONOMOUS_DRIFT_WINDOW=100`
- `SENTINEL_AUTONOMOUS_ROLLBACK_SCORE=82`
- `SENTINEL_AUTONOMOUS_MAX_PROMOTIONS_PER_HOUR=20`

Emergency stop must disable promotion immediately while leaving monitoring/audit online.

Runtime controls (administrator `settings` permission only):

- `POST /api/training/learning/promotion/pause` with optional `{ "reason": "..." }`
- `POST /api/training/learning/promotion/resume`
- `SENTINEL_AUTONOMOUS_PROMOTION_ENABLED=0` starts the service with promotion paused

The stop is fail-closed at the server-side promotion policy. Capture, evaluation,
shadow sampling, monitoring, audit events and rollback/recovery remain available.

## Acceptance gates

1. No knowledge becomes active without deterministic safety + evaluator + shadow gates.
2. Failed/partial evaluator calls fail closed.
3. Duplicate/secret/PII/poisoned candidates cannot promote.
4. Every active version can roll back to previous-good idempotently.
5. Critical safety regression triggers automatic quarantine + rollback.
6. Protected-domain content cannot be autonomously promoted.
7. Cross-user data isolation tests pass.
8. Restart does not lose state when PostgreSQL is configured.
9. All transitions emit audit events.
10. CI includes deterministic tests for promotion, rejection, shadow accumulation, evaluator quorum, retrieval, reflection ablation, tool budgets and rollback.

## Quality objective

เป้าหมายไม่ใช่การอ้างว่า Sentinel ดีกว่าโมเดลชั้นนำทุกด้านโดยไม่มีหลักฐาน แต่สร้างระบบที่สามารถพิสูจน์ผลบน Panthorium Benchmark ได้: task success, grounded correctness, safety, retrieval precision, latency, cost, recovery และ regression rate ต้องถูกวัดเทียบ baseline/model/provider อย่างต่อเนื่อง ก่อนจะประกาศ superiority ในโดเมนใดโดเมนหนึ่ง

