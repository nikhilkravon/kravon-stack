/* ═══════════════════════════════════════════════════════════
   ORDERS — CHECKOUT.JS
   Pay-first: validates delivery details before placing order.
   Handles delivery type selection, payment selection, Razorpay,
   confirmation screen, review prompt.
   ═══════════════════════════════════════════════════════════ */
const OrdersCheckout = (() => {
  'use strict';

  let _selectedPaymentId    = 'cod';
  let _selectedDeliveryType = 'standard';
  let _confirmedOrderId     = null;
  let _reviewStars          = 0;

  function init() {
    const O = window.CONFIG?.orders || {};
    _selectedPaymentId = O.paymentMethods?.[0]?.id || 'cod';
    _selectedDeliveryType = 'standard';

    // Seed initial delivery fee
    const cfg = OrdersCart.getConfig();
    OrdersCart.setDeliveryFee(cfg.deliveryStandard || 0);
  }

  /* ── Validation ──────────────────────────────────────────── */
  function validateFields() {
    let valid = true;
    const errs = { errName: '', errPhone: '', errAddress: '', errLocality: '' };

    const name     = _val('fieldName');
    const phone    = _val('fieldPhone').replace(/\D/g, '');
    const address  = _val('fieldAddress');
    const locality = _val('fieldLocality');

    if (!name)                          errs.errName     = 'Please enter your name';
    if (!phone || phone.length < 10)    errs.errPhone    = 'Please enter a valid 10-digit number';
    if (!address)                       errs.errAddress  = 'Please enter your delivery address';
    if (!locality)                      errs.errLocality = 'Please enter your locality';

    Object.entries(errs).forEach(([id, msg]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = msg;
      if (msg) valid = false;
    });

    if (!valid) {
      // Focus first error field
      const firstErr = ['fieldName','fieldPhone','fieldAddress','fieldLocality'].find(id => {
        const errId = 'err' + id.replace('field','');
        const el = document.getElementById(errId);
        return el && el.textContent;
      });
      if (firstErr) document.getElementById(firstErr)?.focus();
    }

    return valid;
  }

  /* ── Place order ─────────────────────────────────────────── */
  async function placeOrder() {
    const btn  = document.getElementById('placeOrderBtn');
    const note = document.getElementById('placeOrderNote');

    const items = OrdersCart.getItems();
    if (!items.length) {
      if (note) note.textContent = 'Your cart is empty.';
      return;
    }

    const totals = OrdersCart.getTotals();
    if (totals.belowMin) {
      if (note) note.textContent = `Minimum order is ₹${totals.minOrder}.`;
      return;
    }

    if (!validateFields()) return;

    if (btn) btn.disabled = true;
    if (note) note.textContent = 'Placing order…';

    const notes = _val('fieldNotes');

    const orderPayload = {
      order_surface:     'orders',
      customer_name:     _val('fieldName'),
      customer_phone:    _val('fieldPhone').replace(/\D/g, ''),
      delivery_address:  _val('fieldAddress'),
      delivery_locality: _val('fieldLocality'),
      delivery_landmark: _val('fieldLandmark') || undefined,
      special_notes:     notes || undefined,
      delivery_type:     _selectedDeliveryType,
      payment_method:    _selectedPaymentId,
      items: items.map(i => ({
        id:    i.id,
        name:  i.name,
        price: i.price,
        qty:   i.qty,
        note:  i.note   || undefined,
      })),
    };

    try {
      const { order } = await KravonAPI.createOrder(orderPayload);

      if (_selectedPaymentId !== 'cod' && order.razorpay_order_id) {
        _openRazorpay(order);
      } else {
        _showConfirmation(order.id, totals.total);
      }
    } catch (err) {
      console.error('[orders:checkout] placeOrder failed:', err.message);
      if (note) note.textContent = err.message || 'Something went wrong. Please try again.';
      if (btn) btn.disabled = false;
    }
  }

  /* ── Razorpay ─────────────────────────────────────────────── */
  function _openRazorpay(order) {
    const options = {
      key:         order.razorpay_key_id,
      order_id:    order.razorpay_order_id,
      amount:      order.total,
      currency:    'INR',
      name:        window.CONFIG.brand.name,
      description: 'Direct Delivery Order',
      prefill: {
        name:    _val('fieldName'),
        contact: _val('fieldPhone'),
      },
      theme: { color: window.CONFIG.brand.accent || '#c2d62a' },
      handler: function () {
        _showConfirmation(order.id, order.total);
      },
      modal: {
        ondismiss: function () {
          const btn  = document.getElementById('placeOrderBtn');
          const note = document.getElementById('placeOrderNote');
          if (btn) btn.disabled = false;
          if (note) note.textContent = '';
          Kravon.toast('Payment cancelled. You can try again.');
        },
      },
    };

    if (typeof Razorpay === 'undefined') {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => new Razorpay(options).open();
      document.head.appendChild(script);
    } else {
      new Razorpay(options).open();
    }
  }

  /* ── Confirmation screen ─────────────────────────────────── */
  function _showConfirmation(orderId, total) {
    _confirmedOrderId = orderId;
    _reviewStars = 0;

    OrdersCart.clear();
    (window.MENU || []).forEach(cat =>
      cat.items.forEach(item => OrdersRenderer.updateItemBtn(item.id))
    );

    const O = window.CONFIG?.orders || {};
    const C = window.CONFIG;

    const prefix = (C.brand.name || 'ORD').replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase();
    _setText('confirmOrderId',  `Order ID: ${prefix}-${orderId}`);
    _setText('confirmName',     _val('fieldName'));
    _setText('confirmTotal',    `₹${total}`);
    _setText('confirmPayment',  _selectedPaymentId === 'cod' ? 'Pay on Delivery' : 'Online');
    _setText('confirmETA',      O.deliveryEta || '45–60 min');
    _setText('confirmSub',      'Your order is on its way! We\'ll send updates via WhatsApp.');

    // Wire WhatsApp track button
    const waBtn = document.querySelector('[data-action="track-order"]');
    if (waBtn && C.contact?.waNumber) {
      const displayId = `${prefix}-${orderId}`;
      const msg = encodeURIComponent(
        (O.trackingMessage || 'Hi! Track my order {orderId}.').replace('{orderId}', displayId)
      );
      waBtn.dataset.waUrl = `https://wa.me/${C.contact.waNumber}?text=${msg}`;
    }

    resetReview();
    OrdersRenderer.showScreen('screenConfirm');
    window.scrollTo(0, 0);
  }

  /* ── Track order (WhatsApp) ───────────────────────────────── */
  function trackOrder(btn) {
    const url = btn.dataset.waUrl;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  /* ── New order ────────────────────────────────────────────── */
  function newOrder() {
    OrdersCart.clear();
    OrdersRenderer.renderCartDrawer();
    // Reset delivery to standard
    _selectedDeliveryType = 'standard';
    const cfg = OrdersCart.getConfig();
    OrdersCart.setDeliveryFee(cfg.deliveryStandard || 0);
    // Reset radio selections
    document.querySelectorAll('[data-action="select-delivery"]').forEach((o, i) => {
      o.classList.toggle('selected', i === 0);
      o.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
      o.tabIndex = i === 0 ? 0 : -1;
    });
    document.querySelectorAll('[data-action="select-payment"]').forEach((o, i) => {
      o.classList.toggle('selected', i === 0);
      o.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
      o.tabIndex = i === 0 ? 0 : -1;
    });
    OrdersRenderer.showScreen('screenOrdering');
    window.scrollTo(0, 0);
  }

  /* ── Delivery selection ───────────────────────────────────── */
  function selectDelivery(el) {
    _selectedDeliveryType = el.dataset.deliveryType;

    document.querySelectorAll('[data-action="select-delivery"]').forEach(o => {
      o.classList.remove('selected');
      o.setAttribute('aria-checked', 'false');
      o.tabIndex = -1;
    });
    el.classList.add('selected');
    el.setAttribute('aria-checked', 'true');
    el.tabIndex = 0;

    const O   = window.CONFIG?.orders || {};
    const fee = _selectedDeliveryType === 'express'
      ? (O.deliveryExpress  || 0)
      : (O.deliveryStandard || 0);
    OrdersCart.setDeliveryFee(fee);
    OrdersRenderer.renderCheckoutSummary();
  }

  /* ── Payment selection ────────────────────────────────────── */
  function selectPayment(el) {
    _selectedPaymentId = el.dataset.paymentId;
    document.querySelectorAll('[data-action="select-payment"]').forEach(o => {
      o.classList.remove('selected');
      o.setAttribute('aria-checked', 'false');
      o.tabIndex = -1;
    });
    el.classList.add('selected');
    el.setAttribute('aria-checked', 'true');
    el.tabIndex = 0;
  }

  /* ── Review prompt ────────────────────────────────────────── */
  function resetReview() {
    _reviewStars = 0;
    document.querySelectorAll('.star-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    ['reviewFeedback','reviewGoogle','reviewThanks'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const textEl = document.getElementById('feedbackText');
    if (textEl) textEl.value = '';
  }

  async function handleRating(stars) {
    _reviewStars = stars;

    document.querySelectorAll('.star-btn').forEach(b => {
      const n = parseInt(b.dataset.stars, 10);
      b.classList.toggle('active', n <= stars);
      b.setAttribute('aria-pressed', n <= stars ? 'true' : 'false');
    });

    try {
      const result = await KravonAPI.submitReview({
        order_id:      _confirmedOrderId || undefined,
        stars,
        order_surface: 'orders',
      });

      const fbEl = document.getElementById('reviewFeedback');
      const ggEl = document.getElementById('reviewGoogle');

      if (result.above_threshold && result.google_review_url) {
        const linkEl = document.getElementById('reviewGoogleLink');
        if (linkEl) linkEl.href = result.google_review_url;
        if (ggEl) ggEl.style.display = '';
        if (fbEl) fbEl.style.display = 'none';
      } else {
        if (fbEl) fbEl.style.display = '';
        if (ggEl) ggEl.style.display = 'none';
      }
    } catch (err) {
      console.error('[orders:review] submitReview failed:', err.message);
      const fbEl = document.getElementById('reviewFeedback');
      if (fbEl) fbEl.style.display = '';
    }
  }

  async function submitFeedback() {
    const textEl = document.getElementById('feedbackText');
    const feedback = textEl ? textEl.value.trim() : '';

    try {
      if (_confirmedOrderId) {
        await KravonAPI.submitReview({
          order_id:      _confirmedOrderId,
          stars:         _reviewStars,
          feedback,
          order_surface: 'orders',
        });
      }
    } catch (err) {
      console.error('[orders:review] submitFeedback failed:', err.message);
    }

    const fbEl = document.getElementById('reviewFeedback');
    const tkEl = document.getElementById('reviewThanks');
    if (fbEl) fbEl.style.display = 'none';
    if (tkEl) tkEl.style.display = '';
  }

  /* ── Private helpers ─────────────────────────────────────── */
  function _val(id)        { return (document.getElementById(id)?.value || '').trim(); }
  function _setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }

  return {
    init,
    placeOrder,
    trackOrder,
    newOrder,
    selectDelivery,
    selectPayment,
    handleRating,
    submitFeedback,
  };

})();
