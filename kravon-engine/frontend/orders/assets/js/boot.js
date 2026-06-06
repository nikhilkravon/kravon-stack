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

    // Orders renderer and behaviour need categorised menu; override the flat array kravon-api set
    window.CATEGORIES = window.CONFIG.categories || [];
    window.MENU = window.CATEGORIES;

    // Operating hours gate
    if (window.CONFIG.hours?.acceptsOrders === false) {
      document.body.removeAttribute('data-loading');
      const hoursText = window.CONFIG.hours.display || window.CONFIG.hours.openUntil || '';
      document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                    background:#0d0d0d;font-family:system-ui,sans-serif;padding:24px;text-align:center">
          <div>
            <div style="font-size:40px;margin-bottom:16px">🌙</div>
            <h1 style="color:#f0e8d5;font-size:20px;font-weight:700;margin:0 0 8px">We're currently closed</h1>
            ${hoursText ? `<p style="color:rgba(255,255,255,0.45);font-size:14px;margin:0 0 4px;line-height:1.5">${hoursText}</p>` : ''}
            <p style="color:rgba(255,255,255,0.3);font-size:13px;margin:0;line-height:1.5">Come back during opening hours to place your order.</p>
          </div>
        </div>`;
      return;
    }

    if (typeof Cart !== 'undefined' && typeof Cart.init === 'function') Cart.init();
    if (typeof window.initRenderer  === 'function') window.initRenderer();
    if (typeof Checkout !== 'undefined' && typeof Checkout.init === 'function') Checkout.init();
    if (typeof window.initBehaviour === 'function') window.initBehaviour();

    document.body.removeAttribute('data-loading');
  } catch (err) {
    console.error('[kravon] Failed to load config:', err.message);
    document.body.setAttribute('data-error', 'true');
  }
})();
