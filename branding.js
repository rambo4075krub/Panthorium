(() => {
  const logo = '/panthorium-logo.svg';

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
      .sm-avatar > img[data-panthorium-logo] {
        width: 130% !important;
        height: 130% !important;
        max-width: none !important;
        max-height: none !important;
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
    container.classList.add('panthorium-logo-frame');
  }

  function applyBranding() {
    installLogoStyles();
    // The SVG owns its circular border, interior color and transparent outer area.
    document.querySelectorAll('.login-avatar, .sm-avatar, .about-logo, [data-panthorium-logo-frame]')
      .forEach(ensureLogo);
  }

  applyBranding();
  const observer = new MutationObserver(applyBranding);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(applyBranding, 1000);
  window.PanthoriumBranding = { refresh: applyBranding };
})();
