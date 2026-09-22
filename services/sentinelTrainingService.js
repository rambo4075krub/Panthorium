const { createHash } = require("crypto");
function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function cleanTags(value) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.map((tag) => cleanText(tag, 40).toLowerCase()).filter(Boolean),
        ),
      ].slice(0, 12)
    : [];
}
// Thai has no spaces between words, so plain regex splitting cannot retrieve
// Thai knowledge. Segment with Intl.Segmenter instead (kept in sync with the
// Thai retrieval fix on staging).
const wordSegmenter = new Intl.Segmenter("th", { granularity: "word" });
function terms(value) {
  return new Set(
    Array.from(wordSegmenter.segment(String(value).normalize("NFKC").toLowerCase()))
      .filter((part) => part.isWordLike)
      .map((part) => part.segment)
      .filter((word) => word.length > 1)
      .slice(0, 80),
  );
}
function clampScore(value) {
  const score = Math.round(Number(value));
  return Number.isFinite(score) ? Math.max(0, Math.min(score, 100)) : null;
}
function redactSensitive(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "[REDACTED_TOKEN]")
    .replace(/\b(?:sk|gsk|AIza)[-_A-Za-z0-9]{16,}\b/g, "[REDACTED_SECRET]")
    .replace(
      /\b(api[_-]?key|secret|password|passwd|token|authorization)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(?:\+?66|0)[ -]?[0-9][0-9 -]{7,11}\b/g, "[REDACTED_PHONE]");
}
function fingerprint(prompt, answer) {
  return createHash("sha256")
    .update(`${prompt.toLowerCase()}\n${answer.toLowerCase()}`)
    .digest("hex");
}
function parseEvaluation(text) {
  const raw = String(text || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]);
    const score = clampScore(data.score);
    if (score == null) return null;
    return {
      score,
      safe: data.safe === true,
      correct: data.correct !== false,
      relevant: data.relevant !== false,
      reason: cleanText(data.reason, 500),
    };
  } catch (_) {
    return null;
  }
}
class SentinelTrainingService {
  constructor({
    repository,
    providers,
    audit,
    learning = null,
    autoEnabled = true,
    autoCapture = true,
    autoScoreThreshold = 85,
    autoIntervalMs = 60000,
    teacherProviders = ["groq"],
    evaluatorProviders = ["openai", "gemini", "anthropic"],
    minEvaluators = 2,
  } = {}) {
    this.repository = repository;
    this.providers = providers;
    this.audit = audit;
    this.learning = learning;
    this.initPromise = null;
    this.timer = null;
    this.processing = false;
    this.autoEnabled = autoEnabled !== false;
    this.autoCapture = autoCapture !== false;
    this.autoScoreThreshold = Math.max(
      60,
      Math.min(Number(autoScoreThreshold) || 85, 100),
    );
    this.autoIntervalMs = Math.max(15000, Number(autoIntervalMs) || 60000);
    this.teacherProviders = this.providerList(teacherProviders, ["groq"]);
    this.evaluatorProviders = this.providerList(evaluatorProviders, [
      "openai",
      "gemini",
      "anthropic",
    ]);
    this.minEvaluators = Math.max(2, Math.min(Number(minEvaluators) || 2, 3));
  }
  providerList(value, fallback) {
    const items = Array.isArray(value) ? value : String(value || "").split(",");
    const cleaned = [
      ...new Set(
        items.map((name) => String(name).trim().toLowerCase()).filter(Boolean),
      ),
    ];
    return cleaned.length ? cleaned : fallback;
  }
  async init() {
    if (!this.initPromise)
      this.initPromise = (async () => {
        await this.repository.init();
        if (this.learning) await this.learning.init();
      })();
    await this.initPromise;
  }
  start() {
    if (!this.autoEnabled || this.timer) return;
    this.timer = setInterval(
      () =>
        this.autoProcessPending().catch((error) =>
          this.audit?.record("sentinel.training_auto_cycle_failed", {
            error: error.message,
          }),
        ),
      this.autoIntervalMs,
    );
    this.timer.unref?.();
    setTimeout(() => this.autoProcessPending().catch(() => {}), 1000).unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  settings() {
    const available = this.providers.available();
    return {
      enabled: this.autoEnabled,
      capture: this.autoCapture,
      scoreThreshold: this.autoScoreThreshold,
      intervalMs: this.autoIntervalMs,
      running: Boolean(this.timer),
      providers: available,
      teacherProviders: this.teacherProviders.filter((name) =>
        available.includes(name),
      ),
      evaluatorProviders: this.evaluatorProviders.filter((name) =>
        available.includes(name),
      ),
      requiredEvaluators: this.minEvaluators,
      roleSeparation: true,
      autonomousLearning: Boolean(this.learning),
    };
  }
  async addExample({
    prompt,
    answer,
    source = "human",
    provider,
    model,
    tags,
    user = { sub: "system" },
    requestId,
    autoEvaluate = true,
  }) {
    await this.init();
    const cleanPrompt = cleanText(redactSensitive(prompt), 8000),
      cleanAnswer = cleanText(redactSensitive(answer), 12000);
    if (!cleanPrompt) return { ok: false, error: "invalid_training_prompt" };
    if (!cleanAnswer) return { ok: false, error: "invalid_training_answer" };
    if (cleanPrompt.length < 4 || cleanAnswer.length < 12)
      return { ok: false, error: "training_example_too_short" };
    const hash = fingerprint(cleanPrompt, cleanAnswer),
      existing = await this.repository.findByFingerprint(hash);
    if (existing) return { ok: true, duplicate: true, example: existing };
    const example = await this.repository.create({
      prompt: cleanPrompt,
      answer: cleanAnswer,
      source: cleanText(source, 120) || "human",
      provider: cleanText(provider, 60) || null,
      model: cleanText(model, 120) || null,
      tags: cleanTags(tags),
      createdBy: user.sub || "system",
      fingerprint: hash,
    });
    this.audit?.record("sentinel.training_example_created", {
      userId: user.sub || "system",
      exampleId: example.exampleId,
      source: example.source,
      requestId,
    });
    if (this.autoEnabled && autoEvaluate) {
      const evaluated = await this.autoEvaluateExample(example, { requestId });
      return {
        ok: true,
        example: evaluated.example || example,
        evaluation: evaluated,
        learning: evaluated.learning || null,
      };
    }
    return { ok: true, example };
  }
  async draftWithTeachers({
    prompt,
    providerNames,
    tags,
    user = { sub: "system" },
    requestId,
  }) {
    await this.init();
    const cleanPrompt = cleanText(redactSensitive(prompt), 8000);
    if (!cleanPrompt) return { ok: false, error: "invalid_training_prompt" };
    const available = this.providers.available(),
      requested = Array.isArray(providerNames)
        ? providerNames.map((name) => String(name).toLowerCase())
        : this.teacherProviders,
      selected = [...new Set(requested)]
        .filter(
          (name) =>
            available.includes(name) && this.teacherProviders.includes(name),
        )
        .slice(0, 4);
    if (!selected.length)
      return {
        ok: false,
        error: "no_teacher_provider",
        providers: this.providers.catalog(),
        required: this.teacherProviders,
      };
    const systemPrompt =
      "คุณเป็นครูฝึก Sentinel AI ของ Panthorium OS\nตอบโจทย์ให้ถูกต้อง ชัดเจน ปลอดภัย และเป็นภาษาไทย\nห้ามอ้างว่าทำสิ่งที่ไม่ได้ทำ ห้ามเปิดเผยข้อมูลลับ";
    const settled = await Promise.allSettled(
      selected.map(async (provider) => {
        const result = await this.providers.callDetailed(
          provider,
          systemPrompt,
          [{ role: "user", content: cleanPrompt }],
        );
        if (!result?.text) throw new Error("empty_teacher_response");
        const added = await this.addExample({
          prompt: cleanPrompt,
          answer: result.text,
          source: `teacher:${provider}`,
          provider,
          model: result.model,
          tags,
          user,
          requestId,
        });
        return {
          provider,
          model: result.model || null,
          example: added.example,
          evaluation: added.evaluation || null,
          learning: added.learning || null,
        };
      }),
    );
    const candidates = settled
        .filter((i) => i.status === "fulfilled")
        .map((i) => i.value),
      failures = settled
        .map((i, x) =>
          i.status === "rejected"
            ? {
                provider: selected[x],
                error: i.reason?.message || "teacher_failed",
              }
            : null,
        )
        .filter(Boolean);
    return {
      ok: candidates.length > 0,
      candidates,
      failures,
      automatic: this.settings(),
    };
  }
  async autoEvaluateExample(example, { requestId } = {}) {
    if (!this.autoEnabled)
      return { ok: false, error: "auto_training_disabled", example };
    if (example.status !== "pending")
      return { ok: true, skipped: true, example };
    const available = this.providers.available(),
      ordered = this.evaluatorProviders
        .filter(
          (name) => available.includes(name) && name !== example.provider,
        )
        .slice(0, 3);
    if (ordered.length < this.minEvaluators) {
      const evaluation = {
        score: null,
        threshold: this.autoScoreThreshold,
        safe: false,
        judges: [],
        failures: [],
        evaluatedAt: new Date().toISOString(),
        reason: "insufficient_independent_evaluators",
        requiredEvaluators: this.minEvaluators,
        availableEvaluators: ordered,
      };
      const updated = await this.repository.review(
        example.exampleId,
        "rejected",
        "sentinel-auto-reviewer",
        { qualityScore: null, evaluation, autoApproved: false },
      );
      this.audit?.record("sentinel.training_auto_reviewed", {
        exampleId: example.exampleId,
        status: "rejected",
        score: null,
        threshold: this.autoScoreThreshold,
        providers: ordered,
        error: evaluation.reason,
        requestId,
      });
      return {
        ok: true,
        status: "rejected",
        score: null,
        threshold: this.autoScoreThreshold,
        judges: [],
        failures: [],
        error: evaluation.reason,
        example: updated,
      };
    }
    const systemPrompt =
      'คุณเป็นผู้ตรวจคุณภาพข้อมูลฝึก Sentinel AI ให้ตอบ JSON เท่านั้น รูปแบบ {"score":0,"safe":false,"correct":false,"relevant":false,"reason":"..."}\nให้คะแนน 0-100 จากความถูกต้อง ความเกี่ยวข้อง ความชัดเจน และความปลอดภัย';
    const payload = `คำถาม:\n${example.prompt}\n\nคำตอบที่จะตรวจ:\n${example.answer}`;
    const settled = await Promise.allSettled(
      ordered.map(async (provider) => {
        const result = await this.providers.callDetailed(
          provider,
          systemPrompt,
          [{ role: "user", content: payload }],
        );
        const parsed = parseEvaluation(result?.text);
        if (!parsed) throw new Error("invalid_evaluator_response");
        return { provider, model: result.model || null, ...parsed };
      }),
    );
    const judges = settled
        .filter((i) => i.status === "fulfilled")
        .map((i) => i.value),
      failures = settled
        .map((i, x) =>
          i.status === "rejected"
            ? {
                provider: ordered[x],
                error: i.reason?.message || "evaluation_failed",
              }
            : null,
        )
        .filter(Boolean);
    // Quorum, not unanimity: a candidate needs at least minEvaluators independent
    // judges to answer. Requiring every configured judge would make each extra
    // evaluator a new single point of failure instead of added redundancy, so a
    // quota-limited provider could silently stall all training. Judges that do
    // answer must still agree, so the gate stays fail-closed below the quorum.
    const complete = judges.length >= this.minEvaluators,
      score = judges.length
        ? Math.round(judges.reduce((s, i) => s + i.score, 0) / judges.length)
        : null,
      safe = complete && judges.every((i) => i.safe && i.correct && i.relevant),
      status =
        safe && score >= this.autoScoreThreshold ? "approved" : "rejected",
      error = complete ? null : "incomplete_evaluation",
      evaluation = {
        score,
        threshold: this.autoScoreThreshold,
        safe,
        judges,
        failures,
        evaluatedAt: new Date().toISOString(),
        reason: error,
        requiredEvaluators: this.minEvaluators,
        evaluatorsConfigured: ordered.length,
        evaluatorsResponded: judges.length,
      };
    const updated = await this.repository.review(
      example.exampleId,
      status,
      "sentinel-auto-reviewer",
      { qualityScore: score, evaluation, autoApproved: status === "approved" },
    );
    let learning = null;
    if (status === "approved" && this.learning) {
      const quarantined = await this.learning.quarantine(updated);
      learning = await this.learning.evaluateForShadow(quarantined, updated);
    }
    this.audit?.record("sentinel.training_auto_reviewed", {
      exampleId: example.exampleId,
      status,
      score,
      threshold: this.autoScoreThreshold,
      providers: ordered,
      learningState: learning?.state || null,
      error,
      requestId,
    });
    return {
      ok: true,
      status,
      score,
      threshold: this.autoScoreThreshold,
      judges,
      failures,
      error,
      example: updated,
      learning,
    };
  }
  async autoProcessPending({ limit = 10 } = {}) {
    await this.init();
    if (!this.autoEnabled)
      return { ok: false, error: "auto_training_disabled" };
    if (this.processing)
      return { ok: true, skipped: true, reason: "cycle_running" };
    this.processing = true;
    try {
      const pending = await this.repository.list({
          status: "pending",
          limit: Math.max(1, Math.min(Number(limit) || 10, 25)),
        }),
        results = [];
      for (const example of pending)
        results.push(await this.autoEvaluateExample(example));
      return {
        ok: true,
        processed: results.length,
        approved: results.filter((i) => i.status === "approved").length,
        rejected: results.filter((i) => i.status === "rejected").length,
        results,
      };
    } finally {
      this.processing = false;
    }
  }
  async captureConversation({
    prompt,
    answer,
    provider,
    model,
    userId,
    sessionId,
  }) {
    if (!this.autoEnabled || !this.autoCapture)
      return { ok: false, skipped: true };
    return this.addExample({
      prompt,
      answer,
      source: "conversation:auto",
      provider,
      model,
      tags: ["conversation", "auto-training"],
      user: { sub: userId || "system" },
      requestId: sessionId,
    });
  }
  async list({ status, limit }) {
    await this.init();
    const allowed = new Set(["pending", "approved", "rejected"]);
    return {
      ok: true,
      examples: await this.repository.list({
        status: allowed.has(status) ? status : undefined,
        limit,
      }),
      stats: await this.repository.stats(),
      automatic: this.settings(),
      learning: this.learning ? await this.learning.status() : null,
    };
  }
  async review({ exampleId, status, user = { sub: "system" }, requestId }) {
    await this.init();
    if (!["approved", "rejected"].includes(status))
      return { ok: false, error: "invalid_training_status" };
    const example = await this.repository.review(
      exampleId,
      status,
      user.sub || "system",
    );
    if (!example) return { ok: false, error: "training_example_not_found" };
    let learning = null;
    if (status === "approved" && this.learning) {
      const quarantined = await this.learning.quarantine(example);
      learning = await this.learning.evaluateForShadow(quarantined, example);
    }
    return { ok: true, example, learning };
  }
  async contextFor(query, limit = 3) {
    await this.init();
    const queryTerms = terms(query);
    if (!queryTerms.size) return "";
    let approved = await this.repository.approved();
    if (this.learning) {
      const active = await this.learning.repository.list({
          state: "active",
          limit: 500,
        }),
        activeIds = new Set(active.map((v) => v.exampleId));
      approved = approved.filter((e) => activeIds.has(e.exampleId));
    }
    const ranked = approved
      .map((example) => {
        const haystack = terms(
          `${example.prompt} ${(example.tags || []).join(" ")}`,
        );
        let score = 0;
        for (const term of queryTerms) if (haystack.has(term)) score++;
        return { example, score };
      })
      .filter((i) => i.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.example.qualityScore || 0) - (a.example.qualityScore || 0),
      )
      .slice(0, Math.max(1, Math.min(limit, 5)));
    if (!ranked.length) return "";
    return `\n\nความรู้ Sentinel ที่ผ่าน Autonomous Learning และ Active แล้ว:\n${ranked
      .map(
        ({ example }, i) =>
          `ตัวอย่าง ${i + 1} (คะแนน ${example.qualityScore ?? "-"})\nคำถาม: ${example.prompt.slice(0, 2000)}\nคำตอบ: ${example.answer.slice(0, 4000)}`,
      )
      .join("\n\n")
      .slice(0, 12000)}`;
  }
  async exportJsonl() {
    await this.init();
    const examples = await this.repository.approved();
    return examples
      .map((example) =>
        JSON.stringify({
          messages: [
            { role: "user", content: example.prompt },
            { role: "assistant", content: example.answer },
          ],
          metadata: {
            source: example.source,
            qualityScore: example.qualityScore,
            autoApproved: example.autoApproved,
          },
        }),
      )
      .join("\n");
  }
}
module.exports = { SentinelTrainingService, redactSensitive, parseEvaluation };
