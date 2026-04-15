/* ═══════════════════════════════════════════════════════════
   TABLES — BEHAVIOUR.JS
   Single event delegation layer for all user interactions.
   Never touches business logic — delegates to TablesCart,
   TablesRenderer, TablesCheckout, and TablesModal.
   ═══════════════════════════════════════════════════════════ */

function initTablesBehaviour() {
  'use strict';

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
    if (drawer)  { drawer.style.display = 'none'; drawer.setAttribute('aria-hidden', 'true'); }
    if (overlay) { overlay.style.display = 'none'; overlay.setAttribute('aria-hidden', 'true'); }
    document.body.style.overflow = '';
  }

  /* ── Category scroll ─────────────────────────────────────── */
  function scrollToCategory(catId) {
    const section = document.getElementById(`cat_${catId}`);
    if (!section) return;
    const navH = document.querySelector('.tables-nav')?.offsetHeight || 60;
    const catH = document.querySelector('.cat-sidebar')?.offsetHeight || 0;
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
        const id    = target.dataset.id;
        const name  = target.dataset.name;
        const price = parseInt(target.dataset.price, 10);
        TablesCart.addItem(id, name, price);
        TablesRenderer.updateItemBtn(id);
        TablesRenderer.renderCartDrawer();
        Kravon.toast(`${name} added`);
        break;
      }

      /* ── Open customisation modal ── */
      case 'open-modal': {
        TablesModal.open(target.dataset.itemId);
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
          TablesRenderer.updateItemBtn(confirmedId);
          TablesRenderer.renderCartDrawer();
          Kravon.toast('Added to order');
        }
        break;
      }

      /* ── Inc/dec from menu grid (non-customisable) ── */
      case 'inc-item': {
        const id    = target.dataset.id;
        const items = TablesCart.getItems();
        const idx   = [...items].reverse().findIndex(i => i.id === String(id));
        const realIdx = idx === -1 ? -1 : items.length - 1 - idx;
        if (realIdx !== -1) TablesCart.changeQty(realIdx, 1);
        else {
          const addBtn = document.getElementById(`addBtn_${id}`);
          if (addBtn) TablesCart.addItem(id, addBtn.dataset.name, parseInt(addBtn.dataset.price, 10));
        }
        TablesRenderer.updateItemBtn(id);
        TablesRenderer.renderCartDrawer();
        break;
      }

      case 'dec-item': {
        const id    = target.dataset.id;
        const items = TablesCart.getItems();
        let idxToRemove = -1;
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].id === String(id)) { idxToRemove = i; break; }
        }
        if (idxToRemove !== -1) TablesCart.changeQty(idxToRemove, -1);
        TablesRenderer.updateItemBtn(id);
        TablesRenderer.renderCartDrawer();
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
        if (itemBefore) TablesRenderer.updateItemBtn(itemBefore.id);
        TablesRenderer.renderCartDrawer();
        break;
      }

      case 'cart-inc': {
        const idx  = parseInt(target.dataset.idx, 10);
        const item = TablesCart.getItems()[idx];
        if (item) {
          TablesCart.changeQty(idx, 1);
          TablesRenderer.updateItemBtn(item.id);
        }
        TablesRenderer.renderCartDrawer();
        break;
      }

      /* ── Go to checkout ── */
      case 'go-checkout': {
        if (!TablesCart.getItems().length) return;
        closeCart();
        TablesRenderer.showScreen('screenCheckout');
        TablesRenderer.renderCheckoutSummary();
        window.scrollTo(0, 0);
        break;
      }

      /* ── Back to menu ── */
      case 'back-to-menu':
        TablesRenderer.showScreen('screenOrdering');
        window.scrollTo(0, 0);
        break;

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

      /* ── Bill request ── */
      case 'request-bill':
        TablesCheckout.requestBill(target);
        break;

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

      /* ── New order ── */
      case 'new-order':
        TablesCart.clear();
        window.location.reload();
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

  /* ── Category sticky scroll highlighting ───────────────── */
  function updateActiveCat() {
    const sections = document.querySelectorAll('.menu-section');
    const navH = document.querySelector('.tables-nav')?.offsetHeight || 60;
    const catH = document.querySelector('.cat-sidebar')?.offsetHeight || 0;
    const offset = navH + catH + 24;

    let activeId = null;
    sections.forEach(s => {
      if (s.getBoundingClientRect().top - offset < 0) activeId = s.id.replace('cat_', '');
    });

    document.querySelectorAll('.cat-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.catId === activeId);
    });
  }

  window.addEventListener('scroll', updateActiveCat, { passive: true });
}
