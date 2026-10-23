'use strict';
const { createHash } = require('node:crypto');

function publicationHash(example) {
  return createHash('sha256').update(JSON.stringify([String(example.prompt || ''), String(example.answer || '')])).digest('hex');
}
function privateTraining(example = {}) {
  const labels = [example.source, ...(Array.isArray(example.tags) ? example.tags : [])];
  return labels.some(value => /(?:^|[:/_\s-])(?:conversation|private|personal|confidential)(?:$|[:/_\s-])/i.test(String(value || '')));
}
function validPublication(example = {}) {
  // This record is not accepted by chat, training upload, review or model tools.
  // It is reserved for an independently audited consent/anonymization process.
  // Quality approval alone never grants permission to publish private material.
  const record = example.globalPublication;
  const reference = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 240;
  return !!record && record.schema === 1 && record.scope === 'global-training'
    && record.status === 'approved' && !record.revokedAt
    && record.exampleId === example.exampleId
    && record.subjectUserId === example.createdBy
    && record.contentHash === publicationHash(example)
    && record.consentGranted === true && record.anonymized === true
    && reference(record.consentEvidenceId) && reference(record.anonymizationReviewId)
    && reference(record.approvedBy) && reference(record.subjectUserId)
    && typeof record.approvedAt === 'string' && Number.isFinite(Date.parse(record.approvedAt))
    && Date.parse(record.approvedAt) <= Date.now();
}
module.exports = { privateTraining, validPublication, publicationHash };
