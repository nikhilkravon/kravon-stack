/**
 * BOOT — tables/boot.js
 * Async initialiser for the Tables product.
 *
 * Reads the ?table= URL param before anything else.
 * Passes table context to renderer, modal, checkout, and behaviour.
 */

(async () => {
  'use strict';

  document.body.setAttribute('data-loading', 'true');

  try {
    await KravonAPI.loadConfig();

    // Parse table identifier from URL
    // ?table=T4 → dine-in mode, table T4
    // no param  → choice screen (Dine In / Takeaway)
    const urlParams  = new URLSearchParams(window.location.search);
    const tableParam = urlParams.get('table');  // "T4" | null

    window.TABLE_CONTEXT = {
      tableIdentifier: tableParam || null,
      isDineIn:        !!tableParam,
    };

    if (typeof TablesCart !== 'undefined' && typeof TablesCart.init === 'function') {
      TablesCart.init();
    }
    if (typeof window.initTablesRenderer === 'function') {
      window.initTablesRenderer();
    }
    // Modal init runs after renderer so DOM elements exist
    if (typeof TablesModal !== 'undefined' && typeof TablesModal.init === 'function') {
      TablesModal.init();
    }
    if (typeof TablesCheckout !== 'undefined' && typeof TablesCheckout.init === 'function') {
      TablesCheckout.init();
    }
    if (typeof window.initTablesBehaviour === 'function') {
      window.initTablesBehaviour();
    }

    document.body.removeAttribute('data-loading');
  } catch (err) {
    console.error('[kravon:tables] Failed to load config:', err.message);
    document.body.setAttribute('data-error', 'true');
  }
})();
