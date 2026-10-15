'use strict';
const source = require('../data/cloud-app-packs.json');
function copy(value) { return JSON.parse(JSON.stringify(value)); }
class CloudAppCatalog {
  constructor({ allowMinorProfiles = false, minorPolicyVerified = false } = {}) {
    this.minorReady = allowMinorProfiles === true && minorPolicyVerified === true;
  }
  isKnownMinor(user) {
    return user?.isMinor === true || ['under_13', '13_17', 'age_0_5', 'age_6_12', 'age_13_17'].includes(user?.ageBand);
  }
  get(packId, user = {}) {
    const pack = source.packs.find(item => item.id === packId);
    if (!pack) return null;
    const blocked = !this.minorReady && (pack.requiresMinorReadiness || this.isKnownMinor(user));
    return { ...copy(pack), blocked, blockReason: blocked ? 'minor_provider_policy_not_verified' : null };
  }
  list(user = {}) {
    return { version: source.version, executionMode: 'assisted_draft', packs: source.packs.map(pack => this.get(pack.id, user)) };
  }
  feature(pack, featureId) { return pack?.features.find(feature => feature.id === featureId) || null; }
}
module.exports = { CloudAppCatalog };
