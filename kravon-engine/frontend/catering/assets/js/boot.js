/**
 * BOOT — catering/boot.js
 * Async initialiser for the Catering product.
 */

(async () => {
  'use strict';

  document.body.setAttribute('data-loading', 'true');

  try {
    await KravonAPI.loadConfig();

    if (typeof window.initBehaviour === 'function') window.initBehaviour();

    document.body.removeAttribute('data-loading');
  } catch (err) {
    console.error('[kravon] Failed to load config:', err.message);
    document.body.setAttribute('data-error', 'true');
  }
})();
