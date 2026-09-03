/* ═══════════════════════════════════════════════════════════
   TABLES — BEHAVIOUR.JS
   Single event delegation layer for all user interactions.
   Never touches business logic — delegates to TablesCart,
   TablesRenderer, TablesCheckout, and TablesModal.
   ═══════════════════════════════════════════════════════════ */

function initTablesBehaviour() {
  'use strict';

  function _findMenuItem(id) {
    for (const cat of (window.MENU || [])) {
      const item = cat.items.find(i => String(i.id) === String(id));
      if (item) return item;
    }
    return null;
  }

  function _saveCart() {
    const TC = window.TABLE_CONTEXT;
    if (TC?.isDineIn && TC.sessionId && window.CONFIG?.slug) {
      TablesCart.save(window.CONFIG.slug, TC.sessionId);
    }
  }

  /* ── Cart open/close ──────────────────────────────────────── */
  function openCart() {
    const drawer  = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');
    TablesRenderer.renderCartDrawer();
    if (drawer)  { drawer.style.display = ''; drawer.setAttribute('aria-hidden', 'false'); }
    if (overlay) { overlay.style.display = ''; overlay.setAttribute('aria-hidden', 'false'); }
    document.body.style.overflow = 'hidden';
    drawer?.querySelector('.cart-close-btn')?.focus();
  }

  function closeCart() {
    const drawer  = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');
    if (drawer?.contains(document.activeElement)) document.activeElement.blur();
    if (drawer)  { drawer.style.display = 'none'; drawer.setAttribute('aria-hidden', 'true'); }
    if (overlay) { overlay.style.display = 'none'; overlay.setAttribute('aria-hidden', 'true'); }
    document.body.style.overflow = '';
  }

  /* ── Mobile cart label: first item name ──────────────────── */
  function _updateMobileCartLabel() {
    const labelEl = document.getElementById('mobileCartLabel');
    if (!labelEl) return;
    const items = TablesCart.getItems();
    const count = items.reduce((sum, i) => sum + i.qty, 0);
    if (items.length > 0) {
      const firstName = items[0].name.length > 18
        ? items[0].name.slice(0, 17) + '…'
        : items[0].name;
      const extra = count > 1 ? ` +${count - 1}` : '';
      labelEl.textContent = firstName + extra;
    } else {
      labelEl.textContent = 'items in order';
    }
  }

  /* ── Category sheet open/close ───────────────────────────── */
  function openCatSheet() {
    const sheet   = document.getElementById('catSheet');
    const overlay = document.getElementById('catSheetOverlay');
    const list    = document.getElementById('catSheetList');

    // Populate list from MENU (skip empty categories, matching the main grid)
    if (list && window.MENU) {
      list.innerHTML = window.MENU.filter(cat => (cat.items || []).length > 0).map(cat => `
        <button class="cat-sheet-item" data-action="jump-to-cat"
                data-cat-id="${Kravon.esc(cat.id)}"
                aria-label="Go to ${Kravon.esc(cat.name)}">
          <span>${Kravon.esc(cat.name)}</span>
          <span class="cat-sheet-item-count">${cat.items.length} items</span>
        </button>`).join('');
    }

    if (sheet)   { sheet.classList.add('open');   sheet.setAttribute('aria-hidden', 'false'); }
    if (overlay) { overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false'); }
    document.body.style.overflow = 'hidden';
  }

  function closeCatSheet() {
    const sheet   = document.getElementById('catSheet');
    const overlay = document.getElementById('catSheetOverlay');
    if (sheet)   { sheet.classList.remove('open');   sheet.setAttribute('aria-hidden', 'true'); }
    if (overlay) { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); }
    document.body.style.overflow = '';
  }

  /* ── Show/hide FAB based on current screen ───────────────── */
  function _syncFab(screenId) {
    const fab = document.getElementById('catFab');
    if (!fab) return;
    if (screenId === 'screenOrdering' && window.innerWidth <= 768) {
      fab.classList.add('visible');
    } else {
      fab.classList.remove('visible');
    }
  }

  /* ── Category scroll ─────────────────────────────────────── */
  function scrollToCategory(catId) {
    const section = document.getElementById(`cat_${catId}`);
    if (!section) return;
    const navH  = document.querySelector('.tables-nav')?.offsetHeight || 60;
    // Only subtract cat-sidebar height on mobile (where it's a horizontal sticky bar).
    // On desktop the sidebar is a column — its height is irrelevant to scroll offset.
    const isMobile = window.innerWidth <= 768;
    const catH  = isMobile ? (document.querySelector('.cat-sidebar')?.offsetHeight || 0) : 0;
    const top = section.getBoundingClientRect().top + window.scrollY - navH - catH - 12;
    window.scrollTo({ top, behavior: 'smooth' });
    document.querySelectorAll('.cat-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.catId === String(catId));
    });
  }

  /* ── Main event delegator ────────────────────────────────── */
  document.body.addEventListener('click', function (e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    switch (action) {

      /* ── Dining choice ── */
      case 'choose-dining': {
        const mode = target.dataset.mode;
        if (mode === 'dine-in') {
          window.TABLE_CONTEXT.isDineIn = true;
          window.TABLE_CONTEXT.tableIdentifier = 'counter';
        } else {
          window.TABLE_CONTEXT.isDineIn = false;
          window.TABLE_CONTEXT.tableIdentifier = 'takeaway';
        }
        TablesRenderer.showScreen('screenOrdering');
        break;
      }

      /* ── Simple add (non-customisable items) ── */
      case 'add-item': {
        const id   = target.dataset.itemId;
        const item = _findMenuItem(id);
        if (!item) return;
        TablesCart.addItem(id, item.name, item.price);
        _saveCart();
        TablesRenderer.updateItemBtn(id);
        TablesRenderer.renderCartDrawer();
        _updateMobileCartLabel();
        Kravon.toast(`${item.name} added`);
        break;
      }

      /* ── Open customisation modal ── */
      case 'open-modal': {
        TablesModal.open(target.dataset.itemId);
        break;
      }

      /* ── Edit item in cart ── */
      case 'edit-cart-item': {
        TablesModal.openEdit(parseInt(target.dataset.idx, 10));
        break;
      }

      /* ── Modal: close ── */
      case 'tables-close-modal':
        TablesModal.close();
        break;

      /* ── Modal: qty ── */
      case 'tables-modal-qty-dec':
        TablesModal.decQty();
        break;

      case 'tables-modal-qty-inc':
        TablesModal.incQty();
        break;

      /* ── Modal: toggle addon ── */
      case 'tables-toggle-addon':
        TablesModal.toggleAddon(target);
        break;

      /* ── Modal: set spice ── */
      case 'tables-set-spice':
        TablesModal.setSpice(target);
        break;

      /* ── Modal: confirm ── */
      case 'tables-modal-confirm': {
        const confirmedId = TablesModal.confirm();
        if (confirmedId) {
          _saveCart();
          TablesRenderer.updateItemBtn(confirmedId);
          TablesRenderer.renderCartDrawer();
          _updateMobileCartLabel();
          Kravon.toast('Added to order');
        }
        break;
      }

      /* ── Inc/dec from menu grid (non-customisable) ── */
      case 'inc-item': {
        const id    = target.dataset.itemId;
        const items = TablesCart.getItems();
        const idx   = [...items].reverse().findIndex(i => i.id === String(id));
        const realIdx = idx === -1 ? -1 : items.length - 1 - idx;
        if (realIdx !== -1) {
          TablesCart.changeQty(realIdx, 1);
        } else {
          const item = _findMenuItem(id);
          if (item) TablesCart.addItem(id, item.name, item.price);
        }
        _saveCart();
        TablesRenderer.updateItemBtn(id);
        TablesRenderer.renderCartDrawer();
        _updateMobileCartLabel();
        break;
      }

      case 'dec-item': {
        const id    = target.dataset.itemId;
        const items = TablesCart.getItems();
        let idxToRemove = -1;
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].id === String(id)) { idxToRemove = i; break; }
        }
        if (idxToRemove !== -1) TablesCart.changeQty(idxToRemove, -1);
        _saveCart();
        TablesRenderer.updateItemBtn(id);
        TablesRenderer.renderCartDrawer();
        _updateMobileCartLabel();
        break;
      }

      /* ── Cart drawer ── */
      case 'open-cart':
        openCart();
        break;

      case 'close-cart':
        closeCart();
        break;

      /* ── Cart qty ── */
      case 'cart-dec': {
        const idx = parseInt(target.dataset.idx, 10);
        const itemBefore = TablesCart.getItems()[idx];
        TablesCart.changeQty(idx, -1);
        _saveCart();
        if (itemBefore) TablesRenderer.updateItemBtn(itemBefore.id);
        TablesRenderer.renderCartDrawer();
        _updateMobileCartLabel();
        break;
      }

      case 'cart-inc': {
        const idx  = parseInt(target.dataset.idx, 10);
        const item = TablesCart.getItems()[idx];
        if (item) {
          TablesCart.changeQty(idx, 1);
          TablesRenderer.updateItemBtn(item.id);
        }
        _saveCart();
        TablesRenderer.renderCartDrawer();
        _updateMobileCartLabel();
        break;
      }

      /* ── Floating category launcher ── */
      case 'open-cat-sheet':
        openCatSheet();
        break;

      case 'close-cat-sheet':
        closeCatSheet();
        break;

      case 'jump-to-cat': {
        closeCatSheet();
        scrollToCategory(target.dataset.catId);
        break;
      }

      /* ── Go to checkout ── */
      case 'go-checkout': {
        if (!TablesCart.getItems().length) return;
        closeCart();
        TablesRenderer.showScreen('screenCheckout');
        TablesRenderer.renderCheckoutSummary();
        // Reset place-order button — may be disabled from a previous successful order
        const placeBtn = document.getElementById('placeOrderBtn');
        if (placeBtn) { placeBtn.disabled = false; placeBtn.textContent = 'Place Order'; }
        const placeNote = document.getElementById('placeOrderNote');
        if (placeNote) placeNote.textContent = '';
        _syncFab('screenCheckout');
        window.scrollTo(0, 0);
        break;
      }

      /* ── Back to menu ── */
      case 'back-to-menu': {
        const orderingEl = document.getElementById('screenOrdering');
        if (orderingEl && orderingEl.style.display !== 'none') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          history.back();
        }
        break;
      }

      /* ── Place order ── */
      case 'place-order':
        TablesCheckout.placeOrder();
        break;

      /* ── Payment selection ── */
      case 'select-payment':
        TablesCheckout.selectPayment(target);
        break;

      /* ── Scroll to menu category ── */
      case 'scroll-to-cat':
        scrollToCategory(target.dataset.catId);
        break;

      /* ── Bill request (from confirm screen) ── */
      case 'request-bill':
        TablesCheckout.requestBill(target);
        break;

      /* ── Bill request (from menu screen bar) ── */
      case 'request-bill-bar': {
        const TC2 = window.TABLE_CONTEXT;
        if (!TC2.sessionId) break;
        target.disabled = true;
        target.textContent = 'Requesting…';
        KravonAPI.requestDineInBill(TC2.sessionId, TC2.guestName || undefined)
          .then(() => {
            TC2.billRequested = true;
            target.textContent = 'Bill Requested ✓';
            target.classList.add('bill-requested');
            Kravon.toast('Staff has been notified — they\'ll be with you shortly.');
            // sync session-screen button if visible
            const confBtn = document.getElementById('billRequestBtn');
            if (confBtn) {
              confBtn.textContent = 'Bill Requested ✓';
              confBtn.disabled = true;
              confBtn.classList.add('bill-requested');
            }
          })
          .catch(() => {
            target.disabled = false;
            target.textContent = 'Request Bill';
            Kravon.toast('Could not send request. Please try again.');
          });
        break;
      }

      /* ── Star rating ── */
      case 'rate': {
        const stars = parseInt(target.dataset.stars, 10);
        TablesCheckout.handleRating(stars);
        break;
      }

      /* ── Submit feedback ── */
      case 'submit-feedback':
        TablesCheckout.submitFeedback();
        break;

      /* ── Order More (dine-in: return to menu from session screen) ── */
      case 'order-more':
        TablesRenderer.showScreen('screenOrdering');
        window.scrollTo(0, 0);
        _syncFab('screenOrdering');
        break;

      /* ── New order (takeaway) ── */
      case 'new-order':
        TablesCart.clear();
        window.location.reload();
        break;

      case 'expand-card-desc':
        target.classList.toggle('menu-card-desc--expanded');
        break;
    }
  });

  /* ── Overlay click closes cart ─────────────────────────── */
  const overlay = document.getElementById('cartOverlay');
  if (overlay) overlay.addEventListener('click', closeCart);

  /* ── Escape key: close cart or modal ──────────────────── */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      const modal = document.getElementById('tablesCustomModal');
      if (modal && modal.classList.contains('open')) {
        TablesModal.close();
      } else {
        closeCart();
      }
    }
  });

  /* ── Browser back/forward ─────────────────────────────── */
  window.addEventListener('popstate', function (e) {
    const screen = e.state?.screen || 'screenOrdering';
    TablesRenderer.showScreen(screen, false);
    window.scrollTo(0, 0);
  });

  /* ── Category sticky scroll highlighting ───────────────── */
  function updateActiveCat() {
    const sections = document.querySelectorAll('.menu-section');
    const navH = document.querySelector('.tables-nav')?.offsetHeight || 60;
    const offset = navH + 24;

    let activeId = null;
    sections.forEach(s => {
      if (s.getBoundingClientRect().top - offset < 0) activeId = s.id.replace('cat_', '');
    });

    // When at the top (no section has scrolled past), keep first category active
    if (!activeId && sections.length > 0) {
      activeId = sections[0].id.replace('cat_', '');
    }

    document.querySelectorAll('.cat-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.catId === activeId);
    });
  }

  // Seed first category as active on load
  requestAnimationFrame(() => {
    const firstBtn = document.querySelector('.cat-btn');
    if (firstBtn) firstBtn.classList.add('active');
    _syncFab('screenOrdering');
  });

  window.addEventListener('scroll', updateActiveCat, { passive: true });
  window.addEventListener('resize', () => _syncFab(
    document.getElementById('screenOrdering')?.style.display !== 'none' ? 'screenOrdering' : 'other'
  ), { passive: true });

  /* ── Visual viewport: shrink cart drawer when keyboard appears ──── */
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const drawer = document.getElementById('cartDrawer');
      if (!drawer || drawer.getAttribute('aria-hidden') === 'true') return;
      const available = window.visualViewport.height;
      drawer.style.maxHeight = Math.min(available * 0.85, available - 48) + 'px';
    }, { passive: true });
  }

  /* ── Session liveness + live orders poll (dine-in only) ────── */
  const TC = window.TABLE_CONTEXT || {};

  function _fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function _statusLabel(status) {
    const map = { confirmed: 'Confirmed', preparing: 'Preparing', pending: 'Pending', ready: 'Ready' };
    return map[status] || status;
  }

  function _renderOrdersPanel(orders) {
    const panel = document.getElementById('tableOrdersPanel');
    if (!panel) return;

    if (!orders || !orders.length) {
      panel.style.display = 'none';
      return;
    }

    // Aggregate by dish name — no guest attribution shown
    const totals = new Map();
    let latestStatus = 'pending';
    let latestTime   = null;
    for (const order of orders) {
      for (const item of (order.items || [])) {
        totals.set(item.name, (totals.get(item.name) || 0) + item.qty);
      }
      latestStatus = order.status || latestStatus;
      if (!latestTime || order.created_at > latestTime) latestTime = order.created_at;
    }

    const rows = [...totals.entries()].map(([name, qty]) =>
      `<div class="top-order-row">
         <div class="top-order-items">${qty} × ${Kravon.esc(name)}</div>
       </div>`
    ).join('');

    const cls = `top-order-status--${latestStatus}`;
    const timeStr = latestTime ? _fmtTime(latestTime) : '';

    panel.style.display = '';
    panel.innerHTML = `
      <div class="top-panel-header" id="topPanelHeader">
        <span class="top-panel-title">Table Orders</span>
        <span>
          <span class="top-order-status ${cls}">${_statusLabel(latestStatus)}</span>
          ${timeStr ? `<span style="margin-left:4px;font-size:11px">${timeStr}</span>` : ''}
        </span>
        <span class="top-panel-toggle" id="topPanelToggle">Hide</span>
      </div>
      <div class="top-panel-body" id="topPanelBody">${rows}</div>`;

    // Collapse/expand toggle
    const header = panel.querySelector('#topPanelHeader');
    if (header && !header._wired) {
      header._wired = true;
      header.addEventListener('click', () => {
        const body   = document.getElementById('topPanelBody');
        const toggle = document.getElementById('topPanelToggle');
        if (!body) return;
        const collapsed = body.classList.toggle('collapsed');
        if (toggle) toggle.textContent = collapsed ? 'Show' : 'Hide';
      });
    }
  }

  if (TC.isDineIn && TC.tableId) {
    // Initial orders fetch — also primes screenConfirm when re-entering mid-session
    if (TC.sessionId) {
      KravonAPI.getDineInSessionOrders(TC.sessionId)
        .then(d => {
          _renderOrdersPanel(d.orders);
          if (TC._reentryChoice === 'confirm') {
            TablesCheckout.renderSessionOrders(d.orders);
            // Reflect bill-requested state if already set
            if (TC.billRequested) {
              const confBtn = document.getElementById('billRequestBtn');
              if (confBtn) { confBtn.textContent = 'Bill Requested ✓'; confBtn.disabled = true; confBtn.classList.add('bill-requested'); }
            }
          }
        })
        .catch(() => {});
    }

    setInterval(async () => {
      const orderingEl = document.getElementById('screenOrdering');
      const confirmEl  = document.getElementById('screenConfirm');
      const onOrdering = orderingEl && orderingEl.style.display !== 'none';
      const onConfirm  = confirmEl  && confirmEl.style.display  !== 'none';
      if (!onOrdering && !onConfirm) return;
      try {
        const [status, ordersData] = await Promise.all([
          KravonAPI.getDineInSessionStatus(TC.tableId),
          TC.sessionId ? KravonAPI.getDineInSessionOrders(TC.sessionId) : Promise.resolve({ orders: [] }),
        ]);

        if (!status.open) {
          // session_status may carry 'paid' even after closed_at is set
          if (status.session_status === 'paid') {
            _showPaidScreen();
          } else {
            _showSessionClosedBanner();
          }
          return;
        }

        // Sync bill-requested state across both screens
        if (status.bill_requested && !TC.billRequested) {
          TC.billRequested = true;
          const barBtn  = document.getElementById('requestBillBarBtn');
          const confBtn = document.getElementById('billRequestBtn');
          if (barBtn)  { barBtn.textContent  = 'Bill Requested ✓'; barBtn.disabled  = true; barBtn.classList.add('bill-requested'); }
          if (confBtn) { confBtn.textContent = 'Bill Requested ✓'; confBtn.disabled = true; confBtn.classList.add('bill-requested'); }
        }

        if (onOrdering) _renderOrdersPanel(ordersData.orders);
        if (onConfirm)  TablesCheckout.renderSessionOrders(ordersData.orders);
      } catch (_) { /* network blip — ignore */ }
    }, 30_000);
  }

  function _showSessionClosedBanner() {
    if (document.getElementById('sessionClosedBanner')) return;

    // Clear persisted cart — session closed, no further ordering possible
    const _TC = window.TABLE_CONTEXT;
    if (_TC?.isDineIn && _TC.sessionId && window.CONFIG?.slug) {
      TablesCart.clearPersisted(window.CONFIG.slug, _TC.sessionId);
    }

    const banner = document.createElement('div');
    banner.id = 'sessionClosedBanner';
    banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:9999;
      background:#c0392b;color:#fff;text-align:center;
      padding:14px 16px;font-size:14px;font-weight:600;line-height:1.4;
    `;
    banner.textContent = 'Your table session has ended. Ask your waiter to re-open it.';
    document.body.prepend(banner);
    // Disable all interactive ordering controls
    [
      '[data-action="go-checkout"]',
      '[data-action="order-more"]',
      '[data-action="add-item"]',
      '[data-action="inc-item"]',
      '[data-action="open-modal"]',
    ].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.disabled = true;
        el.setAttribute('aria-disabled', 'true');
      });
    });

    ['placeOrderBtn', 'requestBillBarBtn', 'billRequestBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = true; el.setAttribute('aria-disabled', 'true'); }
    });

    // Update session badge on confirm screen
    const badge = document.getElementById('sessionStatusBadge');
    if (badge) {
      badge.classList.add('session-status-badge--closed');
      badge.innerHTML = 'Session Closed';
    }
  }

  function _showPaidScreen() {
    if (document.getElementById('paidOverlay')) return;

    // Clear persisted cart and identity — session fully done
    const _TC = window.TABLE_CONTEXT;
    if (_TC?.isDineIn && _TC.sessionId && window.CONFIG?.slug) {
      TablesCart.clearPersisted(window.CONFIG.slug, _TC.sessionId);
      try { localStorage.removeItem(`kravon:guest:${window.CONFIG.slug}:${_TC.sessionId}`); } catch (_) {}
    }

    const brandName = window.CONFIG?.brand?.name || 'Us';

    const overlay = document.createElement('div');
    overlay.id = 'paidOverlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:#0d0d0d;display:flex;align-items:center;justify-content:center;
      padding:24px;text-align:center;font-family:system-ui,sans-serif;`;
    overlay.innerHTML = `
      <div style="max-width:320px;width:100%">
        <div style="font-size:48px;margin-bottom:16px">🙏</div>
        <h1 style="color:#f0e8d5;font-size:22px;font-weight:700;margin:0 0 10px">
          Thank you for dining with us
        </h1>
        <p style="color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;margin:0 0 28px">
          Your bill has been settled. We hope you enjoyed your meal at ${Kravon.esc(brandName)}.
        </p>
        <div id="paidReviewWrap" style="background:rgba(255,255,255,0.05);border-radius:12px;padding:20px">
          <div style="color:#f0e8d5;font-size:15px;font-weight:600;margin-bottom:14px">Rate your experience</div>
          <div id="paidStars" style="display:flex;justify-content:center;gap:8px">
            ${[1,2,3,4,5].map(n =>
              `<button class="paid-star-btn" data-stars="${n}"
                       style="background:none;border:none;cursor:pointer;font-size:32px;opacity:0.35;padding:0"
                       aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`
            ).join('')}
          </div>
          <div id="paidReviewFeedback" style="display:none;margin-top:14px">
            <textarea id="paidFeedbackText"
              style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.08);
                     border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#f0e8d5;
                     padding:10px 12px;font-size:14px;resize:none;outline:none"
              rows="3" placeholder="Tell us what we can improve…" maxlength="500"></textarea>
            <button id="paidFeedbackBtn"
              style="margin-top:10px;width:100%;background:#c8a96e;color:#111;border:none;
                     border-radius:8px;padding:12px;font-size:14px;font-weight:600;cursor:pointer">
              Send Feedback
            </button>
          </div>
          <div id="paidReviewGoogle" style="display:none;margin-top:14px">
            <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0 0 12px;line-height:1.5">
              So glad you enjoyed it! Share on Google — it helps us a lot.
            </p>
            <a id="paidGoogleLink" href="#" target="_blank" rel="noopener noreferrer"
               style="display:block;background:#c8a96e;color:#111;border-radius:8px;
                      padding:12px;font-size:14px;font-weight:600;text-decoration:none">
              Leave a Google Review ↗
            </a>
          </div>
          <div id="paidReviewThanks" style="display:none;color:rgba(255,255,255,0.5);
               font-size:14px;margin-top:12px">Thank you for the feedback 🙏</div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    let _stars = 0;
    overlay.querySelectorAll('.paid-star-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        _stars = parseInt(btn.dataset.stars, 10);
        overlay.querySelectorAll('.paid-star-btn').forEach((b, i) => {
          b.style.opacity = i < _stars ? '1' : '0.35';
        });
        const TC = window.TABLE_CONTEXT;
        try {
          const result = await KravonAPI.submitReview({
            stars: _stars, order_surface: 'tables',
            table_identifier: TC.tableName || undefined,
          });
          if (result.above_threshold && result.google_review_url) {
            document.getElementById('paidGoogleLink').href = result.google_review_url;
            document.getElementById('paidReviewGoogle').style.display = '';
          } else {
            document.getElementById('paidReviewFeedback').style.display = '';
          }
        } catch (_) {
          document.getElementById('paidReviewFeedback').style.display = '';
        }
      });
    });

    document.getElementById('paidFeedbackBtn')?.addEventListener('click', async () => {
      const text = document.getElementById('paidFeedbackText')?.value.trim() || '';
      const TC   = window.TABLE_CONTEXT;
      try {
        if (_stars) {
          await KravonAPI.submitReview({
            stars: _stars, feedback: text, order_surface: 'tables',
            table_identifier: TC.tableName || undefined,
          });
        }
      } catch (_) {}
      document.getElementById('paidReviewFeedback').style.display = 'none';
      document.getElementById('paidReviewThanks').style.display   = '';
    });
  }
}
