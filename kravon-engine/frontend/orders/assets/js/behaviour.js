/* ═══════════════════════════════════════════════════════════
   ORDERS — BEHAVIOUR.JS
   Single event delegation layer. Delegates to OrdersCart,
   OrdersRenderer, OrdersCheckout, OrdersModal.
   ═══════════════════════════════════════════════════════════ */

function initOrdersBehaviour() {
  'use strict';

  function _findMenuItem(id) {
    for (const cat of (window.MENU || [])) {
      const item = cat.items.find(i => String(i.id) === String(id));
      if (item) return item;
    }
    return null;
  }

  /* ── Cart open/close ──────────────────────────────────────── */
  function openCart() {
    const drawer  = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');
    OrdersRenderer.renderCartDrawer();
    if (drawer)  { drawer.style.display = ''; drawer.setAttribute('aria-hidden', 'false'); }
    if (overlay) { overlay.style.display = ''; overlay.setAttribute('aria-hidden', 'false'); }
    document.body.style.overflow = 'hidden';
    drawer?.querySelector('.cart-close-btn')?.focus();
  }

  function closeCart() {
    const drawer  = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');
    if (drawer)  { drawer.style.display = 'none'; drawer.setAttribute('aria-hidden', 'true'); }
    if (overlay) { overlay.style.display = 'none'; overlay.setAttribute('aria-hidden', 'true'); }
    document.body.style.overflow = '';
  }

  /* ── Mobile cart label: first item name ──────────────────── */
  function _updateMobileCartLabel() {
    const labelEl = document.getElementById('mobileCartLabel');
    if (!labelEl) return;
    const items = OrdersCart.getItems();
    const count = items.reduce((sum, i) => sum + i.qty, 0);
    if (items.length > 0) {
      const firstName = items[0].name.length > 18
        ? items[0].name.slice(0, 17) + '…'
        : items[0].name;
      const extra = count > 1 ? ` +${count - 1}` : '';
      labelEl.textContent = firstName + extra;
    } else {
      labelEl.textContent = 'items in cart';
    }
  }

  /* ── Category sheet open/close ───────────────────────────── */
  function openCatSheet() {
    const sheet   = document.getElementById('catSheet');
    const overlay = document.getElementById('catSheetOverlay');
    const list    = document.getElementById('catSheetList');

    if (list && window.MENU) {
      list.innerHTML = window.MENU.map(cat => `
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
    const navH = document.querySelector('.tables-nav')?.offsetHeight || 60;
    const catH = document.querySelector('.cat-sidebar')?.offsetHeight || 0;
    const top  = section.getBoundingClientRect().top + window.scrollY - navH - catH - 12;
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

      /* ── Simple add (non-customisable) ── */
      case 'add-item': {
        const id   = target.dataset.itemId;
        const item = _findMenuItem(id);
        if (!item) return;
        OrdersCart.addItem(id, item.name, item.price);
        OrdersRenderer.updateItemBtn(id);
        OrdersRenderer.renderCartDrawer();
        _updateMobileCartLabel();
        Kravon.toast(`${item.name} added`);
        break;
      }

      /* ── Open customisation modal ── */
      case 'open-modal': {
        OrdersModal.open(target.dataset.itemId);
        break;
      }

      /* ── Edit item in cart ── */
      case 'edit-cart-item': {
        OrdersModal.openEdit(parseInt(target.dataset.idx, 10));
        break;
      }

      /* ── Modal close ── */
      case 'orders-close-modal':
        OrdersModal.close();
        break;

      /* ── Modal qty ── */
      case 'orders-modal-qty-dec':
        OrdersModal.decQty();
        break;

      case 'orders-modal-qty-inc':
        OrdersModal.incQty();
        break;

      /* ── Modal toggle addon ── */
      case 'orders-toggle-addon':
        OrdersModal.toggleAddon(target);
        break;

      /* ── Modal set spice ── */
      case 'orders-set-spice':
        OrdersModal.setSpice(target);
        break;

      /* ── Modal confirm ── */
      case 'orders-modal-confirm': {
        const confirmedId = OrdersModal.confirm();
        if (confirmedId) {
          OrdersRenderer.updateItemBtn(confirmedId);
          OrdersRenderer.renderCartDrawer();
          _updateMobileCartLabel();
          Kravon.toast('Added to order');
        }
        break;
      }

      /* ── Inc/dec from menu grid (non-customisable) ── */
      case 'inc-item': {
        const id    = target.dataset.itemId;
        const items = OrdersCart.getItems();
        const idx   = [...items].reverse().findIndex(i => i.id === String(id));
        const realIdx = idx === -1 ? -1 : items.length - 1 - idx;
        if (realIdx !== -1) {
          OrdersCart.changeQty(realIdx, 1);
        } else {
          const item = _findMenuItem(id);
          if (item) OrdersCart.addItem(id, item.name, item.price);
        }
        OrdersRenderer.updateItemBtn(id);
        OrdersRenderer.renderCartDrawer();
        _updateMobileCartLabel();
        break;
      }

      case 'dec-item': {
        const id    = target.dataset.itemId;
        const items = OrdersCart.getItems();
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].id === String(id)) { OrdersCart.changeQty(i, -1); break; }
        }
        if (OrdersCart.getQtyById(id) === 0) OrdersModal.resetIfItem(id);
        OrdersRenderer.updateItemBtn(id);
        OrdersRenderer.renderCartDrawer();
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
        const itemBefore = OrdersCart.getItems()[idx];
        OrdersCart.changeQty(idx, -1);
        if (itemBefore) {
          if (OrdersCart.getQtyById(itemBefore.id) === 0) OrdersModal.resetIfItem(itemBefore.id);
          OrdersRenderer.updateItemBtn(itemBefore.id);
        }
        OrdersRenderer.renderCartDrawer();
        _updateMobileCartLabel();
        break;
      }

      case 'cart-inc': {
        const idx  = parseInt(target.dataset.idx, 10);
        const item = OrdersCart.getItems()[idx];
        if (item) {
          OrdersCart.changeQty(idx, 1);
          OrdersRenderer.updateItemBtn(item.id);
        }
        OrdersRenderer.renderCartDrawer();
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
        const items = OrdersCart.getItems();
        if (!items.length) return;
        const totals = OrdersCart.getTotals();
        if (totals.belowMin) {
          Kravon.toast(`Min order ₹${totals.minOrder}. Add ₹${totals.minOrder - totals.sub} more.`);
          return;
        }
        closeCart();
        OrdersRenderer.renderCheckoutSummary();
        OrdersRenderer.showScreen('screenCheckout');
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
        OrdersCheckout.placeOrder();
        break;

      /* ── Delivery / payment selection ── */
      case 'select-delivery':
        OrdersCheckout.selectDelivery(target);
        break;

      case 'select-payment':
        OrdersCheckout.selectPayment(target);
        break;

      /* ── Track order (WhatsApp) ── */
      case 'track-order':
        OrdersCheckout.trackOrder(target);
        break;

      /* ── New order ── */
      case 'new-order':
        OrdersCheckout.newOrder();
        (window.MENU || []).forEach(cat =>
          cat.items.forEach(item => OrdersRenderer.updateItemBtn(item.id))
        );
        break;

      /* ── Scroll to menu category ── */
      case 'scroll-to-cat':
        scrollToCategory(target.dataset.catId);
        break;

      /* ── Star rating ── */
      case 'rate': {
        const stars = parseInt(target.dataset.stars, 10);
        OrdersCheckout.handleRating(stars);
        break;
      }

      /* ── Submit feedback ── */
      case 'submit-feedback':
        OrdersCheckout.submitFeedback();
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
      const modal = document.getElementById('ordersCustomModal');
      if (modal && modal.classList.contains('open')) {
        OrdersModal.close();
      } else {
        closeCart();
        closeCatSheet();
      }
    }
  });

  /* ── Browser back/forward ─────────────────────────────── */
  window.addEventListener('popstate', function (e) {
    const screen = e.state?.screen || 'screenOrdering';
    OrdersRenderer.showScreen(screen, false);
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

    if (!activeId && sections.length > 0) {
      activeId = sections[0].id.replace('cat_', '');
    }

    document.querySelectorAll('.cat-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.catId === activeId);
    });
  }

  requestAnimationFrame(() => {
    const firstBtn = document.querySelector('.cat-btn');
    if (firstBtn) firstBtn.classList.add('active');
    _syncFab('screenOrdering');
  });

  window.addEventListener('scroll', updateActiveCat, { passive: true });
  window.addEventListener('resize', () => _syncFab(
    document.getElementById('screenOrdering')?.style.display !== 'none' ? 'screenOrdering' : 'other'
  ), { passive: true });

  /* ── Visual viewport: shrink cart drawer when keyboard appears ── */
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const drawer = document.getElementById('cartDrawer');
      if (!drawer || drawer.getAttribute('aria-hidden') === 'true') return;
      const available = window.visualViewport.height;
      drawer.style.maxHeight = Math.min(available * 0.85, available - 48) + 'px';
    }, { passive: true });
  }
}
