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

## New services to implement

- `services/sentinelLearningPolicyService.js` — state/risk/promotion policy
- `services/sentinelEvaluationService.js` — multi-evaluator rubric + deterministic checks
- `services/sentinelLearningRepository.js` — versions, evidence, outcomes, rollback pointers
- `services/sentinelShadowEvaluationService.js` — replay/control-vs-candidate comparison
- `services/sentinelDriftMonitorService.js` — rolling production quality/drift signals
- `services/sentinelLearningOrchestrator.js` — durable state machine coordinating the loop

Existing `trainingService` remains the ingestion bridge during migration.

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

## Acceptance gates

1. No knowledge becomes active without deterministic safety + evaluator + shadow gates.
2. Failed/partial evaluator calls fail closed.
3. Duplicate/secret/PII/poisoned candidates cannot promote.
4. Every active version can roll back to previous-good atomically.
5. Critical safety regression triggers automatic quarantine + rollback.
6. Protected-domain content cannot be autonomously promoted.
7. Cross-user data isolation tests pass.
8. Restart does not lose state when PostgreSQL is configured.
9. All transitions emit audit events.
10. CI includes deterministic tests for promotion, rejection, drift and rollback.

## Quality objective

เป้าหมายไม่ใช่การอ้างว่า Sentinel ดีกว่าโมเดลชั้นนำทุกด้านโดยไม่มีหลักฐาน แต่สร้างระบบที่สามารถพิสูจน์ผลบน Panthorium Benchmark ได้: task success, grounded correctness, safety, retrieval precision, latency, cost, recovery และ regression rate ต้องถูกวัดเทียบ baseline/model/provider อย่างต่อเนื่อง ก่อนจะประกาศ superiority ในโดเมนใดโดเมนหนึ่ง
