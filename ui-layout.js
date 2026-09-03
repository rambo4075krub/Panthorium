(function () {
  'use strict';

  function installStyle() {
    if (document.getElementById('panthorium-ui-layout-style')) return;
    var style = document.createElement('style');
    style.id = 'panthorium-ui-layout-style';
    style.textContent = [
      '#desktop-icons{display:none!important;}',
      '#btn-session-logout{display:none!important;}',
      '#start-menu{max-height:min(82vh,720px);overflow:hidden;}',
      '#sm-apps{overflow-y:auto;}',
      '@media (max-width:600px){#start-menu{width:calc(100% - 20px);max-height:78vh;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function keepLogoutInStartMenuOnly() {
    var taskbarLogout = document.getElementById('btn-session-logout');
    if (taskbarLogout) taskbarLogout.style.display = 'none';

    var startLogout = document.getElementById('btn-logout');
    if (startLogout) {
      startLogout.style.display = '';
      startLogout.textContent = '🚪 ออกจากระบบ';
      startLogout.title = 'ออกจากระบบ';
    }
  }

  function clearDesktopIcons() {
    var desktopIcons = document.getElementById('desktop-icons');
    if (!desktopIcons) return;
    while (desktopIcons.firstChild) desktopIcons.removeChild(desktopIcons.firstChild);
  }

  function fitSphere() {
    try {
      if (typeof camera === 'undefined' || !camera || typeof renderer === 'undefined' || !renderer) return;
      var w = Math.max(1, window.innerWidth);
      var h = Math.max(1, window.innerHeight);
      var radius = 90;
      var margin = 1.18;
      var vFov = (camera.fov || 45) * Math.PI / 180;
      var aspect = w / h;
      var halfVFov = vFov / 2;
      var halfHFov = Math.atan(Math.tan(halfVFov) * aspect);
      var limitingHalfFov = Math.min(halfVFov, halfHFov);
      var distance = (radius * margin) / Math.tan(limitingHalfFov);

      camera.aspect = aspect;
      camera.position.set(0, 0, distance);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      if (renderer.setPixelRatio) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch (error) {
      console.warn('[Panthorium UI] sphere fit skipped:', error.message);
    }
  }

  function sync() {
    installStyle();
    clearDesktopIcons();
    keepLogoutInStartMenuOnly();
    fitSphere();
  }

  window.addEventListener('resize', fitSphere);
  window.addEventListener('orientationchange', function () { setTimeout(fitSphere, 150); });
  window.addEventListener('panthorium:auth-changed', function () { setTimeout(sync, 0); });

  var observer = new MutationObserver(function () {
    clearDesktopIcons();
    keepLogoutInStartMenuOnly();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(sync, 1200);
  setTimeout(sync, 0);
  setTimeout(fitSphere, 800);
  setTimeout(fitSphere, 1800);

  window.PanthoriumUILayout = { sync: sync, fitSphere: fitSphere };
})();