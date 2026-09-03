(function () {
  'use strict';

  function hideDesktopSurface() {
    var desktopIcons = document.getElementById('desktop-icons');
    if (desktopIcons && desktopIcons.style.display !== 'none') desktopIcons.style.display = 'none';

    var taskbarLogout = document.getElementById('btn-session-logout');
    if (taskbarLogout && taskbarLogout.style.display !== 'none') taskbarLogout.style.display = 'none';
  }

  function keepStartMenuLogout() {
    var logout = document.getElementById('btn-logout');
    if (logout) {
      if (logout.style.display === 'none') logout.style.display = '';
      if (logout.textContent !== '🚪 ออกจากระบบ') logout.textContent = '🚪 ออกจากระบบ';
      if (logout.title !== 'ออกจากระบบ') logout.title = 'ออกจากระบบ';
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

  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', function () { setTimeout(sync, 150); });
  window.addEventListener('panthorium:auth-changed', sync);
  document.addEventListener('DOMContentLoaded', sync, { once: true });

  // Avoid observing the entire DOM. The previous observer changed logout textContent
  // from inside its own callback, creating a recursive MutationObserver loop that
  // starved timers and froze the boot sequence at the first step.
  setInterval(sync, 1500);
  setTimeout(sync, 0);
})();