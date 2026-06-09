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
    const TC    = window.TABLE_CONTEXT;
    const btn   = document.getElementById('placeOrderBtn');
    const note  = document.getElementById('placeOrderNote');
    const items = TablesCart.getItems();
    const notes = document.getElementById('fieldNotes')?.value.trim() || '';

    if (!items.length) {
      if (note) note.textContent = 'Your cart is empty.';
      return;
    }

    if (TC.sessionId) {
      // ── Dine-in with active session ──────────────────────
      if (btn) btn.disabled = true;
      if (note) note.textContent = 'Placing order…';
      try {
        const result = await KravonAPI.createDineInOrder(
          TC.sessionId, TC.guestName, TC.guestPhone, items, notes
        );
        _orderId = result.order_id;
        showConfirmScreen(result.order_id, { isDineIn: true });
      } catch (err) {
        console.error('[tables:checkout] dine-in order failed:', err.message);
        if (note) note.textContent = err.message || 'Something went wrong. Please try again.';
        if (btn) btn.disabled = false;
      }
      return;
    }

    // ── Takeaway / no session — generic order route ────────
    if (!validateFields()) return;
    if (btn) btn.disabled = true;
    if (note) note.textContent = 'Placing order…';

    const name  = document.getElementById('fieldName').value.trim();
    const phone = document.getElementById('fieldPhone').value.trim();

    const orderData = {
      order_surface:    'tables',
      customer_name:    name,
      customer_phone:   phone,
      table_identifier: 'takeaway',
      items: items.map(i => ({
        id:    i.id,
        name:  i.name,
        price: i.price,
        qty:   i.qty,
        note:  i.note || undefined,
      })),
      payment_method: _selectedPaymentId,
      special_notes:  notes || undefined,
    };

    try {
      const { order } = await KravonAPI.createOrder(orderData);
      _orderId          = order.id;
      _deferredBillTable = 'takeaway';
      if (_selectedPaymentId === 'razorpay' && order.razorpay_order_id) {
        openRazorpay(order, name, phone, orderData);
      } else {
        showConfirmScreen(order.id, orderData);
      }
    } catch (err) {
      console.error('[tables:checkout] placeOrder failed:', err.message);
      if (note) note.textContent = err.message || 'Something went wrong. Please try again.';
      if (btn) btn.disabled = false;
    }
  }

  /* ── Razorpay checkout ───────────────────────────────────── */
  function openRazorpay(order, name, phone, orderData) {
    const cfg = window.CONFIG.tables || {};
    const options = {
      key:         order.razorpay_key_id,
      order_id:    order.razorpay_order_id,
      amount:      order.total,
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
          if (note) note.textContent = '';
          Kravon.toast('Payment cancelled. You can try again.');
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
    // Clear persisted cart — order successfully placed
    const _TC = window.TABLE_CONTEXT;
    if (_TC?.isDineIn && _TC.sessionId && window.CONFIG?.slug) {
      TablesCart.clearPersisted(window.CONFIG.slug, _TC.sessionId);
    }

    // Update all item button states
    (window.MENU || []).forEach(cat =>
      cat.items.forEach(item => TablesRenderer.updateItemBtn(item.id))
    );

    const TC = window.TABLE_CONTEXT;
    const isDineIn = TC.isDineIn ||
      (orderData && orderData.table_identifier && orderData.table_identifier !== 'takeaway');

    if (isDineIn) {
      // ── Dine-in: Table Session screen ────────────────────
      // Reflect already-requested bill state
      const billBtn = document.getElementById('billRequestBtn');
      if (billBtn && TC.billRequested) {
        billBtn.textContent = 'Bill Requested ✓';
        billBtn.disabled = true;
        billBtn.classList.add('bill-requested');
      }

      // Fetch and render aggregated table orders
      if (TC.sessionId) {
        KravonAPI.getDineInSessionOrders(TC.sessionId)
          .then(d => TablesCheckout.renderSessionOrders(d.orders))
          .catch(() => {
            const listEl = document.getElementById('sessionOrdersList');
            if (listEl) listEl.innerHTML = '<div class="session-orders-empty">Could not load orders.</div>';
          });
      }
    } else {
      // ── Takeaway: populate standard confirm card ──────────
      const subEl = document.getElementById('confirmSub');
      const idEl  = document.getElementById('confirmOrderId');
      if (subEl) subEl.textContent = 'Your order is being prepared. Please collect at counter.';
      if (idEl)  idEl.textContent  = `Order ID: ORD-${orderId}`;
    }

    // Reset review state
    resetReview();
  }

  /* ── Render aggregated session orders with running total ─────── */
  function renderSessionOrders(orders) {
    const listEl  = document.getElementById('sessionOrdersList');
    const totalEl = document.getElementById('sessionBillTotal');
    if (!listEl) return;

    if (!orders || !orders.length) {
      listEl.innerHTML = '<div class="session-orders-empty">No orders yet at this table.</div>';
      if (totalEl) totalEl.style.display = 'none';
      return;
    }

    // Aggregate item quantities + running price
    const totals = new Map(); // name → { qty, price }
    let grandTotal = 0;
    for (const order of orders) {
      grandTotal += Number(order.total) || 0;
      for (const item of (order.items || [])) {
        const existing = totals.get(item.name);
        if (existing) {
          existing.qty += item.qty;
        } else {
          totals.set(item.name, { qty: item.qty, price: Number(item.price) || 0 });
        }
      }
    }

    listEl.innerHTML = [...totals.entries()]
      .map(([name, { qty, price }]) => {
        const lineTotal = qty * price;
        return `<div class="session-order-row">
           <span class="session-order-qty">${qty} ×</span>
           <span class="session-order-name">${Kravon.esc(name)}</span>
           ${price > 0 ? `<span class="session-order-price">₹${lineTotal.toFixed(0)}</span>` : ''}
         </div>`;
      }).join('');

    if (totalEl) {
      totalEl.style.display = '';
      totalEl.innerHTML = `<span class="session-total-label">Running Total</span>
        <span class="session-total-val">₹${grandTotal.toFixed(0)}</span>`;
    }
  }

  /* ── Bill request ─────────────────────────────────────────── */
  let _billRequested = false;

  async function requestBill(btn) {
    if (_billRequested) return;
    const TC = window.TABLE_CONTEXT;
    if (!TC.sessionId) return;

    btn.disabled = true;
    btn.textContent = 'Requesting…';

    try {
      await KravonAPI.requestDineInBill(TC.sessionId, TC.guestName || undefined);
      _billRequested = true;
      TC.billRequested = true;
      btn.textContent = 'Bill Requested ✓';
      btn.classList.add('bill-requested');
      Kravon.toast('Staff has been notified — they\'ll be with you shortly.');
    } catch (err) {
      console.error('[tables:checkout] requestBill failed:', err.message);
      btn.disabled = false;
      btn.textContent = 'Request Bill';
      Kravon.toast('Could not send request. Please try again.');
    }
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
    const tableId = TC.tableName || 'takeaway';

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
    const tableId = TC.tableName || 'takeaway';

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
    renderSessionOrders,
    handleRating,
    submitFeedback,
    selectPayment,
  };

})();
