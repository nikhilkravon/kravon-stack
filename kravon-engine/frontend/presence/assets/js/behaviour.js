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
    const count  = EnhancedCart.count();
    const total  = EnhancedCart.total();
    const cur    = C.order.currency;
    const min    = C.order.minOrder;
    const belowMin = total < min;

    DOM.cartCount.textContent    = count;
    DOM.cartBarTotal.textContent = `${cur}${total}`;
    DOM.cartBarItems.textContent = `${count} item${count !== 1 ? 's' : ''}`;
    DOM.cartBar.classList.toggle('visible', count > 0);

    // Disable the cart-bar checkout button when below min order; label by has_orders
    const barBtn = DOM.cartBar.querySelector('.cart-wa-btn');
    if (barBtn) {
      barBtn.disabled = belowMin;
      barBtn.setAttribute('aria-disabled', String(belowMin));
      barBtn.textContent = (C.products && C.products.orders) ? 'Proceed to Checkout' : 'Order on WhatsApp';
    }
  }

  /* ── Cart drawer ──────────────────────────────────────── */
  function renderCartDrawer() {
    const cartItems = EnhancedCart.items();
    const count = cartItems.length;
    const total = EnhancedCart.total();
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

    DOM.cartItemsList.innerHTML = cartItems.map(item => `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">${cur}${item.basePrice} × ${item.quantity}</div>
        </div>
        <div class="qty-ctrl" role="group" aria-label="Quantity for ${item.name}">
          <button class="qty-btn" data-action="dec" data-id="${item.cartItemId}" aria-label="Remove one">−</button>
          <div class="qty-num" aria-live="polite">${item.quantity}</div>
          <button class="qty-btn" data-action="inc" data-id="${item.cartItemId}" aria-label="Add one">+</button>
        </div>
        <div class="cart-item-total">${cur}${item.totalPrice}</div>
      </div>`).join('');

    DOM.cartTotalVal.textContent = `${cur}${total}`;
    DOM.cartFooter.style.display = 'flex';

    if (total < min) {
      DOM.cartMinNote.textContent = `Min order ${cur}${min} · Add ${cur}${min - total} more`;
      DOM.cartMinNote.className   = 'cart-min-note warn';
    } else {
      DOM.cartMinNote.textContent = 'Ready to order';
      DOM.cartMinNote.className   = 'cart-min-note';
    }

    const drawerBtn = document.querySelector('.cart-checkout-btn');
    if (drawerBtn) {
      drawerBtn.disabled = total < min;
      drawerBtn.setAttribute('aria-disabled', String(total < min));
      drawerBtn.textContent = (C.products && C.products.orders) ? 'Proceed to Checkout' : 'Order on WhatsApp';
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

  /* ── Checkout: redirect to checkout page or open WhatsApp ─ */
  function checkout() {
    const items = EnhancedCart.items();
    if (!items.length) return;

    if (C.products && C.products.orders) {
      sessionStorage.setItem('kravon_presence_cart', JSON.stringify(items));
      const p = new URLSearchParams(window.location.search);
      const qs = new URLSearchParams();
      const slug = (window.CONFIG && window.CONFIG.slug) || p.get('slug');
      if (slug) qs.set('slug', slug);
      if (p.get('api')) qs.set('api', p.get('api'));
      const q = qs.toString();
      window.location.href = q ? `checkout.html?${q}` : 'checkout.html';
    } else {
      const cur = C.order.currency;
      const lines = items.map(i =>
        `• ${i.name} × ${i.quantity} — ${cur}${i.totalPrice}${i.specialNote ? ' (' + i.specialNote + ')' : ''}`
      );
      const total = EnhancedCart.total();
      const greeting = (C.contact && C.contact.waGreeting) || 'Hi, I would like to order:';
      const msg = `${greeting}\n\n${lines.join('\n')}\n\nTotal: ${cur}${total}`;
      const waNum = (C.contact && C.contact.waNumber) || '';
      window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
    }
  }

  /* ── Cart subscriber → refresh all cart UI ────────────── */
  let _prevCartIds = new Set();

  function onCartChange() {
    updateCartBar();
    renderCartDrawer();
  }

  EnhancedCart.subscribe(onCartChange);

  /* ── Delegated click handler ──────────────────────────── */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id     = btn.dataset.id;

    switch (action) {
      case 'customize': {
        const item = window.MENU.find(m => String(m.id) === id);
        if (item) {
          CustomizationModal.open(item, (customizedItem) => {
            EnhancedCart.add(customizedItem);
            onCartChange();
          });
        }
        break;
      }
      case 'dec': {
        const cartItemId = btn.dataset.id;
        const item = EnhancedCart.getItem(cartItemId);
        if (item) {
          EnhancedCart.updateQuantity(cartItemId, item.quantity - 1);
        }
        break;
      }
      case 'inc': {
        const cartItemId = btn.dataset.id;
        const item = EnhancedCart.getItem(cartItemId);
        if (item) {
          EnhancedCart.updateQuantity(cartItemId, item.quantity + 1);
        }
        break;
      }
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
