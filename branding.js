(() => {
  const logo = '/panthorium-logo.svg?v=original-orange-20261015';
  const logoUrl = logo;

  function installLogoStyles() {
    if (document.getElementById('panthorium-logo-fit-style')) return;
    const style = document.createElement('style');
    style.id = 'panthorium-logo-fit-style';
    style.textContent = `
      .panthorium-logo-frame {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        overflow: hidden !important;
      }
      .panthorium-logo-frame > img[data-panthorium-logo] {
        display: block !important;
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        object-fit: contain !important;
        flex: 0 0 auto !important;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureLogo(container) {
    if (!container) return;
    let image = container.querySelector('img[data-panthorium-logo]');
    if (!image) {
      image = document.createElement('img');
      image.dataset.panthoriumLogo = '';
      image.src = logo;
      image.alt = 'Panthorium';
      container.replaceChildren(image);
    }
    if (image.getAttribute('src') !== logo) image.src = logo;
    image.draggable = false;
    container.classList.add('panthorium-logo-frame');
  }

  function applyBranding() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    installLogoStyles();
    // Use the approved artwork inside the existing circular shell frames.
    document.querySelectorAll('.login-avatar, .sm-avatar, .about-logo, [data-panthorium-logo-frame]')
      .forEach(ensureLogo);
  }

  applyBranding();
  const observer = new MutationObserver(applyBranding);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(applyBranding, 1000);
  window.PanthoriumBranding = { refresh: applyBranding, logoUrl };
})();
