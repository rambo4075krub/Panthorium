'use strict';
const { randomUUID } = require('node:crypto');
const { only, publicProject, uuid, version } = require('./workAssistantService');
const { error } = require('./workAssistantRepository');
const brief = require('../work-brief');
const { plans, lines } = brief;

function checkedText(value, max = 8000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw error('brief_invalid_text');
  return value.trim();
}
function checkedLines(value, maxChars, maxLines) {
  const text = checkedText(value, maxChars);
  if (lines(text).length > maxLines) throw error('brief_too_many_lines');
  return text;
}
function requiredKeys(value, keys) {
  if (!only(value, keys) || keys.some(key => !Object.hasOwn(value, key))) throw error('brief_invalid_request');
}
function currentBaseline(data) { return data.briefBaselines?.at(-1); }
function findReview(data, id) {
  uuid(id);
  const review = data.briefReviews?.find(item => item.id === id);
  if (!review) throw error('brief_review_not_found', 404);
  return review;
}
function priceItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 15) throw error('brief_invalid_items');
  return items.map(item => {
    requiredKeys(item, ['label', 'quantity', 'unitPrice']);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999 || typeof item.unitPrice !== 'string' || !/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(item.unitPrice)) throw error('brief_invalid_price');
    const [baht, cents = ''] = item.unitPrice.split('.');
    return { label: checkedText(item.label, 200), quantity: item.quantity, unitSatang: Number(baht) * 100 + Number(cents.padEnd(2, '0')) };
  });
}

class WorkBriefService {
  constructor(work, entitlements) { this.work = work; this.entitlements = entitlements; }
  async plan(ownerId) {
    if (!this.entitlements) return 'free';
    let state;
    try { state = await this.entitlements.state(ownerId); } catch { throw error('brief_membership_unavailable', 503); }
    if (!Object.hasOwn(plans, state?.plan)) throw error('brief_membership_unavailable', 503);
    return state.plan;
  }
  async access(user) { user = await this.work.principal(user); return { plan: await this.plan(user.sub) }; }
  async requirePlan(user, minimum) {
    if (plans[await this.plan(user.sub)].level < plans[minimum].level) throw error('brief_plan_required', 403);
  }
  async attachedBaseline(user, projectId, expectedVersion, fileId) {
    uuid(fileId);
    const project = await this.work.getRaw(user, projectId);
    // The transactional repository handles stale revisions and idempotent replays.
    if (project.version !== expectedVersion) return null;
    if (!project.data.sourceFileIds.includes(fileId)) throw error('brief_file_not_attached', 404);
    const file = await this.work.files.readOwned(user.sub, fileId);
    const parsed = await this.work.parserGate.run(() => this.work.reader(file, { signal: AbortSignal.timeout(20000) }));
    const text = checkedLines(parsed.parts.map(part => part.text).join('\n'), 8000, 80);
    return { text, source: { fileId, name: file.name, revision: parsed.revision } };
  }
  async change({ user, projectId, action, body }) {
    user = await this.work.principal(user); uuid(projectId);
    requiredKeys(body, ['expectedVersion', 'operationId', 'input']);
    version(body.expectedVersion); uuid(body.operationId);
    if (!body.expectedVersion) throw error('work_invalid_version');
    const input = body.input;
    if (action === 'quotes' || action === 'status') await this.requirePlan(user, 'work');
    const fromFile = action === 'baseline' && only(input, ['fileId']) && Object.hasOwn(input, 'fileId');
    const attached = fromFile ? await this.attachedBaseline(user, projectId, body.expectedVersion, input.fileId) : null;
    const result = await this.work.repository.mutate({ ownerId: user.sub, id: projectId, version: body.expectedVersion,
      operationId: body.operationId, input: { briefAction: action, input } }, next => {
      const data = next.data, at = new Date().toISOString();
      if (action === 'baseline') {
        if (!fromFile) requiredKeys(input, ['text']);
        if (fromFile && !attached) throw error('work_version_conflict', 409);
        const snapshot = attached || { text: checkedLines(input.text, 8000, 80) };
        const previous = currentBaseline(data);
        if (previous?.text === snapshot.text && previous?.source?.revision === snapshot.source?.revision && previous?.source?.fileId === snapshot.source?.fileId) throw error('brief_same_baseline', 409);
        // Keep every revision referenced by a review. Unused revisions have no downstream evidence.
        const used = new Set((data.briefReviews || []).map(row => row.baselineId));
        data.briefBaselines = [...(data.briefBaselines || []).filter(b => used.has(b.id)),
          { id: randomUUID(), revision: (previous?.revision || 0) + 1, ...snapshot, at }];
      } else if (action === 'reviews') {
        requiredKeys(input, ['baselineId', 'request', 'decisions']);
        const baseline = currentBaseline(data);
        if (!baseline || baseline.id !== input.baselineId) throw error('brief_baseline_changed', 409);
        const requests = lines(checkedLines(input.request, 4000, 16)), terms = lines(baseline.text);
        if (!Array.isArray(input.decisions) || input.decisions.length !== requests.length) throw error('brief_invalid_decisions');
        const rows = requests.map((text, i) => {
          const decision = input.decisions[i];
          requiredKeys(decision, ['category', 'evidence']);
          const { category, evidence } = decision;
          if (typeof category !== 'string' || !Object.hasOwn(brief.categories, category) || (evidence !== null && (!Number.isInteger(evidence) || evidence < 0 || evidence >= terms.length)) || (category === 'included' && evidence === null)) throw error('brief_invalid_decisions');
          return { text, category, evidence };
        });
        data.briefReviews = [...(data.briefReviews || []), { id: randomUUID(), baselineId: baseline.id, at, rows }];
      } else if (action === 'quotes') {
        requiredKeys(input, ['reviewId', 'items', 'delivery']);
        const review = findReview(data, input.reviewId);
        if (review.quote && review.quote.status !== 'draft') throw error('brief_quote_locked', 409);
        const items = priceItems(input.items), delivery = input.delivery === '' ? '' : checkedText(input.delivery, 100);
        const totalSatang = items.reduce((sum, i) => sum + i.quantity * i.unitSatang, 0);
        if (totalSatang > 99999999999) throw error('brief_total_too_large');
        review.quote = { items, delivery, totalSatang, status: 'draft', updatedAt: at };
      } else if (action === 'status') {
        requiredKeys(input, ['reviewId', 'status']);
        const quote = findReview(data, input.reviewId).quote;
        if (!quote || !(quote.status === 'draft' && input.status === 'pending' || quote.status === 'pending' && ['accepted', 'declined', 'draft'].includes(input.status))) throw error('brief_invalid_transition', 409);
        quote.status = input.status; quote.updatedAt = at;
      } else throw error('brief_invalid_request');
    });
    return { project: publicProject(result.project), replayed: result.replayed };
  }
  async handover(user, id) {
    user = await this.work.principal(user);
    await this.requirePlan(user, 'life');
    const { data, version } = await this.work.getRaw(user, id);
    const baseline = currentBaseline(data), tasks = (data.tasks || []).filter(t => t.status === 'active');
    if (!baseline && !tasks.length) throw error('brief_nothing_to_handover', 409);
    const parts = [data.title, ...(baseline ? ['บรีฟที่ตกลง · ฉบับ ' + baseline.revision, baseline.text] : [])];
    for (const t of tasks) {
      const due = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: t.timeZone }).format(new Date(t.dueAt));
      parts.push('• ' + t.title + (t.assignee ? ' · ' + t.assignee : '') + ' · ' + due + ' (' + t.timeZone + ')');
    }
    const latest = (data.briefReviews || []).filter(r => r.baselineId === baseline?.id).at(-1);
    if (latest) for (const row of latest.rows.filter(r => r.category === 'clarify')) parts.push('รอคำตอบ · ' + row.text);
    return { text: parts.join('\n'), version };
  }
  async board(user) {
    user = await this.work.principal(user);
    await this.requirePlan(user, 'work-pro');
    const rows = await this.work.repository.listBriefQuotes(user.sub);
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.reviewId.localeCompare(b.reviewId));
    const totals = { pending: 0, accepted: 0 };
    for (const row of rows) if (Object.hasOwn(totals, row.status)) totals[row.status] += row.totalSatang;
    return { rows, totals };
  }
}
module.exports = { WorkBriefService };
