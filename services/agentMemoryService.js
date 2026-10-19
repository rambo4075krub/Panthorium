const { MEMORY_SCOPES, CONFIRMATIONS, SENSITIVITIES } = require('./agentMemoryRepository');
const PROVENANCE_TYPES = ['user', 'conversation', 'document', 'import', 'system'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function validateMetadata(input, { partial = false } = {}) {
  const changes = {};
  for (const [key, allowed, fallback] of [['confirmation',CONFIRMATIONS,'unconfirmed'],['sensitivity',SENSITIVITIES,'standard']]) {
    if (partial && input[key] === undefined) continue;
    const value = input[key] === undefined ? fallback : input[key];
    if (!allowed.includes(value)) return { error: 'invalid_memory_' + key };
    changes[key] = value;
  }
  if (!partial || input.confidence !== undefined) {
    const value = input.confidence == null ? 0.8 : Number(input.confidence);
    if (!Number.isFinite(value) || value < 0 || value > 1) return { error:'invalid_memory_confidence' };
    changes.confidence = value;
  }
  if (!partial || input.expiresAt !== undefined) {
    const value = input.expiresAt == null ? null : new Date(input.expiresAt);
    if (value && (!Number.isFinite(value.getTime()) || value.getTime() <= Date.now())) return { error:'invalid_memory_expiration' };
    changes.expiresAt = value?.toISOString() || null;
  }
  if (!partial || input.provenance !== undefined) {
    const value = input.provenance;
    if (value == null) changes.provenance = null;
    else {
      if (typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).every(key => ['type','reference','observedAt'].includes(key)) || !PROVENANCE_TYPES.includes(value.type)) return { error:'invalid_memory_provenance' };
      if (value.reference != null && (typeof value.reference !== 'string' || !value.reference.trim() || value.reference.length > 500)) return { error:'invalid_memory_provenance' };
      if (value.observedAt != null && (typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt)))) return { error:'invalid_memory_provenance' };
      changes.provenance = { type:value.type, ...(value.reference == null ? {} : { reference:value.reference.trim() }), ...(value.observedAt == null ? {} : { observedAt:new Date(value.observedAt).toISOString() }) };
    }
  }
  return { changes };
}

class AgentMemoryService {
  constructor({ repository, audit, knowledge } = {}) { this.repository=repository; this.audit=audit; this.knowledge=knowledge || null; }
  async init() { await this.repository?.init?.(); }
  allowed(user) { return !!user?.sub && !String(user.sub).startsWith('guest:') && Array.isArray(user.permissions) && user.permissions.includes('chat'); }
  validScope(scope) { return MEMORY_SCOPES.includes(scope); }
  validateKind(kind) { const value=String(kind || 'note').trim().toLowerCase(); return /^[a-z0-9._:-]{1,40}$/.test(value) ? value : null; }
  validateTags(tags) { if (tags==null) return []; if (!Array.isArray(tags) || tags.length>20) return null; const out=tags.map(x=>String(x).trim()).filter(Boolean); return out.some(x=>x.length>64) ? null : out; }

  async remember({ user, scope='personal', kind, title, content, tags, source, importance, confidence, expiresAt, provenance, confirmation, sensitivity, requestId } = {}) {
    if (!this.allowed(user)) return { ok:false,error:'memory_requires_account' };
    if (!this.validScope(scope)) return { ok:false,error:'invalid_memory_scope' };
    const safeKind=this.validateKind(kind); if (!safeKind) return { ok:false,error:'invalid_memory_kind' };
    const safeTitle=String(title || '').trim(); if (!safeTitle || safeTitle.length>240) return { ok:false,error:'invalid_memory_title' };
    const safeContent=String(content || '').trim(); if (!safeContent || safeContent.length>12000) return { ok:false,error:'invalid_memory_content' };
    const safeTags=this.validateTags(tags); if (!safeTags) return { ok:false,error:'invalid_memory_tags' };
    const score=importance==null ? 50 : Number(importance); if (!Number.isInteger(score) || score<1 || score>100) return { ok:false,error:'invalid_memory_importance' };
    if (source!=null && (typeof source!=='string' || source.length>120)) return { ok:false,error:'invalid_memory_source' };
    const metadata=validateMetadata({ confidence,expiresAt,provenance,confirmation,sensitivity });
    if (metadata.error) return { ok:false,error:metadata.error };
    const memory=await this.repository.create({ userId:user.sub,scope,kind:safeKind,title:safeTitle,content:safeContent,tags:safeTags,source:source || null,importance:score,...metadata.changes });
    this.audit?.record('agent.memory_created',{ userId:user.sub,requestId,memoryId:memory.memoryId,scope,kind:memory.kind,importance:memory.importance });
    return { ok:true,memory };
  }

  async get({ user, memoryId, scope='personal' } = {}) {
    if (!this.allowed(user)) return { ok:false,error:'memory_requires_account' };
    if (!this.validScope(scope)) return { ok:false,error:'invalid_memory_scope' };
    if (!/^[0-9a-f-]{36}$/i.test(String(memoryId || ''))) return { ok:false,error:'invalid_memory_id' };
    const memory=await this.repository.get(user.sub,String(memoryId),scope);
    return memory ? { ok:true,memory } : { ok:false,error:'memory_not_found' };
  }
  async calendarList({user}={}) {
    if (!this.allowed(user)) return {ok:false,error:'memory_requires_account'};
    const rows=await this.repository.calendarRecords(user.sub);
    return {ok:true,memories:rows.slice(0,10000),truncated:rows.length>10000};
  }
  async list({ user, limit, kind, scope='personal' } = {}) {
    if (!this.allowed(user)) return { ok:false,error:'memory_requires_account' };
    if (!this.validScope(scope)) return { ok:false,error:'invalid_memory_scope' };
    const safeKind=kind==null ? null : this.validateKind(kind); if (kind!=null && !safeKind) return { ok:false,error:'invalid_memory_kind' };
    return { ok:true,scope,memories:await this.repository.list(user.sub,limit,safeKind,scope) };
  }

  async update(input = {}) {
    const { user,memoryId,scope='personal',title,content,tags,importance,source,requestId }=input;
    if (!this.allowed(user)) return { ok:false,error:'memory_requires_account' };
    if (!this.validScope(scope)) return { ok:false,error:'invalid_memory_scope' };
    const id=String(memoryId || ''); if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok:false,error:'invalid_memory_id' };
    const current=await this.repository.get(user.sub,id,scope);
    if (!current) return { ok:false,error:'memory_not_found' };
    const changes={};
    if (title!==undefined) { if (typeof title!=='string' || !title.trim() || title.length>240) return { ok:false,error:'invalid_memory_title' }; changes.title=title.trim(); }
    if (content!==undefined) { if (typeof content!=='string' || !content.trim() || content.length>12000) return { ok:false,error:'invalid_memory_content' }; changes.content=content.trim(); }
    if (tags!==undefined) { const value=this.validateTags(tags); if (!value) return { ok:false,error:'invalid_memory_tags' }; changes.tags=value; }
    if (importance!==undefined) { const value=Number(importance); if (!Number.isInteger(value) || value<1 || value>100) return { ok:false,error:'invalid_memory_importance' }; changes.importance=value; }
    if (source!==undefined) { if (source!==null && (typeof source!=='string' || source.length>120)) return { ok:false,error:'invalid_memory_source' }; changes.source=source || null; }
    const metadata=validateMetadata(input,{ partial:true });
    if (metadata.error) return { ok:false,error:metadata.error };
    Object.assign(changes,metadata.changes);
    // Editing the contents invalidates an earlier assertion that those exact
    // contents were confirmed, unless the caller explicitly confirms the edit.
    if ((own(changes,'title') || own(changes,'content')) && input.confirmation===undefined) changes.confirmation='unconfirmed';
    if (!Object.keys(changes).length) return { ok:false,error:'empty_memory_update' };
    const memory=await this.repository.update(user.sub,id,changes,scope);
    if (!memory) return { ok:false,error:'memory_not_found' };
    this.audit?.record('agent.memory_updated',{ userId:user.sub,requestId,memoryId:id,scope,kind:memory.kind });
    return { ok:true,memory };
  }

  async search({ user,query,limit,scope='personal',requestId } = {}) {
    if (!this.allowed(user)) return { ok:false,error:'memory_requires_account' };
    if (!this.validScope(scope)) return { ok:false,error:'invalid_memory_scope' };
    const text=String(query || '').trim(); if (!text || text.length>500) return { ok:false,error:'invalid_memory_query' };
    const memories=await this.repository.search(user.sub,text,limit,scope);
    this.audit?.record('agent.memory_searched',{ userId:user.sub,requestId,scope,queryLength:text.length,matches:memories.length });
    return { ok:true,scope,memories };
  }
  async remove({ user,memoryId,scope='personal',requestId } = {}) {
    if (!this.allowed(user)) return { ok:false,error:'memory_requires_account' };
    if (!this.validScope(scope)) return { ok:false,error:'invalid_memory_scope' };
    const id=String(memoryId || ''); if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok:false,error:'invalid_memory_id' };
    const deleted=await this.repository.delete(user.sub,id,scope); if (!deleted) return { ok:false,error:'memory_not_found' };
    this.audit?.record('agent.memory_deleted',{ userId:user.sub,requestId,memoryId:id,scope });
    return { ok:true };
  }

  async context({ user,query,limit=6,scope='personal',requestId } = {}) {
    const safeLimit=Math.max(1,Math.min(Number(limit) || 6,12));
    const memoryResult=await this.search({ user,query,limit:safeLimit,scope,requestId });
    if (!memoryResult.ok) return memoryResult;
    const memories=memoryResult.memories.map(m=>({ sourceType:'memory',memoryId:m.memoryId,kind:m.kind,title:m.title,content:m.content,tags:m.tags,importance:m.importance,source:m.source || null,scope:m.scope || 'personal',provenance:m.provenance || null,confirmation:m.confirmation || 'unconfirmed',sensitivity:m.sensitivity || 'standard',confidence:m.confidence ?? 0.8,expiresAt:m.expiresAt || null }));
    let knowledge=[];
    // Existing knowledge is owner-scoped but has no independent workspace
    // contract yet. Never merge its personal documents into work/study/family.
    if (scope==='personal' && this.knowledge?.allowed?.(user)) {
      try {
        const result=await this.knowledge.context({ user,query,limit:safeLimit });
        if (result.ok) knowledge=result.context.filter(x=>!x.scope || x.scope===scope).map(x=>({ sourceType:'knowledge',scope,documentId:x.documentId,chunkId:x.chunkId,title:x.title,source:x.source,content:x.content,score:x.score }));
      } catch (error) { this.audit?.record('agent.knowledge_context_failed',{ userId:user?.sub,requestId,error:error.message }); }
    }
    const combined=[]; let memoryIndex=0,knowledgeIndex=0;
    while (combined.length<safeLimit && (memoryIndex<memories.length || knowledgeIndex<knowledge.length)) {
      if (memoryIndex<memories.length && combined.length<safeLimit) combined.push(memories[memoryIndex++]);
      if (knowledgeIndex<knowledge.length && combined.length<safeLimit) combined.push(knowledge[knowledgeIndex++]);
    }
    this.audit?.record('agent.context_retrieved',{ userId:user?.sub,requestId,scope,memoryMatches:memories.length,knowledgeMatches:knowledge.length,returned:combined.length });
    return { ok:true,scope,context:combined,memoryMatches:memories.length,knowledgeMatches:knowledge.length };
  }
}

module.exports = { AgentMemoryService, validateMetadata };
