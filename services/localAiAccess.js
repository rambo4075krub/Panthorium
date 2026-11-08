'use strict';
const OWNER_EMAIL = 'rambo4075krub@gmail.com';
// Only call with a server-authenticated principal or a fresh repository record.
function localAiAllowed(user) {
  const id = String(user?.sub || user?.id || '');
  if (!id || id.startsWith('guest:') || user.roles?.includes('guest') || !user.permissions?.includes('chat')) return false;
  return user.roles?.includes('administrator') === true ||
    (typeof user.emailVerifiedAt === 'string' && Number.isFinite(Date.parse(user.emailVerifiedAt)) && String(user.email || '').trim().toLowerCase() === OWNER_EMAIL);
}
function createLocalAiAuthorizer(auth) {
  return async userId => {
    try {
      if (typeof userId !== 'string' || !userId || userId.startsWith('guest:')) return false;
      const stored = await auth.repository.findUserById(userId);
      if (!stored) return false;
      const policy = await auth.accountPolicy?.(userId);
      const principal = { ...stored, sub: stored.id, accountVersion: policy?.credentialVersion ?? stored.credentialVersion ?? 0 };
      const current = auth.validateAccountPrincipal ? await auth.validateAccountPrincipal(principal) : principal;
      return localAiAllowed(current);
    } catch { return false; }
  };
}
async function canUseLocal(providers, userId) {
  try { return typeof providers?.authorizeLocal === 'function' && await providers.authorizeLocal(userId) === true; }
  catch { return false; }
}
module.exports = { OWNER_EMAIL, localAiAllowed, createLocalAiAuthorizer, canUseLocal };
