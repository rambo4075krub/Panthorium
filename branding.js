(() => {
  const logo = '/panthorium-logo.svg';

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
  }

  applyBranding();
  const observer = new MutationObserver(applyBranding);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(applyBranding, 1000);
  window.PanthoriumBranding = { refresh: applyBranding };
})();
