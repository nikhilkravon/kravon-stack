/* ═══════════════════════════════════════════════════════════
   SHARED — CHECKOUT.JS
   Single checkout entry point for all plan tiers.

   Usage:
     Checkout.start(cart)

   cart must expose either the EnhancedCart API:
     .items()   → [{name, quantity, basePrice, totalPrice, specialNote, menuItemId, variant, customizations}]
     .count()   → number
     .total()   → number

   or the KravonCart API:
     .getItems()   → [{id, name, qty, price, note, cartItemId}]
     .getCount()   → number
     .getTotals()  → {sub}

   Strategy is read from CONFIG.capabilities.checkoutStrategy:
     'whatsapp' — generate order message, open wa.me link (Starter)
     'orders'   — serialize cart to sessionStorage, navigate to checkout.html (Growth+)

   The checkout page for 'orders' is expected at the same directory
   level as the calling page (presence/checkout.html).
   ═══════════════════════════════════════════════════════════ */

window.Checkout = (() => {
  'use strict';

  /* ── Public entry point ──────────────────────────────────── */
  function start(cart) {
    const C        = window.CONFIG;
    const strategy = (C.capabilities && C.capabilities.checkoutStrategy) || 'whatsapp';

    switch (strategy) {
      case 'orders':   return _toCheckoutPage(cart, C);
      case 'whatsapp':
      default:         return _whatsapp(cart, C);
    }
  }

  /* ── Normalize: accept either EnhancedCart or KravonCart ── */
  function _normalize(cart) {
    if (typeof cart.items === 'function') {
      return {
        count: cart.count(),
        total: cart.total(),
        items: cart.items().map(i => ({
          menuItemId:     i.menuItemId,
          name:           i.name,
          qty:            i.quantity,
          price:          i.basePrice,
          lineTotal:      i.totalPrice,
          note:           i.specialNote   || '',
          variant:        i.variant       || null,
          customizations: i.customizations || [],
        })),
      };
    }
    // KravonCart
    const t = cart.getTotals();
    return {
      count: cart.getCount(),
      total: t.sub,
      items: cart.getItems().map(i => ({
        menuItemId:     i.id,
        name:           i.name,
        qty:            i.qty,
        price:          i.price,
        lineTotal:      i.price * i.qty,
        note:           i.note           || '',
        variant:        null,
        customizations: [],
      })),
    };
  }

  /* ── Starter: WhatsApp message ───────────────────────────── */
  function _whatsapp(cart, C) {
    const { count, total, items } = _normalize(cart);
    if (count === 0) return;

    const cur      = (C.order   && C.order.currency)    || '₹';
    const greeting = (C.contact && C.contact.waGreeting) || 'Hi, I would like to order:';
    const waNum    = (C.contact && C.contact.waNumber)   || '';

    const lines = items.map(i =>
      '• ' + i.name + ' × ' + i.qty + ' — ' + cur + i.lineTotal +
      (i.note ? ' (' + i.note + ')' : '')
    );
    const msg = greeting + '\n\n' + lines.join('\n') + '\n\nTotal: ' + cur + total;

    window.open(
      'https://wa.me/' + waNum + '?text=' + encodeURIComponent(msg),
      '_blank', 'noopener,noreferrer'
    );
  }

  /* ── Growth+: serialize cart, navigate to checkout.html ─── */
  function _toCheckoutPage(cart, C) {
    const { count, items } = _normalize(cart);
    if (count === 0) return;

    sessionStorage.setItem('kravon_presence_cart', JSON.stringify(
      items.map(i => ({
        cartItemId:     i.menuItemId,
        menuItemId:     i.menuItemId,
        name:           i.name,
        quantity:       i.qty,
        basePrice:      i.price,
        totalPrice:     i.lineTotal,
        specialNote:    i.note,
        variant:        i.variant,
        customizations: i.customizations,
      }))
    ));

    const p    = new URLSearchParams(window.location.search);
    const qs   = new URLSearchParams();
    const slug = (C && C.slug) || p.get('slug');
    if (slug)         qs.set('slug', slug);
    if (p.get('api')) qs.set('api', p.get('api'));
    const q = qs.toString();
    window.location.href = 'checkout.html' + (q ? '?' + q : '');
  }

  return { start };

})();
