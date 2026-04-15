/* ═══════════════════════════════════════════════════════════
   MAIN.JS — Boot sequence.
   Renderer mounts synchronously, so DOM is ready by the
   time this script executes. We still guard with setTimeout(0)
   to match the original timing behaviour.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function boot() {
    if (typeof window.initBehaviour === 'function') {
      window.initBehaviour();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
  } else {
    setTimeout(boot, 0);
  }

})();
