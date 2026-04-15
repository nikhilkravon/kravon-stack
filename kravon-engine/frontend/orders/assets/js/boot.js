/**
 * BOOT — orders/boot.js
 * Async initialiser for the Orders product.
 * See presence/boot.js for explanation of the V7 → API migration.
 */

(async () => {
  'use strict';

  document.body.setAttribute('data-loading', 'true');

  try {
    await KravonAPI.loadConfig();

    if (typeof Cart !== 'undefined' && typeof Cart.init === 'function') {
      Cart.init();
    }
    if (typeof window.initRenderer === 'function') window.initRenderer();
    if (typeof Checkout !== 'undefined' && typeof Checkout.init === 'function') {
      Checkout.init();
    }
    if (typeof window.initBehaviour === 'function') window.initBehaviour();

    document.body.removeAttribute('data-loading');
  } catch (err) {
    console.error('[kravon] Failed to load config:', err.message);
    document.body.setAttribute('data-error', 'true');
  }
})();
