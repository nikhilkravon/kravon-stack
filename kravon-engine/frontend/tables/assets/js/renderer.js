/* ═══════════════════════════════════════════════════════════
   TABLES — RENDERER.JS
   Builds the complete Tables SPA from CONFIG + MENU.
   No content in index.html. All screens rendered here.

   Screens:
     screenChoice     — Dine In / Takeaway choice (only when no ?table= param)
     screenOrdering   — Nav + menu grid + mobile cart bar
     screenCheckout   — Name, phone, payment
     screenConfirm    — Confirmation + Bill Request + Review Prompt

   Menu cards:
     customisable === true  → "Customise" button → modal
     customisable !== true  → simple "+ Add" → straight to cart

   Exposes: window.TablesRenderer
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const C  = window.CONFIG;
  const M  = window.MENU;
  const TC = window.TABLE_CONTEXT;  // { tableIdentifier, isDineIn }
  const $  = id => document.getElementById(id);

  /* ── Escape ──────────────────────────────────────────────── */
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── Accent injection ────────────────────────────────────── */
  function applyAccent() {
    const hex = (C.brand?.accent || '#c2d62a').replace('#', '');
    const ri  = parseInt(hex.slice(0, 2), 16);
    const gi  = parseInt(hex.slice(2, 4), 16);
    const bi  = parseInt(hex.slice(4, 6), 16);
    const r   = document.documentElement;
    r.style.setProperty('--accent',        `#${hex}`);
    r.style.setProperty('--accent-subtle', `rgba(${ri},${gi},${bi},0.07)`);
    r.style.setProperty('--accent-border', `rgba(${ri},${gi},${bi},0.2)`);
  }

  /* ── Nav ─────────────────────────────────────────────────── */
  function buildNav(label) {
    return `
      <nav class="tables-nav" aria-label="Main navigation">
        <div class="tables-nav-brand">
          <div class="tables-nav-logo">${esc(C.brand.name)}</div>
          <div class="tables-nav-sub">${esc(C.brand.tagline)}</div>
        </div>
        <div class="tables-nav-right">
          <span class="tables-nav-badge">${esc(label)}</span>
          <button class="tables-cart-btn" id="navCartBtn"
                  data-action="open-cart" aria-label="View cart">
            <svg width="20" height="20" aria-hidden="true"><use href="#icon-cart"/></svg>
            <span class="tables-cart-count" id="navCartCount">0</span>
          </button>
        </div>
      </nav>`;
  }

  /* ── Screen: Choice ─────────────────────────────────────── */
  function buildScreenChoice() {
    return `
      <div id="screenChoice" class="tables-screen tables-screen--choice" role="main">
        <div class="choice-inner">
          <div class="choice-brand">
            <div class="choice-logo">${esc(C.brand.name)}</div>
            <div class="choice-tagline">${esc(C.brand.tagline)}</div>
          </div>
          <div class="choice-prompt">How are you dining?</div>
          <div class="choice-btns" role="group" aria-label="Dining mode">
            <button class="choice-btn choice-btn--dine"
                    data-action="choose-dining" data-mode="dine-in"
                    aria-label="Dining in">
              <span class="choice-btn-icon" aria-hidden="true">🪑</span>
              <span class="choice-btn-label">Dining In</span>
            </button>
            <button class="choice-btn choice-btn--take"
                    data-action="choose-dining" data-mode="takeaway"
                    aria-label="Takeaway">
              <span class="choice-btn-icon" aria-hidden="true">🛍</span>
              <span class="choice-btn-label">Takeaway</span>
            </button>
          </div>
        </div>
      </div>`;
  }

  /* ── Item card ───────────────────────────────────────────── */
  function buildItemCard(item) {
    const bg = item.imageBg
      ? ` style="background:${esc(item.imageBg)}"`
      : '';

    const badge = item.badge ? (() => {
      const presets = {
        top:  'background:rgba(232,160,32,0.9);color:#111;',
        veg:  'background:rgba(61,122,40,0.85);',
        hot:  'background:rgba(217,58,43,0.9);',
        save: 'background:var(--accent);color:#111;',
      };
      const css = presets[item.badgeStyle] ||
        (item.badgeStyle ? `background:${esc(item.badgeStyle)};` : '');
      return `<span class="item-badge" style="${css}">${esc(item.badge)}</span>`;
    })() : '';

    // Customisable items get a "Customise" button that opens the modal.
    // Non-customisable items get a simple "+ Add" button.
    const actionBtn = item.customisable
      ? `<button class="add-btn add-btn--customise" id="addBtn_${item.id}"
                 data-action="open-modal"
                 data-item-id="${item.id}"
                 aria-label="Customise ${esc(item.name)}">Customise</button>`
      : `<button class="add-btn" id="addBtn_${item.id}"
                 data-action="add-item"
                 data-id="${item.id}"
                 data-name="${esc(item.name)}"
                 data-price="${item.price}"
                 aria-label="Add ${esc(item.name)}">+ Add</button>`;

    return `
      <div class="menu-card" data-item-id="${item.id}" role="article"
           aria-label="${esc(item.name)}">
        <div class="menu-card-img"${bg} aria-hidden="true">
          ${item.image ? `<span class="menu-card-emoji">${esc(item.image)}</span>` : ''}
          ${badge}
        </div>
        <div class="menu-card-body">
          <div class="menu-card-name">${esc(item.name)}</div>
          ${item.desc ? `<div class="menu-card-desc">${esc(item.desc)}</div>` : ''}
          <div class="menu-card-footer">
            <span class="menu-card-price">₹${esc(item.price)}</span>
            <div class="item-qty-ctrl" id="qtyCtrl_${item.id}" style="display:none"
                 role="group" aria-label="Quantity for ${esc(item.name)}">
              <button class="qty-btn" data-action="dec-item" data-id="${item.id}"
                      aria-label="Remove one">−</button>
              <span class="qty-num" id="qtyNum_${item.id}" aria-live="polite">0</span>
              <button class="qty-btn" data-action="inc-item" data-id="${item.id}"
                      aria-label="Add one">+</button>
            </div>
            ${actionBtn}
          </div>
        </div>
      </div>`;
  }

  /* ── Screen: Ordering ────────────────────────────────────── */
  function buildScreenOrdering(navLabel) {
    const cats = M.map((cat, i) =>
      `<button class="cat-btn${i === 0 ? ' active' : ''}"
               data-action="scroll-to-cat"
               data-cat-id="${esc(cat.id)}">${esc(cat.name)}</button>`
    ).join('');

    const sections = M.map(cat => {
      const items = cat.items.map(buildItemCard).join('');
      return `
        <section class="menu-section" id="cat_${esc(cat.id)}"
                 aria-labelledby="cat_h_${esc(cat.id)}">
          <h2 class="menu-section-title" id="cat_h_${esc(cat.id)}">${esc(cat.name)}</h2>
          ${cat.subtitle ? `<p class="menu-section-sub">${esc(cat.subtitle)}</p>` : ''}
          <div class="menu-grid">${items}</div>
        </section>`;
    }).join('');

    return `
      <div id="screenOrdering" class="tables-screen" role="main" style="display:none">
        ${buildNav(navLabel)}
        <div class="tables-layout">
          <aside class="cat-sidebar" aria-label="Menu categories">
            <div class="cat-sidebar-inner">${cats}</div>
          </aside>
          <main class="menu-main" id="menuMain">
            ${sections}
          </main>
        </div>
      </div>`;
  }

  /* ── Screen: Checkout ────────────────────────────────────── */
  function buildScreenCheckout() {
    const cfg       = C.tables || {};
    const isOffline = cfg.paymentMode === 'offline' || !cfg.razorpayKeyId;

    const paymentBlock = isOffline
      ? `<div class="checkout-pay-offline">
           <span class="pay-offline-icon" aria-hidden="true">💵</span>
           <div>
             <div class="pay-offline-label">Pay at Counter</div>
             <div class="pay-offline-sub">Cash, UPI or card — pay when ready</div>
           </div>
         </div>`
      : `<div class="checkout-pay-options" id="payOptions">
           <div class="pay-opt selected" data-action="select-payment" data-payment-id="razorpay"
                role="radio" aria-checked="true" tabindex="0">
             <div class="radio-circle" aria-hidden="true"><div class="radio-fill"></div></div>
             <div class="pay-opt-icon">📲</div>
             <div>
               <div class="pay-opt-name">Pay Online</div>
               <div class="pay-opt-sub">UPI, cards, netbanking via Razorpay</div>
             </div>
           </div>
           <div class="pay-opt" data-action="select-payment" data-payment-id="offline"
                role="radio" aria-checked="false" tabindex="-1">
             <div class="radio-circle" aria-hidden="true"><div class="radio-fill"></div></div>
             <div class="pay-opt-icon">💵</div>
             <div>
               <div class="pay-opt-name">Pay at Counter</div>
               <div class="pay-opt-sub">Cash, UPI or card when ready</div>
             </div>
           </div>
         </div>`;

    return `
      <div id="screenCheckout" class="tables-screen tables-screen--checkout"
           style="display:none" role="main">
        ${buildNav('Your Order')}
        <div class="checkout-wrap">
          <div class="checkout-main">

            <section class="checkout-section" aria-labelledby="checkout-details-h">
              <h2 class="checkout-section-title" id="checkout-details-h">Your Details</h2>
              <div class="checkout-fields">
                <div class="field-group">
                  <label class="field-label" for="fieldName">Name</label>
                  <input type="text" id="fieldName" class="field-input"
                         placeholder="Your name" maxlength="80"
                         autocomplete="name" required>
                  <span class="field-err" id="errName" aria-live="polite"></span>
                </div>
                <div class="field-group">
                  <label class="field-label" for="fieldPhone">Phone</label>
                  <input type="tel" id="fieldPhone" class="field-input"
                         placeholder="10-digit mobile number" maxlength="15"
                         autocomplete="tel" required>
                  <span class="field-err" id="errPhone" aria-live="polite"></span>
                </div>
                <div class="field-group">
                  <label class="field-label" for="fieldNotes">Special Instructions
                    <span class="field-label-opt">(optional)</span>
                  </label>
                  <input type="text" id="fieldNotes" class="field-input"
                         placeholder="e.g. no onions, extra spice…"
                         maxlength="200" autocomplete="off">
                </div>
              </div>
            </section>

            <section class="checkout-section" aria-labelledby="checkout-pay-h">
              <h2 class="checkout-section-title" id="checkout-pay-h">Payment</h2>
              ${paymentBlock}
            </section>

          </div>

          <aside class="checkout-summary" aria-label="Order summary">
            <h2 class="checkout-section-title">Order Summary</h2>
            <div class="summary-items" id="summaryItems"></div>
            <div class="summary-total-row">
              <span>Total</span>
              <span id="summaryTotal" class="summary-total-val">₹0</span>
            </div>
            <button class="btn-primary place-order-btn" id="placeOrderBtn"
                    data-action="place-order">
              Place Order
            </button>
            <div class="place-order-note" id="placeOrderNote" aria-live="polite"></div>
          </aside>
        </div>
      </div>`;
  }

  /* ── Screen: Confirmation ────────────────────────────────── */
  function buildScreenConfirm() {
    return `
      <div id="screenConfirm" class="tables-screen tables-screen--confirm"
           style="display:none" role="main" aria-live="polite">
        ${buildNav('Order Placed')}
        <div class="confirm-wrap">

          <div class="confirm-card" id="confirmCard">
            <div class="confirm-check" aria-hidden="true">
              <svg width="36" height="36"><use href="#icon-check"/></svg>
            </div>
            <div class="confirm-heading">Order Placed!</div>
            <div class="confirm-sub" id="confirmSub"></div>
            <div class="confirm-id" id="confirmOrderId"></div>
          </div>

          <div id="billRequestWrap" style="display:none">
            <button class="bill-request-btn" id="billRequestBtn"
                    data-action="request-bill"
                    aria-label="Request bill via WhatsApp">
              <svg width="18" height="18" aria-hidden="true"><use href="#icon-wa"/></svg>
              Request Bill
            </button>
          </div>

          <div class="review-wrap" id="reviewWrap" aria-label="Rate your experience">
            <div class="review-heading">How was your experience?</div>
            <div class="review-stars" id="reviewStars" role="group" aria-label="Star rating">
              ${[1,2,3,4,5].map(n =>
                `<button class="star-btn" data-action="rate" data-stars="${n}"
                         aria-label="${n} star${n > 1 ? 's' : ''}"
                         aria-pressed="false">
                   <svg width="28" height="28" aria-hidden="true"><use href="#icon-star"/></svg>
                 </button>`
              ).join('')}
            </div>
            <div class="review-feedback" id="reviewFeedback" style="display:none">
              <textarea id="feedbackText" class="feedback-textarea"
                        placeholder="Tell us what we can improve…"
                        maxlength="500" rows="3"></textarea>
              <button class="btn-primary review-submit-btn"
                      data-action="submit-feedback">Send Feedback</button>
            </div>
            <div class="review-google" id="reviewGoogle" style="display:none">
              <p class="review-google-msg">We're so glad you enjoyed it! Please share on Google—it helps us a lot.</p>
              <a class="btn-primary review-google-btn" id="reviewGoogleLink"
                 href="#" target="_blank" rel="noopener noreferrer">
                Leave a Google Review ↗
              </a>
            </div>
            <div class="review-thanks" id="reviewThanks" style="display:none"
                 aria-live="polite">
              Thank you for the feedback 🙏
            </div>
          </div>

          <button class="new-order-btn" data-action="new-order"
                  aria-label="Start a new order">Order Again</button>

        </div>
      </div>`;
  }

  /* ── Cart drawer ─────────────────────────────────────────── */
  function buildCartDrawer() {
    return `
      <div class="tables-cart-drawer" id="cartDrawer"
           role="dialog" aria-modal="true"
           aria-label="Your order" aria-hidden="true">
        <div class="cart-drawer-head">
          <div class="cart-drawer-title">Your Order</div>
          <button class="cart-close-btn" data-action="close-cart"
                  aria-label="Close cart">✕</button>
        </div>
        <div class="cart-items-list" id="cartItemsList" aria-live="polite"></div>
        <div class="cart-footer" id="cartFooter" style="display:none">
          <div class="cart-total-row">
            <span>Total</span>
            <span id="cartTotalVal" class="cart-total-val">₹0</span>
          </div>
          <button class="btn-primary" data-action="go-checkout">
            Proceed to Checkout →
          </button>
        </div>
      </div>`;
  }

  /* ── Customisation modal ─────────────────────────────────── */
  function buildCustomModal() {
    return `
      <div class="modal-overlay" id="tablesCustomModal"
           role="dialog" aria-modal="true"
           aria-labelledby="tablesModalItemName" aria-hidden="true">
        <div class="modal">
          <div class="modal-header">
            <div>
              <div class="modal-title" id="tablesModalItemName"></div>
              <div class="modal-price" id="tablesModalItemPrice"></div>
            </div>
            <button class="modal-close" data-action="tables-close-modal"
                    aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <div class="modal-section">
              <span class="modal-section-label">Add-ons</span>
              <div id="tablesModalAddons"></div>
            </div>
            <div class="modal-section">
              <span class="modal-section-label">Spice Level</span>
              <div class="spice-options" id="tablesSpiceOptions"></div>
            </div>
            <div class="modal-section">
              <span class="modal-section-label">Special Instructions</span>
              <input type="text" id="tablesSpecialInput" class="form-input"
                     placeholder="e.g. no pickles, extra sauce…"
                     maxlength="120" autocomplete="off">
            </div>
          </div>
          <div class="modal-footer">
            <div class="modal-qty" role="group" aria-label="Quantity">
              <button class="modal-qty-btn" data-action="tables-modal-qty-dec"
                      aria-label="Decrease">−</button>
              <span class="modal-qty-num" id="tablesModalQty" aria-live="polite">1</span>
              <button class="modal-qty-btn" data-action="tables-modal-qty-inc"
                      aria-label="Increase">+</button>
            </div>
            <button class="btn-primary modal-add-btn" id="tablesModalAddBtn"
                    data-action="tables-modal-confirm">
              Add to Order
            </button>
          </div>
        </div>
      </div>`;
  }

  /* ── Main init ───────────────────────────────────────────── */
  function initTablesRenderer() {
    applyAccent();

    document.title = `${C.brand.name} — Order Direct`;
    const descEl = document.getElementById('pageDesc');
    if (descEl) descEl.content = `${C.brand.name} — ${C.brand.tagline}`;

    const isDineIn = TC.isDineIn;
    const table    = TC.tableIdentifier;
    const navLabel = isDineIn ? `Table ${table}` : 'Order';

    const app = document.getElementById('app');
    app.innerHTML = [
      buildScreenChoice(),
      buildScreenOrdering(navLabel),
      buildScreenCheckout(),
      buildScreenConfirm(),
      buildCartDrawer(),
      buildCustomModal(),
    ].join('');

    if (isDineIn) {
      showScreen('screenOrdering');
    } else {
      showScreen('screenChoice');
    }

    Kravon.renderFooter(C.brand, C.contact, C.footer);
    Kravon.renderDemoBanner(C.demo);
    Kravon.scrollReveal();
  }

  /* ── Screen management ───────────────────────────────────── */
  function showScreen(id) {
    const screens = ['screenChoice', 'screenOrdering', 'screenCheckout', 'screenConfirm'];
    screens.forEach(s => {
      const el = document.getElementById(s);
      if (el) el.style.display = s === id ? '' : 'none';
    });
    const mobileBar = document.getElementById('mobileCartBar');
    if (mobileBar) mobileBar.style.display = id === 'screenOrdering' ? '' : 'none';
  }

  /* ── Item button state update ────────────────────────────── */
  function updateItemBtn(id) {
    const qty     = TablesCart.getQtyById(id);
    const addBtn  = document.getElementById(`addBtn_${id}`);
    const qtyCtrl = document.getElementById(`qtyCtrl_${id}`);
    const qtyNum  = document.getElementById(`qtyNum_${id}`);

    // Customisable items: "Customise" button always stays visible
    // (quantity stepper shows alongside it, never replaces it)
    const item = _findMenuItem(id);
    if (item && item.customisable) {
      if (qtyCtrl) qtyCtrl.style.display = qty > 0 ? '' : 'none';
      if (qtyNum)  qtyNum.textContent    = qty;
      // addBtn stays visible always so user can add another customised variant
    } else {
      if (addBtn)  addBtn.style.display  = qty > 0 ? 'none' : '';
      if (qtyCtrl) qtyCtrl.style.display = qty > 0 ? ''     : 'none';
      if (qtyNum)  qtyNum.textContent    = qty;
    }
  }

  /* ── Cart drawer render ──────────────────────────────────── */
  function renderCartDrawer() {
    const items    = TablesCart.getItems();
    const totals   = TablesCart.getTotals();
    const listEl   = document.getElementById('cartItemsList');
    const footerEl = document.getElementById('cartFooter');
    const mobileCount = document.getElementById('mobileCartCount');
    const mobileTotal = document.getElementById('mobileCartTotal');
    const navCount    = document.getElementById('navCartCount');

    if (!listEl) return;

    if (items.length === 0) {
      listEl.innerHTML = `<div class="cart-empty">Your order is empty</div>`;
      if (footerEl) footerEl.style.display = 'none';
    } else {
      listEl.innerHTML = items.map((item, idx) => `
        <div class="cart-item" aria-label="${esc(item.name)}, ₹${item.price * item.qty}">
          <div class="cart-item-info">
            <span class="cart-item-name">${esc(item.name)}</span>
            ${item.note ? `<span class="cart-item-note">${esc(item.note)}</span>` : ''}
          </div>
          <div class="cart-item-right">
            <div class="cart-item-qty" role="group"
                 aria-label="Quantity for ${esc(item.name)}">
              <button class="qty-btn" data-action="cart-dec"
                      data-idx="${idx}" aria-label="Remove one">−</button>
              <span aria-live="polite">${item.qty}</span>
              <button class="qty-btn" data-action="cart-inc"
                      data-idx="${idx}" aria-label="Add one">+</button>
            </div>
            <span class="cart-item-price">₹${item.price * item.qty}</span>
          </div>
        </div>`
      ).join('');

      if (footerEl) {
        footerEl.style.display = '';
        const totalEl = document.getElementById('cartTotalVal');
        if (totalEl) totalEl.textContent = `₹${totals.total}`;
      }
    }

    const count = totals.count;
    if (navCount)    navCount.textContent    = count;
    if (mobileCount) mobileCount.textContent = count;
    if (mobileTotal) mobileTotal.textContent = `₹${totals.total}`;

    const mobileBar = document.getElementById('mobileCartBar');
    if (mobileBar) mobileBar.style.display = count > 0 ? '' : 'none';
  }

  /* ── Summary in checkout screen ─────────────────────────── */
  function renderCheckoutSummary() {
    const items   = TablesCart.getItems();
    const totals  = TablesCart.getTotals();
    const listEl  = document.getElementById('summaryItems');
    const totalEl = document.getElementById('summaryTotal');

    if (listEl) {
      listEl.innerHTML = items.map(i => `
        <div class="summary-item">
          <span>${i.qty}× ${esc(i.name)}${i.note ? ` <span class="summary-item-note">${esc(i.note)}</span>` : ''}</span>
          <span>₹${i.price * i.qty}</span>
        </div>`
      ).join('');
    }
    if (totalEl) totalEl.textContent = `₹${totals.total}`;
  }

  /* ── Private: find menu item by id ─────────────────────── */
  function _findMenuItem(id) {
    for (const cat of (window.MENU || [])) {
      const item = cat.items.find(i => String(i.id) === String(id));
      if (item) return item;
    }
    return null;
  }

  window.initTablesRenderer = initTablesRenderer;
  window.TablesRenderer = {
    showScreen,
    updateItemBtn,
    renderCartDrawer,
    renderCheckoutSummary,
  };

})();
