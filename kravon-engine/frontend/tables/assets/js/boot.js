/**
 * BOOT — tables/boot.js
 * Async initialiser for the Tables product.
 *
 * URL param: ?table_id=<uuid>  — dine-in mode, specific table
 * No param                     — choice screen (Dine In / Takeaway)
 *
 * On dine-in arrival the boot sequence:
 *   1. Load config (sets window.CONFIG)
 *   2. Override window.MENU with categories (tables renderer needs categorised shape)
 *   3. Parse ?table_id UUID
 *   4. Call GET /dine-in/session/status to get session_id + table_name
 *   5. Set window.TABLE_CONTEXT and init all modules
 */

(async () => {
  'use strict';

  document.body.setAttribute('data-loading', 'true');

  try {
    await KravonAPI.loadConfig();

    // Tables renderer needs categorised menu — override the flat-items default
    window.MENU = window.CONFIG.categories || [];

    // Parse table UUID from URL
    const urlParams    = new URLSearchParams(window.location.search);
    const tableIdParam = urlParams.get('table_id');

    window.TABLE_CONTEXT = {
      tableId:   tableIdParam || null,  // UUID
      tableName: null,                  // e.g. "T1" — set after session check
      sessionId: null,                  // UUID — set after session check
      isDineIn:  !!tableIdParam,
    };

    // If arriving from a QR, fetch the active session
    if (tableIdParam) {
      try {
        const status = await KravonAPI.getDineInSessionStatus(tableIdParam);
        if (status.open) {
          window.TABLE_CONTEXT.sessionId = status.session_id;
          window.TABLE_CONTEXT.tableName = status.table_name;
        }
      } catch (err) {
        console.warn('[kravon:tables] Session check failed:', err.message);
      }
    }

    if (typeof TablesCart !== 'undefined' && typeof TablesCart.init === 'function') {
      TablesCart.init();
    }
    if (typeof window.initTablesRenderer === 'function') {
      window.initTablesRenderer();
    }
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
    console.error('[kravon:tables] Failed to boot:', err.message);
    document.body.setAttribute('data-error', 'true');
  }
})();
