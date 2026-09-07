(function () {
  'use strict';

  var completed = false;

  function finishBoot(reason) {
    if (completed) return;
    try {
      if (typeof OS === 'undefined' || !OS || !OS.state) return;
      if (OS.state.booted) {
        completed = true;
        return;
      }

      completed = true;
      var bootScreen = document.getElementById('boot-screen');
      var loginScreen = document.getElementById('login-screen');
      var desktop = document.getElementById('desktop');
      var bar = document.getElementById('boot-bar');
      var status = document.getElementById('boot-status');

      if (bar) bar.style.width = '100%';
      if (status) status.textContent = 'พร้อมใช้งาน';
      if (bootScreen) {
        bootScreen.classList.add('hidden');
        bootScreen.style.display = 'none';
      }

      OS.state.booted = true;
      OS.state.loggedIn = false;
      OS.state.verified = false;

      // Build desktop once so background/window infrastructure is ready.
      try {
        if (typeof initDesktop === 'function') initDesktop();
      } catch (error) {
        console.warn('[Boot Recovery] initDesktop:', error.message);
      }

      // Phase 2 authentication owns the final login/desktop state.
      if (loginScreen) {
        loginScreen.style.display = 'flex';
        loginScreen.classList.add('active');
      }
      if (desktop) desktop.classList.remove('active');

      window.dispatchEvent(new CustomEvent('panthorium:boot-recovered', { detail: { reason: reason || 'watchdog' } }));
      console.warn('[Panthorium] Boot watchdog recovered a stalled boot sequence.');
    } catch (error) {
      console.error('[Boot Recovery]', error);
    }
  }

  function monitor() {
    try {
      if (typeof OS !== 'undefined' && OS && OS.state && OS.state.booted) {
        completed = true;
        return;
      }
    } catch (_) {}
    finishBoot('timeout');
  }

  // The native boot normally completes in about 2 seconds. Five seconds is ample
  // while still recovering immediately from a stalled timer/runtime condition.
  setTimeout(monitor, 5000);
})();