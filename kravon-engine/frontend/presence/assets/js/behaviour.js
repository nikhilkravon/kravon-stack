/* ═══════════════════════════════════════════════════════════
   PRESENCE — BEHAVIOUR.JS
   All event delegation and DOM interaction.
   Renderer mounts first, so DOM is ready when this runs.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  let C;
  const $   = id => document.getElementById(id);

  /* ── DOM refs ─────────────────────────────────────────── */
  const DOM = {
    cartBar:      $('cartBar'),
    cartCount:    $('cartCount'),
    cartBarTotal: $('cartBarTotal'),
    cartBarItems: $('cartBarItems'),
    cartItemsList:$('cartItemsList'),
    cartFooter:   $('cartFooter'),
    cartTotalVal: $('cartTotalVal'),
    cartMinNote:  $('cartMinNote'),
    cartDrawer:   $('cartDrawer'),
    cartOverlay:  $('cartOverlay'),
  };

  /* ── Cart bar ─────────────────────────────────────────── */
  function updateCartBar() {
    const count  = Cart.count();
    const total  = Cart.total();
    const cur    = C.order.currency;
    const min    = C.order.minOrder;
    const belowMin = total < min;

    DOM.cartCount.textContent    = count;
    DOM.cartBarTotal.textContent = `${cur}${total}`;
    DOM.cartBarItems.textContent = `${count} item${count !== 1 ? 's' : ''}`;
    DOM.cartBar.classList.toggle('visible', count > 0);

    // Disable the cart-bar checkout button when below min order
    const barBtn = DOM.cartBar.querySelector('.cart-wa-btn');
    if (barBtn) {
      barBtn.disabled = belowMin;
      barBtn.setAttribute('aria-disabled', String(belowMin));
    }
  }

  /* ── Cart drawer ──────────────────────────────────────── */
  function renderCartDrawer() {
    const count = Cart.count();
    const total = Cart.total();
    const cur   = C.order.currency;
    const min   = C.order.minOrder;

    if (count === 0) {
      DOM.cartItemsList.innerHTML = `
        <div class="cart-empty">
          <div class="cart-empty-icon" aria-hidden="true">🛒</div>
          <div class="cart-empty-text">Your cart is empty</div>
        </div>`;
      DOM.cartFooter.style.display = 'none';
      return;
    }

    DOM.cartItemsList.innerHTML = Object.entries(Cart.items())
      .map(([id, q]) => {
        const item = window.MENU.find(m => String(m.id) === id);
        if (!item) return '';
        return `
          <div class="cart-item">
            <div class="cart-item-info">
              <div class="cart-item-name">${item.name}</div>
              <div class="cart-item-price">${cur}${item.price} × ${q}</div>
            </div>
            <div class="qty-ctrl" role="group" aria-label="Quantity for ${item.name}">
              <button class="qty-btn" data-action="dec" data-id="${id}" aria-label="Remove one">−</button>
              <div class="qty-num" aria-live="polite">${q}</div>
              <button class="qty-btn" data-action="inc" data-id="${id}" aria-label="Add one">+</button>
            </div>
            <div class="cart-item-total">${cur}${item.price * q}</div>
          </div>`;
      }).join('');

    DOM.cartTotalVal.textContent = `${cur}${total}`;
    DOM.cartFooter.style.display = 'flex';

    if (total < min) {
      DOM.cartMinNote.textContent = `Min order ${cur}${min} · Add ${cur}${min - total} more`;
      DOM.cartMinNote.className   = 'cart-min-note warn';
    } else {
      DOM.cartMinNote.textContent = 'Ready to order';
      DOM.cartMinNote.className   = 'cart-min-note';
    }

    // Disable the drawer checkout button when below min order
    const drawerBtn = document.querySelector('.cart-checkout-btn');
    if (drawerBtn) {
      drawerBtn.disabled = total < min;
      drawerBtn.setAttribute('aria-disabled', String(total < min));
    }
  }

  /* ── Cart open / close ────────────────────────────────── */
  function openCart() {
    DOM.cartDrawer.classList.add('open');
    DOM.cartDrawer.setAttribute('aria-hidden', 'false');
    DOM.cartOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    const close = DOM.cartDrawer.querySelector('.cart-close');
    if (close) close.focus();
  }

  function closeCart() {
    DOM.cartDrawer.classList.remove('open');
    DOM.cartDrawer.setAttribute('aria-hidden', 'true');
    DOM.cartOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  /* ── WhatsApp checkout ────────────────────────────────── */
  function checkout() {
    if (Cart.count() === 0) return;
    if (Cart.total() < C.order.minOrder) return;
    const cur   = C.order.currency;
    const lines = Object.entries(Cart.items())
      .map(([id, q]) => {
        const item = window.MENU.find(m => String(m.id) === id);
        return item ? `• ${item.name} x${q} — ${cur}${item.price * q}` : null;
      })
      .filter(Boolean)
      .join('\n');

    const msg = `Hi! I'd like to place an order:\n\n${lines}\n\nTotal: ${cur}${Cart.total()}\n\nPlease confirm and share delivery details.`;
    window.open(Kravon.buildWaLink(C.contact.waNumber, msg), '_blank', 'noopener,noreferrer');
  }

  /* ── Cart subscriber → refresh all cart UI ────────────── */
  let _prevCartIds = new Set();

  function onCartChange() {
    updateCartBar();
    renderCartDrawer();
    if (window.PresenceRenderer) {
      const currentIds = new Set(Object.keys(Cart.items()));
      // Update cards that are in the cart now
      currentIds.forEach(id => PresenceRenderer.updateMenuCtrl(id));
      // Also update cards that just left the cart (qty → 0)
      _prevCartIds.forEach(id => {
        if (!currentIds.has(id)) PresenceRenderer.updateMenuCtrl(id);
      });
      _prevCartIds = currentIds;
    }
  }

  Cart.subscribe(onCartChange);

  /* ── Delegated click handler ──────────────────────────── */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id     = btn.dataset.id;

    switch (action) {
      case 'add':
        Cart.add(id);
        if (window.PresenceRenderer) PresenceRenderer.updateMenuCtrl(id);
        break;
      case 'inc':
        Cart.change(id, +1);
        if (window.PresenceRenderer) PresenceRenderer.updateMenuCtrl(id);
        break;
      case 'dec':
        Cart.change(id, -1);
        if (window.PresenceRenderer) PresenceRenderer.updateMenuCtrl(id);
        break;
      case 'open-cart':  openCart();   break;
      case 'close-cart': closeCart();  break;
      case 'checkout':   checkout();   break;
    }
  });

  /* ── Keyboard + overlay close ─────────────────────────── */
  DOM.cartOverlay.addEventListener('click', closeCart);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCart();
  });

  window.initBehaviour = function () {
    C = window.CONFIG;
    updateCartBar();
    renderCartDrawer();
  };

})();
