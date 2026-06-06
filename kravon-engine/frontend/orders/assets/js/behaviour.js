/* ═══════════════════════════════════════════════════════════
   ORDERS — BEHAVIOUR.JS
   Single delegated click handler + keyboard + resize.
   Loaded last — renderer, cart, modal, checkout, ui all ready.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  function _findMenuItem(id) {
    for (const cat of window.MENU) {
      const item = cat.items.find(i => String(i.id) === String(id));
      if (item) return item;
    }
    return null;
  }

  /* ── Single delegated click ───────────────────────────── */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {

      case 'add-item': {
        const item = _findMenuItem(btn.dataset.itemId);
        if (!item) return;
        Cart.addItem(item.id, item.name, item.price, '');
        OrdersRenderer.updateItemBtn(item.id);
        UI.renderCart();
        UI.flashCartPanel();
        UI.animateItemAdded(item.id);
        break;
      }

      case 'open-modal':
        Modal.open(btn.dataset.itemId);
        break;

      case 'close-modal':
        Modal.close();
        break;

      case 'modal-qty-dec':
        Modal.decQty();
        break;

      case 'modal-qty-inc':
        Modal.incQty();
        break;

      case 'toggle-addon':
        Modal.toggleAddon(btn);
        break;

      case 'set-spice':
        Modal.setSpice(btn);
        break;

      case 'modal-confirm': {
        const confirmedId = Modal.confirm();
        if (confirmedId) {
          OrdersRenderer.updateItemBtn(confirmedId);
          UI.renderCart();
          UI.flashCartPanel();
          UI.animateItemAdded(confirmedId);
        }
        break;
      }

      case 'item-dec': {
        // Decrement total qty for this menu item across all cart entries.
        // Find the last matching entry and reduce it by 1.
        const id    = btn.dataset.itemId;
        const items = Cart.getItems();
        // Walk backwards — remove the last-added variant first
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].id === String(id)) {
            Cart.changeQty(i, -1);
            break;
          }
        }
        OrdersRenderer.updateItemBtn(id);
        UI.renderCart();
        break;
      }

      case 'change-qty': {
        const idx    = parseInt(btn.dataset.idx, 10);
        const itemId = Cart.getItems()[idx]?.id;
        Cart.changeQty(idx, parseInt(btn.dataset.delta, 10));
        if (itemId) OrdersRenderer.updateItemBtn(itemId);
        UI.renderCart();
        break;
      }

      case 'remove-item': {
        const itemId = Cart.getItems()[parseInt(btn.dataset.idx, 10)]?.id;
        Cart.removeItem(parseInt(btn.dataset.idx, 10));
        if (itemId) OrdersRenderer.updateItemBtn(itemId);
        UI.renderCart();
        break;
      }

      case 'edit-item':
        Modal.openEdit(parseInt(btn.dataset.idx, 10));
        break;

      case 'go-to-checkout':
        Checkout.goToCheckout();
        break;

      case 'select-delivery':
        Checkout.selectDelivery(btn);
        break;

      case 'select-payment':
        Checkout.selectPayment(btn);
        break;

      case 'place-order':
        Checkout.placeOrder();
        break;

      case 'track-order':
        Checkout.trackOrder();
        break;

      case 'new-order':
        Checkout.newOrder();
        // Reset all item card buttons to Add state after cart clear
        window.MENU.forEach(cat => cat.items.forEach(item => {
          OrdersRenderer.updateItemBtn(item.id);
        }));
        break;

      case 'rate-order':
        Checkout.handleOrderRating(parseInt(btn.dataset.stars, 10));
        break;

      case 'submit-order-feedback':
        Checkout.submitOrderFeedback();
        break;

      case 'browse-menu':
        UI.closeMobileCart();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;

      case 'edit-order':
        Checkout.editOrder();
        break;

      case 'go-back':
        history.back();
        break;

      case 'nav-cart':
        UI.handleNavCart();
        break;

      case 'open-mobile-cart':
        UI.openMobileCart();
        break;

      case 'close-mobile-cart':
        UI.closeMobileCart();
        break;

      case 'toggle-mobile-cart':
        UI.toggleMobileCart();
        break;

      case 'scroll-to-section':
        UI.scrollToSection(btn.dataset.sectionId, btn);
        break;

      case 'expand-desc':
        btn.classList.toggle('item-desc--expanded');
        break;
    }
  });

  /* ── Keyboard ─────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('customModal')?.classList.contains('open')) {
      Modal.close();
    } else {
      UI.closeMobileCart();
    }
  });

  /* ── Resize ───────────────────────────────────────────── */
  window.addEventListener('resize', UI.onResize);

  /* ── Category scroll spy ──────────────────────────────── */
  // Highlights the sidebar cat-btn matching the section currently in view.
  function _updateActiveCat() {
    const navH = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--nav-height'), 10
    ) || 60;
    const offset = navH + 24;
    const sections = document.querySelectorAll('.menu-cat-section');
    let activeId = null;
    sections.forEach(s => {
      if (s.getBoundingClientRect().top - offset <= 0) activeId = s.id;
    });
    // When no section has scrolled past the threshold, keep the first category active
    if (!activeId) {
      const firstSection = sections[0];
      if (firstSection) activeId = firstSection.id;
    }
    document.querySelectorAll('.cat-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sectionId === activeId);
    });
  }
  window.addEventListener('scroll', _updateActiveCat, { passive: true });

  /* ── Browser back/forward ─────────────────────────────── */
  window.addEventListener('popstate', function (e) {
    const screen = e.state?.screen || 'screenOrdering';
    UI.showScreen(screen, false);
  });

  /* ── Init — called by boot.js after loadConfig() ─────── */
  window.initBehaviour = function () {
    Modal.init();
    Checkout.init();
    UI.renderCart();
    document.getElementById('screenOrdering')?.classList.add('active');
    // Seed initial history entry so the first Back press returns here
    history.replaceState({ screen: 'screenOrdering' }, '', window.location.href);
    // Set first category active immediately — scroll spy only fires after scroll
    requestAnimationFrame(() => {
      const firstBtn = document.querySelector('.cat-btn');
      if (firstBtn) firstBtn.classList.add('active');
    });
    // Scroll to the ordering layout so the sticky cart panel is above the fold
    requestAnimationFrame(() => {
      const layout = document.querySelector('.ordering-layout');
      if (layout) {
        const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'), 10) || 60;
        window.scrollTo({ top: layout.getBoundingClientRect().top + window.scrollY - navH, behavior: 'instant' });
      }
    });
  };

})();
