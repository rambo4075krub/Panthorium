'use strict';
const crypto = require('node:crypto');

// Deterministic UTF-8 representation shared by publisher and installed client.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
function payload(manifest) {
  const unsigned = { ...manifest };
  delete unsigned.signature;
  return Buffer.from(canonical(unsigned), 'utf8');
}
function trustedKey(trust, keyId) {
  if (!trust || trust.version !== 1 || !trust.keys || !Object.hasOwn(trust.keys, keyId)) return null;
  const key = crypto.createPublicKey(trust.keys[keyId]);
  return key.asymmetricKeyType === 'ed25519' ? key : null;
}
function verifyManifest(manifest, trust) {
  if (!trust?.keys || !Object.keys(trust.keys).length) return { ok: false, error: 'update_signature_unconfigured' };
  const signature = manifest?.signature;
  if (!signature || signature.algorithm !== 'ed25519' || typeof signature.keyId !== 'string'
      || typeof signature.value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature.value)) {
    return { ok: false, error: 'update_signature_missing' };
  }
  try {
    const key = trustedKey(trust, signature.keyId);
    if (!key) return { ok: false, error: 'update_signature_unknown_key' };
    if (!crypto.verify(null, payload(manifest), key, Buffer.from(signature.value, 'base64'))) {
      return { ok: false, error: 'update_signature_invalid' };
    }
    return { ok: true };
  } catch { return { ok: false, error: 'update_signature_invalid' }; }
}
function signManifest(manifest, privatePem, keyId, trust) {
  if (!privatePem || !keyId) throw Error('Update signing private key and key ID are required');
  const privateKey = crypto.createPrivateKey(privatePem), publicKey = trustedKey(trust, keyId);
  if (privateKey.asymmetricKeyType !== 'ed25519' || !publicKey
      || !crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
        .equals(publicKey.export({ type: 'spki', format: 'der' }))) {
    throw Error('Update signing key must match the committed Ed25519 trust store');
  }
  return { ...manifest, signature: { algorithm: 'ed25519', keyId,
    value: crypto.sign(null, payload(manifest), privateKey).toString('base64') } };
}
module.exports = { verifyManifest, signManifest };
