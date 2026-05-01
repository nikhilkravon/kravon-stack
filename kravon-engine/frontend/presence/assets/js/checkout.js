/* ═══════════════════════════════════════════════════════════
   PRESENCE — CHECKOUT.JS
   Handles payment flow and order placement.
   Depends on: EnhancedCart, CONFIG, KravonAPI
   ═══════════════════════════════════════════════════════════ */

const CheckoutPresence = (() => {
  'use strict';

  let _config = null;
  let _selectedPaymentId = 'upi';

  /* ── Escape helper ── */
  function _esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Get element value ── */
  function _val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  /* ── Set element text ── */
  function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /* ── Format price ── */
  function _fmt(n) {
    return '₹' + (typeof n === 'number' ? n.toFixed(0) : n);
  }

  /* ── Calculate totals ── */
  function _calculateTotals() {
    const cart = EnhancedCart.items();
    const subtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
    const gstRate = (_config?.orders?.gstRate || 0.18);
    const tax = Math.round(subtotal * gstRate);
    const total = subtotal + tax;

    return { subtotal, tax, total, count: cart.length };
  }

  /* ── Build payment options ── */
  function _buildPaymentOptions() {
    const container = document.getElementById('paymentOptions');
    if (!container) return;

    const methods = (_config?.orders?.paymentMethods || [
      { id: 'upi', label: 'UPI', sub: 'Fast & secure', icon: '📲' },
      { id: 'card', label: 'Credit/Debit Card', sub: 'Visa, Mastercard, Amex', icon: '💳' },
      { id: 'netbanking', label: 'Netbanking', sub: 'All major banks', icon: '🏦' }
    ]);

    container.innerHTML = methods.map((m, i) => `
      <div class="pay-opt${i === 0 ? ' selected' : ''}"
           data-action="select-payment"
           data-payment-id="${_esc(m.id)}"
           role="radio"
           aria-checked="${i === 0 ? 'true' : 'false'}"
           tabindex="${i === 0 ? '0' : '-1'}">
        <div class="radio-circle" aria-hidden="true"><div class="radio-fill"></div></div>
        <div class="pay-opt-content">
          <div class="pay-opt-icon">${_esc(m.icon)}</div>
          <div class="pay-opt-text">
            <div>${_esc(m.label)}</div>
            <div>${_esc(m.sub)}</div>
          </div>
        </div>
      </div>`
    ).join('');

    _selectedPaymentId = methods[0]?.id || 'upi';

    const noteEl = document.getElementById('gatewayNote');
    if (noteEl && _config?.orders?.gatewayNote) {
      noteEl.innerHTML = `
        <div class="gateway-note-label">${_esc(_config.orders.gatewayNote.label)}</div>
        <div>${_esc(_config.orders.gatewayNote.body)}</div>`;
    }
  }

  /* ── Select payment method ── */
  function _selectPayment(btn) {
    document.querySelectorAll('.pay-opt').forEach(el => {
      el.classList.remove('selected');
      el.setAttribute('aria-checked', 'false');
      el.tabIndex = -1;
    });
    btn.classList.add('selected');
    btn.setAttribute('aria-checked', 'true');
    btn.tabIndex = 0;
    _selectedPaymentId = btn.dataset.paymentId || 'upi';
  }

  /* ── Render cart summary ── */
  function _renderSummary() {
    const cart = EnhancedCart.items();
    const totals = _calculateTotals();

    const itemsEl = document.getElementById('summaryItems');
    if (itemsEl) {
      itemsEl.innerHTML = cart.map(item => `
        <div class="summary-item">
          <div>
            <div class="summary-item-name">
              ${_esc(item.name)}
              ${item.specialNote ? `<span style="color:rgba(255,255,255,0.25);font-size:11px;"> · ${_esc(item.specialNote)}</span>` : ''}
            </div>
          </div>
          <div class="summary-item-qty">×${item.quantity}</div>
          <div class="summary-item-price">${_fmt(item.totalPrice)}</div>
        </div>`
      ).join('');
    }

    _setText('summarySubtotal', _fmt(totals.subtotal));
    _setText('summaryTax', _fmt(totals.tax));
    _setText('summaryTotal', _fmt(totals.total));

    return totals;
  }

  /* ── Validate form ── */
  function _validateForm() {
    const name = _val('fieldName');
    const phone = _val('fieldPhone');

    if (!name) {
      document.getElementById('fieldName').focus();
      return { valid: false, error: 'Please enter your name' };
    }

    if (!phone || phone.replace(/\D/g, '').length < 10) {
      document.getElementById('fieldPhone').focus();
      return { valid: false, error: 'Enter a valid 10-digit phone number' };
    }

    return { valid: true };
  }

  /* ── Show toast ── */
  function _showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  /* ── Place order: POST to API, open Razorpay ── */
  async function _placeOrder() {
    const validation = _validateForm();
    if (!validation.valid) {
      _showToast(validation.error);
      return;
    }

    const cart = EnhancedCart.items();
    if (cart.length === 0) {
      _showToast('Your cart is empty');
      return;
    }

    const btn = document.querySelector('[data-action="place-order"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Placing order…';
    }

    try {
      const totals = _calculateTotals();
      const orderPayload = {
        customer_name: _val('fieldName'),
        customer_phone: _val('fieldPhone').replace(/\D/g, ''),
        items: cart.map(item => ({
          menu_item_id: item.menuItemId,
          quantity: item.quantity,
          variant: item.variant ? { id: item.variant.id, name: item.variant.name } : null,
          customizations: item.customizations,
          special_note: item.specialNote
        })),
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        payment_method: _selectedPaymentId
      };

      const response = await fetch(`${KRAVON_API_URL}/v1/restaurants/${RESTAURANT_SLUG_ENV}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const orderData = await response.json();
      const orderId = orderData.order?.id || orderData.id;

      if (!orderId) {
        throw new Error('No order ID received');
      }

      // Open Razorpay checkout
      _openRazorpay(orderId, totals.total, orderData);

    } catch (err) {
      console.error('Error placing order:', err);
      _showToast('Failed to place order. Please try again.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Place Order';
      }
    }
  }

  /* ── Open Razorpay checkout ── */
  function _openRazorpay(orderId, amount, orderData) {
    const razorpayKeyId = _config?.razorpayKeyId || 'RAZORPAY_KEY_ID';

    const options = {
      key: razorpayKeyId,
      amount: Math.round(amount * 100), // Amount in paise
      currency: 'INR',
      name: _config?.brand?.name || 'Restaurant',
      order_id: orderData.razorpay_order_id || '',
      prefill: {
        name: _val('fieldName'),
        contact: _val('fieldPhone')
      },
      handler: function (response) {
        _handlePaymentSuccess(response, orderId);
      },
      modal: {
        ondismiss: function () {
          _showToast('Payment cancelled');
          const btn = document.querySelector('[data-action="place-order"]');
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Place Order';
          }
        }
      }
    };

    if (window.Razorpay) {
      new Razorpay(options).open();
    } else {
      _showToast('Payment gateway not available');
      const btn = document.querySelector('[data-action="place-order"]');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Place Order';
      }
    }
  }

  /* ── Handle payment success ── */
  async function _handlePaymentSuccess(response, orderId) {
    try {
      // Verify payment on backend
      const verifyRes = await fetch(`${KRAVON_API_URL}/v1/restaurants/${RESTAURANT_SLUG_ENV}/payments/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature
        })
      });

      if (verifyRes.ok) {
        // Clear cart and show confirmation
        EnhancedCart.clear();
        _showConfirmation(orderId);
      } else {
        throw new Error('Payment verification failed');
      }
    } catch (err) {
      console.error('Payment verification error:', err);
      _showToast('Payment recorded. Your order will be confirmed soon.');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
    }
  }

  /* ── Show confirmation screen ── */
  function _showConfirmation(orderId) {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
      <div class="confirmation-wrap">
        <div class="confirmation-icon">✅</div>
        <div class="confirmation-title">Order Confirmed!</div>
        <div class="confirmation-id">Order #${_esc(orderId)}</div>
        <div class="confirmation-text">
          Your order has been placed successfully. You'll receive a confirmation message shortly.
        </div>
        <div class="confirmation-actions">
          <a href="index.html" class="confirmation-btn primary">Back to Menu</a>
          <a href="#" class="confirmation-btn" onclick="window.print();return false;">Print Receipt</a>
        </div>
      </div>`;
  }

  /* ── Go back to menu ── */
  function _goBack() {
    window.location.href = 'index.html';
  }

  /* ── Check if cart is empty ── */
  function _checkEmptyCart() {
    const cart = EnhancedCart.items();
    if (cart.length === 0) {
      const app = document.getElementById('app');
      if (app) {
        app.innerHTML = `
          <div class="empty-cart">
            <div class="empty-cart-icon">🛒</div>
            <div class="empty-cart-title">Your cart is empty</div>
            <div class="empty-cart-text">Add items from the menu to get started</div>
            <a href="index.html" class="continue-btn">Continue Shopping</a>
          </div>`;
      }
      return true;
    }
    return false;
  }

  /* ── Render checkout page ── */
  function _render() {
    const cart = EnhancedCart.items();
    const app = document.getElementById('app');

    if (!app) return;

    const totals = _calculateTotals();
    const gstPct = Math.round((_config?.orders?.gstRate || 0.18) * 100);

    app.innerHTML = `
      <div class="checkout-header">
        <button class="checkout-back-btn" data-action="go-back" aria-label="Back">
          <svg width="20" height="20" aria-hidden="true"><use href="#icon-back"/></svg>
        </button>
        <div class="checkout-header-title">Your Order</div>
      </div>

      <div class="checkout-wrap">
        <div>
          <section class="checkout-section" aria-labelledby="checkout-details-h">
            <span class="checkout-section-title" id="checkout-details-h">Your Details</span>
            <div class="checkout-fields">
              <div class="field-group">
                <label class="field-label" for="fieldName">Name</label>
                <input type="text" id="fieldName" class="field-input"
                       placeholder="Your name" maxlength="80"
                       autocomplete="name" required>
              </div>
              <div class="field-group">
                <label class="field-label" for="fieldPhone">Phone</label>
                <input type="tel" id="fieldPhone" class="field-input"
                       placeholder="10-digit mobile number" maxlength="15"
                       autocomplete="tel" required>
              </div>
            </div>
          </section>

          <section class="checkout-section" aria-labelledby="payment-h">
            <span class="checkout-section-title" id="payment-h">Payment Method</span>
            <div id="paymentOptions"></div>
            <div class="gateway-note" id="gatewayNote"></div>
          </section>
        </div>

        <aside class="checkout-summary">
          <span class="summary-header">Order Summary</span>
          <div class="summary-items" id="summaryItems"></div>

          <div class="summary-row">
            <span class="summary-row-label">Subtotal</span>
            <span class="summary-row-value" id="summarySubtotal">₹0</span>
          </div>
          <div class="summary-row">
            <span class="summary-row-label">GST (${gstPct}%)</span>
            <span class="summary-row-value" id="summaryTax">₹0</span>
          </div>
          <div class="summary-row total">
            <span class="summary-row-label">Total</span>
            <span class="summary-row-value" id="summaryTotal">₹0</span>
          </div>

          <button class="place-order-btn" data-action="place-order">
            Place Order
          </button>
        </aside>
      </div>`;

    // Attach event listeners
    app.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'place-order') _placeOrder();
      if (action === 'go-back') _goBack();
      if (action === 'select-payment') {
        const btn = e.target.closest('.pay-opt');
        if (btn) _selectPayment(btn);
      }
    });

    // Render initial data
    _buildPaymentOptions();
    _renderSummary();

    // Load Razorpay script
    if (!window.Razorpay) {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      document.head.appendChild(script);
    }
  }

  /* ── Init ── */
  async function init() {
    try {
      await KravonAPI.loadConfig();
      _config = window.CONFIG;

      // Restore cart from sessionStorage
      const savedCart = sessionStorage.getItem('kravon_presence_cart');
      if (savedCart) {
        const cartItems = JSON.parse(savedCart);
        cartItems.forEach(item => {
          EnhancedCart.add({
            menuItemId: item.menuItemId,
            name: item.name,
            quantity: item.quantity,
            variant: item.variant,
            customizations: item.customizations,
            specialNote: item.specialNote,
            basePrice: item.basePrice
          });
        });
      }

      if (_checkEmptyCart()) return;

      _render();
    } catch (err) {
      console.error('Checkout init error:', err);
      const app = document.getElementById('app');
      if (app) {
        app.innerHTML = '<div style="padding:60px;text-align:center;color:#f00;">Failed to load checkout</div>';
      }
    }
  }

  return { init };

})();

// Init on load
document.addEventListener('DOMContentLoaded', CheckoutPresence.init);
