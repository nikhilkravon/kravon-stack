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
 *   4. GET /dine-in/boot — unified call: session status + existing orders
 *   5a. If existing orders → show re-entry screen (customer reloaded mid-session)
 *   5b. Otherwise → show guest identity popup
 *   6. Set window.TABLE_CONTEXT and init all modules
 */

(async () => {
  'use strict';

  document.body.setAttribute('data-loading', 'true');

  try {
    await KravonAPI.loadConfig('dine_in');

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

    // If arriving from a QR, fetch the active session + existing orders in one call
    if (tableIdParam) {
      let boot = null;
      try {
        boot = await KravonAPI.getDineInBoot(tableIdParam);
      } catch (err) {
        console.warn('[kravon:tables] Boot failed:', err.message);
        document.body.removeAttribute('data-loading');
        _showErrorWall('Could not reach the restaurant system. Check your connection and try again.');
        return;
      }

      if (!boot.open) {
        document.body.removeAttribute('data-loading');
        _showNotOpenWall(tableIdParam, boot.table_name);
        return;
      }

      window.TABLE_CONTEXT.sessionId      = boot.session.session_id;
      window.TABLE_CONTEXT.tableName      = boot.session.table_name;
      window.TABLE_CONTEXT.billRequested  = boot.session.bill_requested;
      window.TABLE_CONTEXT.sessionStatus  = boot.session.session_status;
      window.TABLE_CONTEXT.existingOrders = boot.orders || [];
      window.TABLE_CONTEXT.hasBillOwner   = boot.session.has_bill_owner;
      window.TABLE_CONTEXT.billOwnerName  = boot.session.bill_owner_name;

      // Try to restore saved identity from localStorage for this session
      const savedIdentity = _loadIdentity(
        window.CONFIG.slug,
        window.TABLE_CONTEXT.sessionId
      );

      if (savedIdentity) {
        // Returning guest — restore identity silently
        window.TABLE_CONTEXT.guestName  = savedIdentity.name;
        window.TABLE_CONTEXT.guestPhone = savedIdentity.phone;

        // If they had active orders, show re-entry screen instead of empty menu
        if (window.TABLE_CONTEXT.existingOrders.length > 0) {
          await _showReentryScreen();
        }
        // Otherwise fall through to the normal ordering screen (cart may restore from localStorage)
      } else if (window.TABLE_CONTEXT.hasBillOwner) {
        // Another guest already started this session — show join screen
        await _showJoinScreen();
        _saveIdentity(
          window.CONFIG.slug,
          window.TABLE_CONTEXT.sessionId,
          window.TABLE_CONTEXT.guestName,
          window.TABLE_CONTEXT.guestPhone
        );
      } else {
        // First customer — becomes the bill owner
        await _showGuestPopup();
        _saveIdentity(
          window.CONFIG.slug,
          window.TABLE_CONTEXT.sessionId,
          window.TABLE_CONTEXT.guestName,
          window.TABLE_CONTEXT.guestPhone
        );
      }
    }

    if (typeof TablesCart !== 'undefined' && typeof TablesCart.init === 'function') {
      TablesCart.init();
    }

    // Restore persisted cart for this session (before renderer so button states reflect qty)
    if (tableIdParam && window.TABLE_CONTEXT.sessionId) {
      TablesCart.restore(window.CONFIG.slug, window.TABLE_CONTEXT.sessionId);
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

  /* ── Session not open wall ──────────────────────────────────────────────── */
  function _showNotOpenWall(tableId, tableName) {
    let _notified = false;

    const wall = document.createElement('div');
    wall.id = 'not-open-wall';
    wall.innerHTML = `
      <div class="not-open-inner">
        <div class="not-open-icon">🍽</div>
        <div class="not-open-table">${tableName ? Kravon.esc(tableName) : 'Your Table'}</div>
        <h1 class="not-open-title">This table isn't active yet</h1>
        <p class="not-open-sub">Your session hasn't been opened. Tap below to alert your waiter — they'll be with you shortly.</p>
        <button id="notifyStaffBtn" class="not-open-btn not-open-btn--primary">
          Notify Staff
        </button>
        <button class="not-open-btn not-open-btn--secondary" onclick="location.reload()">
          Try Again
        </button>
        <div class="not-open-note" id="notifyNote" aria-live="polite"></div>
      </div>`;

    document.body.innerHTML = '';
    document.body.appendChild(wall);

    document.getElementById('notifyStaffBtn').addEventListener('click', async function () {
      if (_notified) return;
      this.disabled = true;
      this.textContent = 'Notifying…';
      const noteEl = document.getElementById('notifyNote');
      try {
        await KravonAPI.notifyStaffTableReady(tableId);
        _notified = true;
        this.textContent = 'Staff Notified ✓';
        this.classList.add('not-open-btn--notified');
        if (noteEl) noteEl.textContent = 'Your waiter has been alerted. Please wait a moment.';
      } catch (_) {
        this.disabled = false;
        this.textContent = 'Notify Staff';
        if (noteEl) noteEl.textContent = 'Could not send alert. Please ask your waiter directly.';
      }
    });
  }

  /* ── Generic error wall ─────────────────────────────────────────────────── */
  function _showErrorWall(message) {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                  background:#0d0d0d;font-family:system-ui,sans-serif;padding:24px;text-align:center">
        <div>
          <div style="font-size:40px;margin-bottom:16px">⚠️</div>
          <p style="color:rgba(255,255,255,0.45);font-size:14px;margin:0 0 24px;line-height:1.5">
            ${Kravon.esc(message)}
          </p>
          <button onclick="location.reload()"
            style="background:#c8a96e;color:#111;border:none;border-radius:8px;
                   padding:12px 24px;font-size:15px;font-weight:600;cursor:pointer">
            Try Again
          </button>
        </div>
      </div>`;
  }

  /* ── Second-customer join screen ────────────────────────────────────────── */
  function _showJoinScreen() {
    return new Promise((resolve) => {
      const TC        = window.TABLE_CONTEXT;
      const tableName = TC.tableName || 'Your Table';
      const brand     = window.CONFIG?.brand?.name || '';
      const ownerHint = TC.billOwnerName ? `${Kravon.esc(TC.billOwnerName)}'s table` : 'This table';

      const overlay = document.createElement('div');
      overlay.id = 'join-overlay';
      overlay.innerHTML = `
        <div id="join-popup">
          ${brand ? `<div class="guest-popup-brand">${Kravon.esc(brand)}</div>` : ''}
          <div class="join-icon">🍽</div>
          <h2 class="join-title">${Kravon.esc(tableName)} Active</h2>
          <p class="join-sub">${ownerHint} is currently open. Join to browse and order.</p>
          <button id="joinTableBtn" class="guest-popup-btn">Join Table</button>
        </div>`;

      document.body.appendChild(overlay);

      overlay.querySelector('#joinTableBtn').addEventListener('click', () => {
        overlay.remove();
        // Collect guest identity after confirming join
        _showGuestPopup().then(resolve);
      });
    });
  }

  /* ── Guest identity popup ───────────────────────────────────────────────── */
  function _showGuestPopup() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'guest-popup-overlay';
      overlay.innerHTML = `
        <div id="guest-popup">
          <div class="guest-popup-brand">${window.CONFIG?.brand?.name || 'Welcome'}</div>
          <h2 class="guest-popup-title">${window.TABLE_CONTEXT.tableName || 'Your Table'}</h2>
          <p class="guest-popup-sub">Enter your details to start ordering</p>
          <div class="guest-popup-field">
            <label for="guestName">Your Name</label>
            <input id="guestName" type="text" placeholder="e.g. Priya" autocomplete="given-name" maxlength="100">
            <span class="guest-popup-err" id="guestNameErr"></span>
          </div>
          <div class="guest-popup-field">
            <label for="guestPhone">Phone Number</label>
            <input id="guestPhone" type="tel" placeholder="e.g. 9876543210" autocomplete="tel" maxlength="20">
            <span class="guest-popup-err" id="guestPhoneErr"></span>
          </div>
          <button id="guestPopupBtn" class="guest-popup-btn">View Menu</button>
        </div>`;

      document.body.appendChild(overlay);

      const nameEl  = overlay.querySelector('#guestName');
      const phoneEl = overlay.querySelector('#guestPhone');
      const btn     = overlay.querySelector('#guestPopupBtn');
      const nameErr = overlay.querySelector('#guestNameErr');
      const phErr   = overlay.querySelector('#guestPhoneErr');

      nameEl.focus();

      btn.addEventListener('click', () => {
        nameErr.textContent = '';
        phErr.textContent   = '';

        const name  = nameEl.value.trim();
        const phone = phoneEl.value.trim().replace(/\s+/g, '');
        let valid   = true;

        if (!name) {
          nameErr.textContent = 'Please enter your name';
          nameEl.focus();
          valid = false;
        }
        if (!phone || !/^\+?[0-9]{10,15}$/.test(phone)) {
          phErr.textContent = 'Please enter a valid phone number';
          if (valid) phoneEl.focus();
          valid = false;
        }
        if (!valid) return;

        window.TABLE_CONTEXT.guestName  = name;
        window.TABLE_CONTEXT.guestPhone = phone;

        overlay.remove();
        resolve();
      });

      [nameEl, phoneEl].forEach(el => {
        el.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
      });
    });
  }

  /* ── Re-entry screen — shown when reload detects existing orders ─────────── */
  function _showReentryScreen() {
    return new Promise((resolve) => {
      const TC        = window.TABLE_CONTEXT;
      const tableName = TC.tableName || 'Your Table';
      const orders    = TC.existingOrders || [];

      // Aggregate items across all orders for the summary
      const totals = new Map();
      for (const order of orders) {
        for (const item of (order.items || [])) {
          totals.set(item.name, (totals.get(item.name) || 0) + item.qty);
        }
      }
      const itemRows = [...totals.entries()].map(([name, qty]) =>
        `<div class="reentry-item-row">
           <span class="reentry-item-qty">${qty}×</span>
           <span class="reentry-item-name">${Kravon.esc(name)}</span>
         </div>`
      ).join('');

      const overlay = document.createElement('div');
      overlay.id = 'reentry-overlay';
      overlay.innerHTML = `
        <div id="reentry-popup">
          <div class="reentry-icon">🍽</div>
          <div class="reentry-table">${Kravon.esc(tableName)}</div>
          <h2 class="reentry-title">You have active orders</h2>
          <p class="reentry-sub">Welcome back, ${Kravon.esc(TC.guestName)}. Your table session is still open.</p>
          ${itemRows ? `<div class="reentry-items">${itemRows}</div>` : ''}
          <div class="reentry-actions">
            <button id="reentryViewOrders" class="reentry-btn reentry-btn--primary">View Current Orders</button>
            <button id="reentryOrderMore"  class="reentry-btn reentry-btn--secondary">Continue Ordering</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      overlay.querySelector('#reentryViewOrders').addEventListener('click', () => {
        TC._reentryChoice = 'confirm';
        overlay.remove();
        resolve();
      });

      overlay.querySelector('#reentryOrderMore').addEventListener('click', () => {
        TC._reentryChoice = 'ordering';
        overlay.remove();
        resolve();
      });
    });
  }

  /* ── Identity persistence ───────────────────────────────────────────────── */
  function _identityKey(slug, sessionId) {
    return `kravon:guest:${slug}:${sessionId}`;
  }

  function _saveIdentity(slug, sessionId, name, phone) {
    try {
      localStorage.setItem(_identityKey(slug, sessionId), JSON.stringify({ name, phone }));
    } catch (_) {}
  }

  function _loadIdentity(slug, sessionId) {
    try {
      const raw = localStorage.getItem(_identityKey(slug, sessionId));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj.name && obj.phone) ? obj : null;
    } catch (_) { return null; }
  }
})();
