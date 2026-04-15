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

      case 'go-back':
        UI.showScreen('screenOrdering');
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

  /* ── Init ─────────────────────────────────────────────── */
  Modal.init();
  Checkout.init();
  UI.renderCart();
  document.getElementById('screenOrdering')?.classList.add('active');

})();
