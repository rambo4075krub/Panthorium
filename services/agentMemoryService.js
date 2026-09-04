class AgentMemoryService {
  constructor({ repository, audit, knowledge } = {}) { this.repository = repository; this.audit = audit; this.knowledge = knowledge || null; }
  async init() { await this.repository?.init?.(); }
  allowed(user) { return !!user?.sub && !String(user.sub).startsWith('guest:') && Array.isArray(user.permissions) && user.permissions.includes('chat'); }
  validateKind(kind) { const value = String(kind || 'note').trim().toLowerCase(); return /^[a-z0-9._:-]{1,40}$/.test(value) ? value : null; }
  validateTags(tags) { if (tags == null) return []; if (!Array.isArray(tags) || tags.length > 20) return null; const out = tags.map((x) => String(x).trim()).filter(Boolean); if (out.some((x) => x.length > 64)) return null; return out; }

  async remember({ user, kind, title, content, tags, source, importance, requestId } = {}) {
    if (!this.allowed(user)) return { ok: false, error: 'memory_requires_account' };
    const safeKind = this.validateKind(kind); if (!safeKind) return { ok: false, error: 'invalid_memory_kind' };
    const safeTitle = String(title || '').trim(); if (!safeTitle || safeTitle.length > 240) return { ok: false, error: 'invalid_memory_title' };
    const safeContent = String(content || '').trim(); if (!safeContent || safeContent.length > 12000) return { ok: false, error: 'invalid_memory_content' };
    const safeTags = this.validateTags(tags); if (!safeTags) return { ok: false, error: 'invalid_memory_tags' };
    const score = importance == null ? 50 : Number(importance); if (!Number.isInteger(score) || score < 1 || score > 100) return { ok: false, error: 'invalid_memory_importance' };
    if (source != null && (typeof source !== 'string' || source.length > 120)) return { ok: false, error: 'invalid_memory_source' };
    const memory = await this.repository.create({ userId: user.sub, kind: safeKind, title: safeTitle, content: safeContent, tags: safeTags, source: source || null, importance: score });
    this.audit?.record('agent.memory_created', { userId: user.sub, requestId, memoryId: memory.memoryId, kind: memory.kind, importance: memory.importance });
    return { ok: true, memory };
  }

  async list({ user, limit, kind } = {}) {
    if (!this.allowed(user)) return { ok: false, error: 'memory_requires_account' };
    const safeKind = kind == null ? null : this.validateKind(kind); if (kind != null && !safeKind) return { ok: false, error: 'invalid_memory_kind' };
    return { ok: true, memories: await this.repository.list(user.sub, limit, safeKind) };
  }

  async search({ user, query, limit, requestId } = {}) {
    if (!this.allowed(user)) return { ok: false, error: 'memory_requires_account' };
    const text = String(query || '').trim(); if (!text || text.length > 500) return { ok: false, error: 'invalid_memory_query' };
    const memories = await this.repository.search(user.sub, text, limit);
    this.audit?.record('agent.memory_searched', { userId: user.sub, requestId, queryLength: text.length, matches: memories.length });
    return { ok: true, memories };
  }

  async remove({ user, memoryId, requestId } = {}) {
    if (!this.allowed(user)) return { ok: false, error: 'memory_requires_account' };
    const id = String(memoryId || ''); if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'invalid_memory_id' };
    const deleted = await this.repository.delete(user.sub, id); if (!deleted) return { ok: false, error: 'memory_not_found' };
    this.audit?.record('agent.memory_deleted', { userId: user.sub, requestId, memoryId: id });
    return { ok: true };
  }

  async context({ user, query, limit = 6, requestId } = {}) {
    const memoryResult = await this.search({ user, query, limit, requestId });
    if (!memoryResult.ok) return memoryResult;
    const memories = memoryResult.memories.map((m) => ({ sourceType: 'memory', memoryId: m.memoryId, kind: m.kind, title: m.title, content: m.content, tags: m.tags, importance: m.importance }));
    let knowledge = [];
    if (this.knowledge?.allowed?.(user)) {
      try {
        const result = await this.knowledge.context({ user, query, limit });
        if (result.ok) knowledge = result.context.map((x) => ({ sourceType: 'knowledge', documentId: x.documentId, chunkId: x.chunkId, title: x.title, source: x.source, content: x.content, score: x.score }));
      } catch (error) {
        this.audit?.record('agent.knowledge_context_failed', { userId: user?.sub, requestId, error: error.message });
      }
    }
    const combined = [...memories, ...knowledge].slice(0, Math.max(1, Math.min(Number(limit) || 6, 12)));
    this.audit?.record('agent.context_retrieved', { userId: user?.sub, requestId, memoryMatches: memories.length, knowledgeMatches: knowledge.length, returned: combined.length });
    return { ok: true, context: combined, memoryMatches: memories.length, knowledgeMatches: knowledge.length };
  }
}

module.exports = { AgentMemoryService };