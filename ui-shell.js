(function () {
  'use strict';

  function hideDesktopSurface() {
    var desktopIcons = document.getElementById('desktop-icons');
    if (desktopIcons) desktopIcons.style.display = 'none';

    var taskbarLogout = document.getElementById('btn-session-logout');
    if (taskbarLogout) taskbarLogout.style.display = 'none';
  }

  function keepStartMenuLogout() {
    var logout = document.getElementById('btn-logout');
    if (logout) {
      logout.style.display = '';
      logout.textContent = '🚪 ออกจากระบบ';
      logout.title = 'ออกจากระบบ';
    }
  }

  function patchThreeRenderer() {
    if (!window.THREE || !THREE.WebGLRenderer || THREE.WebGLRenderer.prototype.__panthoriumResponsivePatched) return;

    var proto = THREE.WebGLRenderer.prototype;
    var originalRender = proto.render;
    proto.__panthoriumResponsivePatched = true;

    proto.render = function (scene, camera) {
      try {
        if (camera && camera.isPerspectiveCamera) {
          var width = Math.max(window.innerWidth || 1, 1);
          var height = Math.max((window.innerHeight || 1) - 48, 1);
          var aspect = width / height;
          var vHalf = (camera.fov || 45) * Math.PI / 360;
          var hHalf = Math.atan(Math.tan(vHalf) * aspect);
          var limitingHalf = Math.max(0.12, Math.min(vHalf, hHalf));
          var radius = 92;
          var distance = (radius / Math.sin(limitingHalf)) * 1.12;

          var x = camera.position.x;
          var y = camera.position.y;
          var z = camera.position.z;
          var length = Math.sqrt(x*x + y*y + z*z) || 1;
          camera.position.set((x / length) * distance, (y / length) * distance, (z / length) * distance);
          camera.aspect = aspect;
          camera.updateProjectionMatrix();
          camera.lookAt(0, 0, 0);
        }
      } catch (e) {}
      return originalRender.call(this, scene, camera);
    };
  }

  function sync() {
    hideDesktopSurface();
    keepStartMenuLogout();
    patchThreeRenderer();
  }

  var observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', function () { setTimeout(sync, 150); });
  window.addEventListener('panthorium:auth-changed', sync);
  setInterval(sync, 1000);
  setTimeout(sync, 0);
})();