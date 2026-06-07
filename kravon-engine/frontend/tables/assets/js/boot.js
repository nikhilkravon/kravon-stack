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
 *   5. Show guest identity popup (every scanner captures name + phone)
 *   6. Set window.TABLE_CONTEXT and init all modules
 */

(async () => {
  'use strict';

  document.body.setAttribute('data-loading', 'true');

  try {
    await KravonAPI.loadConfig();

    // Tables renderer needs categorised menu — override the flat-items default
    window.MENU = window.CONFIG.categories || [];

    // Operating hours gate — if restaurant has explicitly closed ordering, show a wall
    if (window.CONFIG.hours?.acceptsOrders === false) {
      document.body.removeAttribute('data-loading');
      const hoursText = window.CONFIG.hours.display || window.CONFIG.hours.openUntil || '';
      document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                    background:#0d0d0d;font-family:system-ui,sans-serif;padding:24px;text-align:center">
          <div>
            <div style="font-size:40px;margin-bottom:16px">🌙</div>
            <h1 style="color:#f0e8d5;font-size:20px;font-weight:700;margin:0 0 8px">
              We're currently closed
            </h1>
            ${hoursText ? `<p style="color:rgba(255,255,255,0.45);font-size:14px;margin:0 0 4px;line-height:1.5">${hoursText}</p>` : ''}
            <p style="color:rgba(255,255,255,0.3);font-size:13px;margin:0;line-height:1.5">
              Come back during opening hours to place your order.
            </p>
          </div>
        </div>`;
      return;
    }

    // Parse table UUID from URL
    const urlParams    = new URLSearchParams(window.location.search);
    const tableIdParam = urlParams.get('table_id');

    window.TABLE_CONTEXT = {
      tableId:    tableIdParam || null,
      tableName:  null,
      sessionId:  null,
      isDineIn:   !!tableIdParam,
      guestName:  null,
      guestPhone: null,
    };

    // If arriving from a QR, fetch the active session
    if (tableIdParam) {
      let sessionError = null;
      try {
        const status = await KravonAPI.getDineInSessionStatus(tableIdParam);
        if (status.open) {
          window.TABLE_CONTEXT.sessionId   = status.session_id;
          window.TABLE_CONTEXT.tableName   = status.table_name;
          window.TABLE_CONTEXT.billRequested = status.bill_requested;
        } else {
          sessionError = 'not-open';
        }
      } catch (err) {
        console.warn('[kravon:tables] Session check failed:', err.message);
        sessionError = 'fetch-failed';
      }

      if (sessionError) {
        document.body.removeAttribute('data-loading');
        document.body.innerHTML = `
          <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                      background:#0d0d0d;font-family:system-ui,sans-serif;padding:24px;text-align:center">
            <div>
              <div style="font-size:40px;margin-bottom:16px">🪑</div>
              <h1 style="color:#f0e8d5;font-size:20px;font-weight:700;margin:0 0 8px">
                This table isn't active yet
              </h1>
              <p style="color:rgba(255,255,255,0.45);font-size:14px;margin:0 0 24px;line-height:1.5">
                Ask your waiter to open your table's session, then scan the QR code again.
              </p>
              <button onclick="location.reload()"
                style="background:#c8a96e;color:#111;border:none;border-radius:8px;
                       padding:12px 24px;font-size:15px;font-weight:600;cursor:pointer">
                Try Again
              </button>
            </div>
          </div>`;
        return;
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
