/* ═══════════════════════════════════════════════════════════
   PRESENCE — BEHAVIOUR.JS
   Minimal interaction layer. No cart, no commerce.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  window.initBehaviour = function () {
    // Smooth-scroll for any in-page anchor clicks
    document.addEventListener('click', function (e) {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

})();
