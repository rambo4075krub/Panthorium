(() => {
  const logo = '/panthorium-logo.svg';

  function setVisible(selector, visible) {
    document.querySelectorAll(selector).forEach((node) => {
      const next = visible ? '' : 'none';
      if (node.style.display !== next) node.style.display = next;
    });
  }

  function applyAccessVisibility() {
    let user = null;
    try { user = typeof OS !== 'undefined' ? OS?.state?.user : null; } catch (_) {}
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
    const guest = !user || roles.includes('guest');
    const has = (permission) => permissions.includes(permission);

    // Advanced operational surfaces are intentionally hidden from Guest.
    setVisible('#phase4-ai-launcher', !guest && has('chat'));
    setVisible('#phase5-agent-launcher', !guest && has('chat'));
    setVisible('#phase6-automation-launcher', !guest && has('chat'));
    setVisible('#phase7-memory-launcher', !guest && has('chat'));
    setVisible('#phase8-multi-agent-launcher', !guest && has('chat'));
    setVisible('#phase9-integrations-launcher', !guest && has('settings'));
    setVisible('[data-production-intelligence]', !guest && has('system:read'));

    // Settings controls should not be advertised when the account cannot use them.
    setVisible('#btn-settings-quick', has('settings'));
    setVisible('[data-app-id="settings"], [data-app="settings"]', has('settings'));

    // If access changed while a privileged overlay is open, close it immediately.
    if (guest || !has('chat')) {
      ['phase4-ai-dashboard','phase5-agent-ui','agent-automation-dashboard','agent-memory-dashboard','multi-agent-dashboard'].forEach((id) => document.getElementById(id)?.remove());
    }
    if (!has('settings')) document.getElementById('integrations-dashboard')?.remove();
    if (guest || !has('system:read')) document.getElementById('panthorium-production-intelligence')?.remove();
  }

  function applyBranding() {
    const bootLogo = document.querySelector('.boot-logo');
    if (bootLogo && !bootLogo.querySelector('img[data-panthorium-logo]')) {
      bootLogo.style.border = 'none';
      bootLogo.style.borderRadius = '0';
      bootLogo.style.width = '132px';
      bootLogo.style.height = '132px';
      bootLogo.style.boxShadow = 'none';
      bootLogo.innerHTML = `<img data-panthorium-logo src="${logo}" alt="Panthorium" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 0 18px rgba(255,90,20,.32));">`;
    }

    document.querySelectorAll('.login-avatar').forEach((avatar) => {
      if (avatar.querySelector('img[data-panthorium-logo]')) return;
      avatar.style.border = 'none';
      avatar.style.background = 'transparent';
      avatar.innerHTML = `<img data-panthorium-logo src="${logo}" alt="Panthorium" style="width:74px;height:74px;object-fit:contain;">`;
    });

    document.querySelectorAll('.sm-avatar').forEach((avatar) => {
      if (avatar.querySelector('img[data-panthorium-logo]')) return;
      avatar.style.border = 'none';
      avatar.style.background = 'transparent';
      avatar.innerHTML = `<img data-panthorium-logo src="${logo}" alt="Panthorium" style="width:32px;height:32px;object-fit:contain;">`;
    });

    applyAccessVisibility();
  }

  applyBranding();
  const observer = new MutationObserver(applyBranding);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('panthorium:auth-changed', applyAccessVisibility);
  setInterval(applyBranding, 1000);
  window.PanthoriumBranding = { refresh: applyBranding, refreshAccess: applyAccessVisibility };
})();
