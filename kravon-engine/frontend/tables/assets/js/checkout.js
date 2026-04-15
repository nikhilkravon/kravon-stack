/* ═══════════════════════════════════════════════════════════
   TABLES — CHECKOUT.JS
   Handles order placement for both offline and Razorpay payment modes.
   Also owns: bill request (WhatsApp deep link), review prompt + submit.
   ═══════════════════════════════════════════════════════════ */
const TablesCheckout = (() => {
  'use strict';

  let _orderId          = null;
  let _selectedPaymentId = 'offline';
  let _deferredBillTable = null;  // table identifier for bill request

  function init() {
    // Default payment selection based on config
    const cfg = window.CONFIG.tables || {};
    _selectedPaymentId = (cfg.paymentMode === 'razorpay' && cfg.razorpayKeyId)
      ? 'razorpay'
      : 'offline';
  }

  /* ── Validation ──────────────────────────────────────────── */
  function validateFields() {
    const name  = document.getElementById('fieldName');
    const phone = document.getElementById('fieldPhone');
    let valid = true;

    const errName  = document.getElementById('errName');
    const errPhone = document.getElementById('errPhone');
    if (errName)  errName.textContent  = '';
    if (errPhone) errPhone.textContent = '';

    if (!name || !name.value.trim()) {
      if (errName) errName.textContent = 'Please enter your name';
      if (name) name.focus();
      valid = false;
    }

    const phoneVal = phone ? phone.value.trim().replace(/\s+/g, '') : '';
    if (!phoneVal || !/^\+?[0-9]{10,15}$/.test(phoneVal)) {
      if (errPhone) errPhone.textContent = 'Please enter a valid phone number';
      if (valid && phone) phone.focus();
      valid = false;
    }

    return valid;
  }

  /* ── Place order ─────────────────────────────────────────── */
  async function placeOrder() {
    if (!validateFields()) return;

    const btn  = document.getElementById('placeOrderBtn');
    const note = document.getElementById('placeOrderNote');
    if (btn) btn.disabled = true;
    if (note) note.textContent = 'Placing order…';

    const items = TablesCart.getItems();
    if (!items.length) {
      if (note) note.textContent = 'Your cart is empty.';
      if (btn) btn.disabled = false;
      return;
    }

    const TC     = window.TABLE_CONTEXT;
    const name   = document.getElementById('fieldName').value.trim();
    const phone  = document.getElementById('fieldPhone').value.trim();
    const notes  = document.getElementById('fieldNotes')?.value.trim() || '';

    // Determine table identifier
    const tableId = TC.tableIdentifier || 'takeaway';

    const orderData = {
      order_surface:    'tables',
      customer_name:    name,
      customer_phone:   phone,
      table_identifier: tableId,
      items: items.map(i => ({
        id:    parseInt(i.id, 10),
        name:  i.name,
        price: i.price,
        qty:   i.qty,
        note:  i.note || undefined,
      })),
      payment_method: _selectedPaymentId,
      special_notes:  notes || undefined,
    };

    try {
      const result = await KravonAPI.createOrder(orderData);
      _orderId = result.order_id;
      _deferredBillTable = tableId;

      if (_selectedPaymentId === 'razorpay' && result.razorpay_order_id) {
        // Open Razorpay checkout
        openRazorpay(result, name, phone, orderData);
      } else {
        // Offline / immediate confirm
        showConfirmScreen(result.order_id, orderData);
      }
    } catch (err) {
      console.error('[tables:checkout] placeOrder failed:', err.message);
      if (note) note.textContent = err.message || 'Something went wrong. Please try again.';
      if (btn) btn.disabled = false;
    }
  }

  /* ── Razorpay checkout ───────────────────────────────────── */
  function openRazorpay(result, name, phone, orderData) {
    const cfg = window.CONFIG.tables || {};
    const options = {
      key:         result.razorpay_key_id,
      order_id:    result.razorpay_order_id,
      amount:      result.total,
      currency:    'INR',
      name:        window.CONFIG.brand.name,
      description: `Order — ${orderData.table_identifier !== 'takeaway' ? 'Table ' + orderData.table_identifier : 'Takeaway'}`,
      prefill: { name, contact: phone },
      theme: { color: window.CONFIG.brand.accent || '#c2d62a' },
      handler: function (response) {
        // Payment captured — backend webhook will confirm the order.
        // Frontend shows confirmation immediately for UX.
        showConfirmScreen(_orderId, orderData);
      },
      modal: {
        ondismiss: function () {
          const btn  = document.getElementById('placeOrderBtn');
          const note = document.getElementById('placeOrderNote');
          if (btn) btn.disabled = false;
          if (note) note.textContent = 'Payment was not completed.';
        }
      }
    };

    if (typeof Razorpay === 'undefined') {
      // Load Razorpay script on demand
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => new Razorpay(options).open();
      document.head.appendChild(script);
    } else {
      new Razorpay(options).open();
    }
  }

  /* ── Show confirmation screen ────────────────────────────── */
  function showConfirmScreen(orderId, orderData) {
    TablesRenderer.showScreen('screenConfirm');
    TablesCart.clear();

    // Update all item button states
    (window.MENU || []).forEach(cat =>
      cat.items.forEach(item => TablesRenderer.updateItemBtn(item.id))
    );

    // Populate confirm card
    const subEl = document.getElementById('confirmSub');
    const idEl  = document.getElementById('confirmOrderId');
    const TC    = window.TABLE_CONTEXT;

    if (subEl) {
      const isDineIn = TC.isDineIn || (orderData.table_identifier && orderData.table_identifier !== 'takeaway');
      subEl.textContent = isDineIn
        ? `Your order is in the kitchen.`
        : `Your order is being prepared. Please collect at counter.`;
    }
    if (idEl) idEl.textContent = `Order ID: ORD-${orderId}`;

    // Bill Request — only for dine-in
    const billWrap = document.getElementById('billRequestWrap');
    const TC2 = window.TABLE_CONTEXT;
    if (billWrap) {
      const isDineIn = TC2.isDineIn ||
        (orderData.table_identifier && orderData.table_identifier !== 'takeaway');
      billWrap.style.display = isDineIn ? '' : 'none';

      // Pre-wire the bill request button
      const billBtn = document.getElementById('billRequestBtn');
      if (billBtn) {
        const tableLabel = TC2.tableIdentifier || orderData.table_identifier || 'my table';
        const waNumber = window.CONFIG.contact?.waNumber || '';
        const msg = encodeURIComponent(`Bill please — Table ${tableLabel}.`);
        billBtn.dataset.waUrl = `https://wa.me/${waNumber}?text=${msg}`;
      }
    }

    // Reset review state
    resetReview();
  }

  /* ── Bill request ─────────────────────────────────────────── */
  function requestBill(btn) {
    const url = btn.dataset.waUrl;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  /* ── Review prompt ───────────────────────────────────────── */
  let _selectedStars = 0;

  function resetReview() {
    _selectedStars = 0;
    document.querySelectorAll('.star-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    const fbEl = document.getElementById('reviewFeedback');
    const ggEl = document.getElementById('reviewGoogle');
    const tkEl = document.getElementById('reviewThanks');
    if (fbEl) fbEl.style.display = 'none';
    if (ggEl) ggEl.style.display = 'none';
    if (tkEl) tkEl.style.display = 'none';
  }

  async function handleRating(stars) {
    _selectedStars = stars;

    // Highlight stars up to selected
    document.querySelectorAll('.star-btn').forEach(b => {
      const n = parseInt(b.dataset.stars, 10);
      b.classList.toggle('active', n <= stars);
      b.setAttribute('aria-pressed', n <= stars ? 'true' : 'false');
    });

    const TC = window.TABLE_CONTEXT;
    const tableId = TC.tableIdentifier || 'takeaway';

    try {
      const result = await KravonAPI.submitReview({
        order_id:         _orderId || undefined,
        stars,
        order_surface:    'tables',
        table_identifier: tableId,
      });

      const fbEl = document.getElementById('reviewFeedback');
      const ggEl = document.getElementById('reviewGoogle');

      if (result.above_threshold && result.google_review_url) {
        // Show Google review link
        const linkEl = document.getElementById('reviewGoogleLink');
        if (linkEl) linkEl.href = result.google_review_url;
        if (ggEl) ggEl.style.display = '';
        if (fbEl) fbEl.style.display = 'none';
      } else {
        // Show private feedback box
        if (fbEl) fbEl.style.display = '';
        if (ggEl) ggEl.style.display = 'none';
      }
    } catch (err) {
      console.error('[tables:review] submitReview failed:', err.message);
      // Still show feedback box as fallback
      const fbEl = document.getElementById('reviewFeedback');
      if (fbEl) fbEl.style.display = '';
    }
  }

  async function submitFeedback() {
    const textEl = document.getElementById('feedbackText');
    const feedback = textEl ? textEl.value.trim() : '';

    const TC = window.TABLE_CONTEXT;
    const tableId = TC.tableIdentifier || 'takeaway';

    try {
      // Update review with feedback text
      if (_orderId) {
        await KravonAPI.submitReview({
          order_id:         _orderId,
          stars:            _selectedStars,
          feedback,
          order_surface:    'tables',
          table_identifier: tableId,
        });
      }
    } catch (err) {
      console.error('[tables:review] submitFeedback failed:', err.message);
    }

    // Show thank you regardless
    const fbEl = document.getElementById('reviewFeedback');
    const tkEl = document.getElementById('reviewThanks');
    if (fbEl) fbEl.style.display = 'none';
    if (tkEl) tkEl.style.display = '';
  }

  /* ── Payment selection ───────────────────────────────────── */
  function selectPayment(el) {
    const id = el.dataset.paymentId;
    _selectedPaymentId = id;
    document.querySelectorAll('.pay-opt').forEach(o => {
      o.classList.remove('selected');
      o.setAttribute('aria-checked', 'false');
      o.tabIndex = -1;
    });
    el.classList.add('selected');
    el.setAttribute('aria-checked', 'true');
    el.tabIndex = 0;
  }

  return {
    init,
    placeOrder,
    requestBill,
    handleRating,
    submitFeedback,
    selectPayment,
  };

})();
