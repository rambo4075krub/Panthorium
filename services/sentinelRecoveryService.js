'use strict';

function retryDelayMs(error, fallbackMs = 60000) {
  const message = String(error?.message || error || '');
  const explicit = Number(error?.retryAfterMs);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(24 * 60 * 60 * 1000, Math.max(1000, explicit));
  const match = message.match(/(?:retry|try again)[^\d]*(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?/i);
  if (match && (match[1] || match[2] || match[3])) {
    const parsed = (Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)) * 1000;
    return Math.min(24 * 60 * 60 * 1000, Math.max(1000, Math.ceil(parsed)));
  }
  return Math.min(24 * 60 * 60 * 1000, Math.max(1000, Number(fallbackMs) || 60000));
}

class SentinelRecoveryService {
  constructor({ learning, training, trainingRepository, providers, audit, maxAttempts = 3, recoveryRetryMs = Number(process.env.SENTINEL_AUTONOMOUS_RECOVERY_RETRY_MS || 60000) } = {}) {
    this.learning = learning;
    this.training = training;
    this.trainingRepository = trainingRepository;
    this.providers = providers;
    this.audit = audit;
    this.maxAttempts = Math.max(1, Math.min(Number(maxAttempts) || 3, 5));
    this.recoveryRetryMs = Math.max(1000, Number(recoveryRetryMs) || 60000);
    this.processing = new Set();
    this.timer = null;
  }

  async init() {
    await this.learning?.init?.();
    await this.training?.init?.();
    await this.resumePending();
    if (!this.timer) {
      this.timer = setInterval(() => this.resumePending().catch((error) => this.audit?.record('sentinel.learning_recovery_resume_failed', { error: error.message })), this.recoveryRetryMs);
      this.timer.unref?.();
    }
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async resumePending() {
    const versions = await this.learning?.repository?.list?.({ state: 'rolled_back', limit: 500 }) || [];
    for (const version of versions) {
      const metadata = version.metadata || {};
      if (!metadata.automaticRecoveryScheduled || metadata.recoveryCompletedAt) continue;
      if (Number(metadata.recoveryAttempts || 0) >= this.maxAttempts) continue;
      const next = new Date(metadata.nextRecoveryAt || 0).getTime();
      if (next > Date.now()) continue;
      this.recover(version.versionId, { reason: metadata.rollbackReason || 'automatic_recovery_resume' }).catch((error) => {
        this.audit?.record('sentinel.learning_recovery_resume_failed', { versionId: version.versionId, error: error.message });
      });
    }
  }

  async sourceExample(version) {
    const items = await this.trainingRepository.list({ limit: 500 });
    return items.find((x) => x.exampleId === version.exampleId) || null;
  }

  async markFailure(version, error, reason = 'recovery_generation_failed') {
    const delay = retryDelayMs(error, this.recoveryRetryMs);
    const nextRecoveryAt = new Date(Date.now() + delay).toISOString();
    const message = String(error?.message || error || reason).slice(0, 1000);
    await this.learning.repository.update(version.versionId, {
      metadata: { ...(version.metadata || {}), lastRecoveryError: message, nextRecoveryAt, lastRecoveryFailureAt: new Date().toISOString() }
    });
    await this.learning.repository.event(version.versionId, 'recovery_failed', { reason, error: message, nextRecoveryAt });
    return { ok: false, error: reason, nextRecoveryAt };
  }

  async recover(versionId, { reason = 'automatic_recovery' } = {}) {
    if (this.processing.has(versionId)) return { ok: true, skipped: true, reason: 'recovery_running' };
    this.processing.add(versionId);
    try {
      let version = await this.learning.repository.get(versionId);
      if (!version) return { ok: false, error: 'learning_version_not_found' };
      if (version.state !== 'rolled_back') return { ok: false, error: 'learning_version_not_rolled_back' };
      const attempts = Number(version.metadata?.recoveryAttempts || 0);
      if (attempts >= this.maxAttempts) return { ok: false, error: 'recovery_attempt_limit' };
      const source = await this.sourceExample(version);
      if (!source) return this.markFailure(version, new Error('training_example_not_found'), 'training_example_not_found');
      const available = this.providers?.available?.() || [];
      const teachers = [...available.filter((p) => p !== source.provider), ...available.filter((p) => p === source.provider)].slice(0, Math.min(2, available.length));
      if (!teachers.length) return this.markFailure(version, new Error('no_recovery_provider'), 'no_recovery_provider');

      version = await this.learning.repository.update(versionId, {
        metadata: { ...(version.metadata || {}), recoveryAttempts: attempts + 1, lastRecoveryAt: new Date().toISOString(), lastRecoveryReason: reason, nextRecoveryAt: null }
      });
      await this.learning.repository.event(versionId, 'recovery_started', { attempt: attempts + 1, reason, teachers });
      const system = 'คุณคือ Sentinel Recovery Engineer สร้างคำตอบใหม่เพื่อแก้ regression ของความรู้ที่ถูก rollback ตอบเฉพาะคำตอบใหม่ที่ถูกต้อง ชัดเจน ปลอดภัย ไม่ใส่คำอธิบายกระบวนการ ห้ามคัดลอกคำตอบเดิมถ้ามีจุดอ่อน';
      const payload = `โจทย์เดิม:\n${source.prompt}\n\nคำตอบเดิมที่ถูก rollback:\n${source.answer}\n\nสาเหตุ rollback:\n${version.metadata?.rollbackReason || reason}\n\nสร้างคำตอบใหม่ที่แก้ปัญหาและเหมาะสำหรับนำไปประเมินอีกครั้ง`;
      const settled = await Promise.allSettled(teachers.map(async (provider) => {
        const response = await this.providers.callDetailed(provider, system, [{ role: 'user', content: payload }]);
        if (!response?.text) throw new Error('empty_recovery_response');
        return { provider, model: response.model || null, text: response.text };
      }));
      const drafts = settled.filter((x) => x.status === 'fulfilled').map((x) => x.value);
      const failures = settled.map((x, i) => x.status === 'rejected' ? { provider: teachers[i], error: x.reason?.message || 'recovery_failed' } : null).filter(Boolean);
      if (!drafts.length) return this.markFailure(version, new Error(failures[0]?.error || 'recovery_generation_failed'), 'recovery_generation_failed');

      const candidates = [];
      for (const draft of drafts) {
        try {
          const added = await this.training.addExample({
            prompt: source.prompt,
            answer: draft.text,
            source: `recovery:${versionId}`,
            provider: draft.provider,
            model: draft.model,
            tags: [...(source.tags || []), 'automatic-recovery'],
            user: { sub: 'sentinel-recovery' },
            requestId: `recovery:${versionId}`
          });
          if (added?.example) {
            if (added.learning?.versionId) {
              await this.learning.repository.update(added.learning.versionId, { metadata: { ...(added.learning.metadata || {}), recoveryOf: versionId, automaticRecovery: true } });
            }
            candidates.push({ provider: draft.provider, example: added.example, learning: added.learning || null, evaluation: added.evaluation || null, duplicate: Boolean(added.duplicate) });
          }
        } catch (error) {
          failures.push({ provider: draft.provider, error: error.message });
        }
      }
      if (!candidates.length) return this.markFailure(version, new Error(failures[0]?.error || 'recovery_candidates_not_created'), 'recovery_candidates_not_created');
      const completedAt = new Date().toISOString();
      await this.learning.repository.update(versionId, { metadata: { ...(version.metadata || {}), recoveryCompletedAt: completedAt, recoveryCandidateCount: candidates.length, lastRecoveryError: null, nextRecoveryAt: null } });
      await this.learning.repository.event(versionId, 'recovery_candidates_created', { count: candidates.length, failures });
      this.audit?.record('sentinel.learning_recovery_created', { versionId, exampleId: version.exampleId, candidateCount: candidates.length, attempt: attempts + 1 });
      return { ok: true, candidates, failures, attempt: attempts + 1 };
    } catch (error) {
      const version = await this.learning.repository.get(versionId).catch(() => null);
      if (version?.state === 'rolled_back') return this.markFailure(version, error, 'recovery_failed');
      throw error;
    } finally {
      this.processing.delete(versionId);
    }
  }

  recoverSoon(versionId, options = {}) {
    setImmediate(() => this.recover(versionId, options).catch((error) => this.audit?.record('sentinel.learning_recovery_failed', { versionId, error: error.message })));
  }
}

module.exports = { SentinelRecoveryService, retryDelayMs };
