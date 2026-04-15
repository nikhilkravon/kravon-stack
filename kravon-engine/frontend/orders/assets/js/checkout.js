/* ═══════════════════════════════════════════════════════════
   CHECKOUT.JS — V7 → V8 MIGRATION
   All UI logic (delivery/payment selection, form validation,
   screen transitions) is UNCHANGED from V7.

   ONE function changed: placeOrder()
   Before: generated a random client-side order ID
   After:  POSTs to kravon-core API, receives a real DB order ID,
           then opens Razorpay checkout.js for card/UPI payments.

   Depends on: window.CONFIG (set by boot.js via API)
               window.KravonAPI (api-client/kravon-api.js)
               cart.js  (Cart)
               ui.js    (UI)
   ═══════════════════════════════════════════════════════════ */
const Checkout = (() => {

  let _selectedPayment     = '';
  let _selectedPaymentId   = 'upi';
  let _selectedDeliveryType = 'standard';

  /* ── Build delivery options from config ── */
  function buildDeliveryOptions() {
    const container = document.getElementById('deliveryOptions');
    if (!container) return;

    const cfg = Cart.getConfig();
    const opts = [
      { type: 'standard', name: CONFIG.orders.deliveryStandardLabel, sub: CONFIG.orders.deliveryStandardSub, price: cfg.deliveryStandard },
      { type: 'express',  name: CONFIG.orders.deliveryExpressLabel,  sub: CONFIG.orders.deliveryExpressSub,  price: cfg.deliveryExpress  },
    ];

    container.innerHTML = opts.map((opt, i) => `
      <div class="delivery-opt${i === 0 ? ' selected' : ''}"
           data-action="select-delivery"
           data-delivery-type="${_esc(opt.type)}"
           role="radio"
           aria-checked="${i === 0 ? 'true' : 'false'}"
           tabindex="${i === 0 ? '0' : '-1'}">
        <div class="delivery-opt-left">
          <div class="radio-circle" aria-hidden="true"><div class="radio-fill"></div></div>
          <div>
            <div class="delivery-opt-name">${_esc(opt.name)}</div>
            <div class="delivery-opt-sub">${_esc(opt.sub)}</div>
          </div>
        </div>
        <span class="delivery-opt-price">${Cart.fmt(opt.price)}</span>
      </div>`
    ).join('');
  }

  /* ── Build payment options from config ── */
  function buildPaymentOptions() {
    const container = document.getElementById('paymentOptions');
    if (!container) return;

    container.innerHTML = CONFIG.orders.paymentMethods.map((m, i) => `
      <div class="pay-opt${i === 0 ? ' selected' : ''}"
           data-action="select-payment"
           data-payment-id="${_esc(m.id)}"
           role="radio"
           aria-checked="${i === 0 ? 'true' : 'false'}"
           tabindex="${i === 0 ? '0' : '-1'}">
        <div class="radio-circle" aria-hidden="true"><div class="radio-fill"></div></div>
        <div class="pay-opt-icon">${_esc(m.icon)}</div>
        <div>
          <div class="pay-opt-name">${_esc(m.label)}</div>
          <div class="pay-opt-sub">${_esc(m.sub)}</div>
        </div>
      </div>`
    ).join('');

    _selectedPayment   = CONFIG.orders.paymentMethods[0]?.label || 'UPI';
    _selectedPaymentId = CONFIG.orders.paymentMethods[0]?.id    || 'upi';

    const noteEl = document.getElementById('gatewayNote');
    if (noteEl && CONFIG.orders.gatewayNote) {
      noteEl.innerHTML = `
        <div>
          <div class="razorpay-label">${_esc(CONFIG.orders.gatewayNote.label)}</div>
          <div class="razorpay-sub">${_esc(CONFIG.orders.gatewayNote.body)}</div>
        </div>`;
    }

    const gstPct = Math.round(CONFIG.orders.gstRate * 100);
    const summaryGstEl = document.getElementById('summaryGstLabel');
    if (summaryGstEl) summaryGstEl.textContent = `GST (${gstPct}%)`;
  }

  function selectDelivery(el) {
    const type = el.dataset.deliveryType;
    _selectedDeliveryType = type;
    const cfg  = Cart.getConfig();
    const fee  = type === 'express' ? cfg.deliveryExpress : cfg.deliveryStandard;

    document.querySelectorAll('.delivery-opt').forEach(o => {
      o.classList.remove('selected');
      o.setAttribute('aria-checked', 'false');
      o.tabIndex = -1;
    });
    el.classList.add('selected');
    el.setAttribute('aria-checked', 'true');
    el.tabIndex = 0;

    Cart.setDeliveryFee(fee);
    _refreshSummary();

    const cartDelivEl = document.getElementById('cartDelivery');
    if (cartDelivEl) {
      const totals = Cart.getTotals();
      cartDelivEl.textContent = totals.freeDelivery ? 'Free' : Cart.fmt(totals.del);
    }
    const cartTotalEl = document.getElementById('cartTotal');
    if (cartTotalEl) cartTotalEl.textContent = Cart.fmt(Cart.getTotals().total);
  }

  function selectPayment(el) {
    document.querySelectorAll('.pay-opt').forEach(o => {
      o.classList.remove('selected');
      o.setAttribute('aria-checked', 'false');
      o.tabIndex = -1;
    });
    el.classList.add('selected');
    el.setAttribute('aria-checked', 'true');
    el.tabIndex = 0;
    _selectedPayment   = el.querySelector('.pay-opt-name')?.textContent || '';
    _selectedPaymentId = el.dataset.paymentId || 'upi';
  }

  function resetDeliveryAria() {
    const opts = document.querySelectorAll('.delivery-opt');
    opts.forEach((el, i) => {
      el.classList.toggle('selected', i === 0);
      el.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
      el.tabIndex = i === 0 ? 0 : -1;
    });
    _selectedDeliveryType = 'standard';
  }

  function goToCheckout() {
    const totals = Cart.getTotals();
    if (totals.belowMin) return;

    const name     = _val('fieldName');
    const phone    = _val('fieldPhone');
    const address  = _val('fieldAddress');
    const locality = _val('fieldLocality');

    if (!name)    { UI.showToast('Please enter your name');   document.getElementById('fieldName')?.focus();     return; }
    if (!phone || phone.replace(/\D/g, '').length < 10) { UI.showToast('Enter a valid 10-digit number'); document.getElementById('fieldPhone')?.focus(); return; }
    if (!address) { UI.showToast('Please enter your address'); document.getElementById('fieldAddress')?.focus(); return; }
    if (!locality){ UI.showToast('Please enter your locality');document.getElementById('fieldLocality')?.focus();return; }

    const summaryEl = document.getElementById('summaryItems');
    if (summaryEl) {
      summaryEl.innerHTML = Cart.getItems().map(i => `
        <div class="summary-item">
          <div>
            <div class="summary-item-name">
              ${_esc(i.name)}
              ${i.note ? `<span style="color:rgba(255,255,255,0.25);font-size:11px;"> · ${_esc(i.note)}</span>` : ''}
            </div>
            <div class="summary-item-qty">×${i.qty}</div>
          </div>
          <div class="summary-item-price">${Cart.fmt(i.price * i.qty)}</div>
        </div>`
      ).join('');
    }

    _refreshSummary();
    resetDeliveryAria();
    UI.showScreen('screenCheckout');
  }

  function _refreshSummary() {
    const totals = Cart.getTotals();
    _setText('summarySubtotal', Cart.fmt(totals.sub));
    _setText('summaryDelivery', totals.freeDelivery ? 'Free' : Cart.fmt(totals.del));
    _setText('summaryTax',      Cart.fmt(totals.tax));
    _setText('summaryTotal',    Cart.fmt(totals.total));
  }

  /* ═══════════════════════════════════════════════════════════
     PLACE ORDER — THE KEY CHANGE FROM V7
     Before: random ID, no API call, fake confirmation
     After:  POST to kravon-core → real DB order → Razorpay
     ═══════════════════════════════════════════════════════════ */
  async function placeOrder() {
    const totals = Cart.getTotals();
    if (totals.belowMin) return;

    // Disable button while in flight
    const btn = document.querySelector('[data-action="place-order"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Placing order…'; }

    try {
      const orderPayload = {
        customer_name:    _val('fieldName'),
        customer_phone:   _val('fieldPhone').replace(/\D/g, ''),
        delivery_address: _val('fieldAddress'),
        delivery_locality: _val('fieldLocality'),
        delivery_landmark: _val('fieldLandmark') || undefined,
        items:            Cart.getItems().map(i => ({
          id:     i.id,
          name:   i.name,
          price:  i.price,
          qty:    i.qty,
          note:   i.note   || undefined,
          addons: i.addons || [],
        })),
        delivery_type:    _selectedDeliveryType,
        payment_method:   _selectedPaymentId,
      };

      const result = await KravonAPI.createOrder(orderPayload);

      if (_selectedPaymentId !== 'cod' && result.razorpay_order_id) {
        // Open Razorpay checkout modal
        _openRazorpay(result);
      } else {
        // COD — go straight to confirmation
        _showConfirmation(result.order_id, totals.total);
      }

    } catch (err) {
      UI.showToast(err.message || 'Order failed. Please try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
    }
  }

  function _openRazorpay(result) {
    const options = {
      key:       result.razorpay_key_id,
      amount:    result.total,
      currency:  'INR',
      order_id:  result.razorpay_order_id,
      name:      CONFIG.brand.name,
      description: 'Direct Order',
      prefill: {
        name:    _val('fieldName'),
        contact: _val('fieldPhone'),
      },
      theme: { color: '#E8FF00' },
      handler: function(response) {
        // Payment captured — webhook handles DB confirmation
        // Frontend just shows the confirmation screen
        _showConfirmation(result.order_id, result.total);
      },
      modal: {
        ondismiss: function() {
          const btn = document.querySelector('[data-action="place-order"]');
          if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
        },
      },
    };

    const rzp = new Razorpay(options);
    rzp.open();
  }

  function _showConfirmation(orderId, total) {
    const prefix = (CONFIG.brand.name || 'ORD').replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase();
    const displayId = `${prefix}-${orderId}`;

    _setText('confirmOrderId', displayId);
    _setText('confirmTotal',   Cart.fmt(total));
    _setText('confirmPayment', _selectedPayment);
    _setText('confirmName',    _val('fieldName'));

    Cart.clear();
    UI.showScreen('screenConfirm');
  }

  /* ── trackOrder and newOrder are UNCHANGED from V7 ── */
  function trackOrder() {
    const orderId  = document.getElementById('confirmOrderId')?.textContent || '';
    const template = CONFIG.orders.trackingMessage || "Hi! Track my order {orderId}.";
    const msg      = template.replace('{orderId}', orderId);
    window.open('https://wa.me/' + CONFIG.contact.waNumber + '?text=' + encodeURIComponent(msg), '_blank', 'noopener,noreferrer');
  }

  function newOrder() {
    Cart.clear();
    document.querySelectorAll('.delivery-opt').forEach((o, i) => { o.classList.toggle('selected', i===0); o.setAttribute('aria-checked', i===0?'true':'false'); });
    document.querySelectorAll('.pay-opt').forEach((o, i) => { o.classList.toggle('selected', i===0); o.setAttribute('aria-checked', i===0?'true':'false'); });
    _selectedPayment = CONFIG.orders.paymentMethods[0]?.label || 'UPI';
    _selectedPaymentId = CONFIG.orders.paymentMethods[0]?.id  || 'upi';
    ['fieldName','fieldPhone','fieldAddress','fieldLocality','fieldLandmark'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    UI.renderCart();
    UI.showScreen('screenOrdering');
  }

  /* ── Private helpers (identical to V7) ── */
  function _val(id)        { return (document.getElementById(id)?.value || '').trim(); }
  function _setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
  function _esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function init() {
    buildDeliveryOptions();
    buildPaymentOptions();
  }

  return { init, selectDelivery, selectPayment, goToCheckout, placeOrder, trackOrder, newOrder };

})();
