/* ═══════════════════════════════════════════════════════════
   ORDERS — RENDERER.JS
   Builds the Orders SPA (Tables-style UI) from CONFIG + MENU.
   Screens:
     screenOrdering  — nav + hero + sidebar + menu grid
     screenCheckout  — delivery details + delivery type + payment
     screenConfirm   — confirmation + track on WhatsApp + review
   Pay-first: customer fills details before placing order.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  let C, O, M;
  const $ = id => document.getElementById(id);

  /* ── Nav ─────────────────────────────────────────────────── */
  function buildNav(label) {
    return `
      <nav class="tables-nav" aria-label="Main navigation">
        <div class="tables-nav-brand">
          <div class="tables-nav-logo">${Kravon.esc(C.brand.name)}</div>
          <div class="tables-nav-sub">${Kravon.esc(C.brand.tagline)}</div>
        </div>
        <div class="tables-nav-right">
          <span class="tables-nav-badge">${Kravon.esc(label || 'Order Direct')}</span>
          <button class="tables-cart-btn" id="navCartBtn"
                  data-action="open-cart" aria-label="View cart">
            <svg width="20" height="20" aria-hidden="true"><use href="#icon-cart"/></svg>
            <span class="tables-cart-count" id="navCartCount">0</span>
          </button>
        </div>
      </nav>`;
  }

  /* ── Hero ─────────────────────────────────────────────────── */
  function buildHero() {
    if (!C.hero || !C.hero.headline) return '';

    const statsHtml = (C.hero.stats || []).map(s => `
      <div class="tables-hero-stat">
        <span class="tables-hero-stat-num${s.className ? ' ' + s.className : ''}">${Kravon.esc(s.num)}</span>
        <span class="tables-hero-stat-label">${Kravon.esc((s.label || '').replace('\n', ' '))}</span>
      </div>`).join('');

    const infoItems = [
      O.deliveryEta       ? `<div class="orders-info-item">⏱ <strong>${Kravon.esc(O.deliveryEta)}</strong></div>` : '',
      C.order?.minOrder   ? `<div class="orders-info-item">₹ Min order <strong>₹${C.order.minOrder}</strong></div>` : '',
      C.contact?.deliveryZone ? `<div class="orders-info-item">◎ <strong>${Kravon.esc(C.contact.deliveryZone)}</strong></div>` : '',
    ].filter(Boolean).join('');

    return `
      <section class="tables-hero" aria-labelledby="hero-heading">
        <div class="tables-hero-grid">
          <div class="tables-hero-copy">
            <span class="tables-eyebrow">${Kravon.esc(C.hero.label || C.brand.tagline || 'Order Direct')}</span>
            <h1 class="tables-hero-headline" id="hero-heading">${Kravon.esc(C.hero.headline)}</h1>
            <p class="tables-hero-sub">${Kravon.esc(C.hero.sub || '')}</p>
            ${infoItems ? `<div class="orders-info-strip">${infoItems}</div>` : ''}
            <div class="tables-hero-ctas">
              <a href="#menu" class="btn-primary">Browse Menu</a>
            </div>
            ${C.hero.footnote ? `<p class="tables-hero-footnote">${Kravon.esc(C.hero.footnote)}</p>` : ''}
          </div>
          ${statsHtml ? `<div class="tables-hero-stats" aria-label="Highlights">${statsHtml}</div>` : ''}
        </div>
      </section>`;
  }

  /* ── Item card ────────────────────────────────────────────── */
  let _ordersCtrl;

  function buildItemCard(item) {
    const isUrl = item.image && (item.image.startsWith('http') || item.image.startsWith('/'));

    return `
      <div class="menu-card" data-item-id="${item.id}" role="article"
           aria-label="${Kravon.esc(item.name)}">
        ${isUrl
          ? `<div class="menu-card-img" aria-hidden="true">
               <img src="${Kravon.esc(item.image)}" alt="" loading="lazy"
                    onerror="this.parentElement.style.display='none'">
               ${ItemControls.badgeHTML(item)}
             </div>`
          : `<div class="menu-card-img menu-card-img--no-image" aria-hidden="true">
               ${ItemControls.badgeHTML(item)}
             </div>`}
        <div class="menu-card-body">
          <div class="menu-card-name">${Kravon.esc(item.name)}</div>
          ${item.desc ? `<div class="menu-card-desc${!item.customise ? ' menu-card-desc--expandable' : ''}"
               ${!item.customise ? 'data-action="expand-card-desc" role="button" tabindex="0" title="Tap to read more"' : ''}
            >${Kravon.esc(item.desc)}</div>` : ''}
          <div class="menu-card-footer">
            <span class="menu-card-price">₹${Kravon.esc(String(item.price))}</span>
            <div id="itemctrl_${item.id}">${_ordersCtrl(item)}</div>
          </div>
        </div>
      </div>`;
  }

  /* ── Ordering screen ──────────────────────────────────────── */
  function buildScreenOrdering() {
    const cats = M.map((cat, i) =>
      `<button class="cat-btn${i === 0 ? ' active' : ''}"
               data-action="scroll-to-cat"
               data-cat-id="${Kravon.esc(cat.id)}">
         ${Kravon.esc(cat.name)}
         <span class="cat-btn-count">${cat.items.length}</span>
       </button>`
    ).join('');

    const sections = M.map(cat => {
      const items = cat.items.map(buildItemCard).join('');
      return `
        <section class="menu-section" id="cat_${Kravon.esc(cat.id)}"
                 aria-labelledby="cat_h_${Kravon.esc(cat.id)}">
          <h2 class="menu-section-title" id="cat_h_${Kravon.esc(cat.id)}">${Kravon.esc(cat.name)}</h2>
          ${cat.subtitle ? `<p class="menu-section-sub">${Kravon.esc(cat.subtitle)}</p>` : ''}
          <div class="menu-grid">${items}</div>
        </section>`;
    }).join('');

    return `
      <div id="screenOrdering" class="tables-screen" role="main">
        ${buildNav('Order Direct')}
        ${buildHero()}
        <div class="tables-layout">
          <aside class="cat-sidebar" aria-label="Menu categories">
            <div class="cat-sidebar-inner">${cats}</div>
          </aside>
          <main class="menu-main" id="menuMain" tabindex="-1">
            <div id="menu"></div>
            ${sections}
          </main>
        </div>
      </div>`;
  }

  /* ── Checkout screen ──────────────────────────────────────── */
  function buildScreenCheckout() {
    const cfg       = C.orders || {};
    const isOffline = !cfg.razorpayKeyId;

    const deliveryOpts = [
      { type: 'standard', name: O.deliveryStandardLabel || 'Standard Delivery', sub: O.deliveryStandardSub || '45–60 min', price: O.deliveryStandard || 0 },
      { type: 'express',  name: O.deliveryExpressLabel  || 'Express Delivery',  sub: O.deliveryExpressSub  || '20–30 min', price: O.deliveryExpress  || 0 },
    ].map((o, i) => `
      <div class="pay-opt${i === 0 ? ' selected' : ''}"
           data-action="select-delivery"
           data-delivery-type="${Kravon.esc(o.type)}"
           role="radio" aria-checked="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? 0 : -1}">
        <div class="radio-circle" aria-hidden="true"><div class="radio-fill"></div></div>
        <div class="pay-opt-icon" aria-hidden="true">
          ${o.type === 'express' ? '⚡' : '🛵'}
        </div>
        <div>
          <div class="pay-opt-name">${Kravon.esc(o.name)}</div>
          <div class="pay-opt-sub">${Kravon.esc(o.sub)}</div>
        </div>
        <span class="pay-opt-price">₹${o.price}</span>
      </div>`).join('');

    const paymentBlock = isOffline
      ? `<div class="pay-opt selected">
           <div class="pay-opt-icon" aria-hidden="true">💵</div>
           <div>
             <div class="pay-opt-name">Pay on Delivery</div>
             <div class="pay-opt-sub">Cash, UPI or card — pay when your order arrives</div>
           </div>
         </div>`
      : (O.paymentMethods || []).map((m, i) => `
        <div class="pay-opt${i === 0 ? ' selected' : ''}"
             data-action="select-payment"
             data-payment-id="${Kravon.esc(m.id)}"
             role="radio" aria-checked="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? 0 : -1}">
          <div class="radio-circle" aria-hidden="true"><div class="radio-fill"></div></div>
          <div class="pay-opt-icon">${Kravon.esc(m.icon || '')}</div>
          <div>
            <div class="pay-opt-name">${Kravon.esc(m.label)}</div>
            <div class="pay-opt-sub">${Kravon.esc(m.sub || '')}</div>
          </div>
        </div>`).join('');

    const gstPct = O.gstRate ? Math.round(O.gstRate * 100) : 0;

    return `
      <div id="screenCheckout" class="tables-screen tables-screen--checkout"
           style="display:none" role="main">
        ${buildNav('Checkout')}
        <div class="checkout-wrap">
          <div class="checkout-main">

            <section class="checkout-section" aria-labelledby="co-details-h">
              <h2 class="checkout-section-title" id="co-details-h">Delivery Details</h2>
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
                         autocomplete="tel" inputmode="numeric" required>
                  <span class="field-err" id="errPhone" aria-live="polite"></span>
                </div>
                <div class="field-group">
                  <label class="field-label" for="fieldAddress">Address</label>
                  <input type="text" id="fieldAddress" class="field-input"
                         placeholder="House / flat number, street name"
                         autocomplete="street-address" required>
                  <span class="field-err" id="errAddress" aria-live="polite"></span>
                </div>
                <div class="checkout-fields-2">
                  <div class="field-group">
                    <label class="field-label" for="fieldLocality">Locality</label>
                    <input type="text" id="fieldLocality" class="field-input"
                           placeholder="Area / locality"
                           autocomplete="address-level2" required>
                    <span class="field-err" id="errLocality" aria-live="polite"></span>
                  </div>
                  <div class="field-group">
                    <label class="field-label" for="fieldLandmark">
                      Landmark <span class="field-label-opt">(optional)</span>
                    </label>
                    <input type="text" id="fieldLandmark" class="field-input"
                           placeholder="Near landmark…" autocomplete="off">
                  </div>
                </div>
                <div class="field-group">
                  <label class="field-label" for="fieldNotes">
                    Special Instructions <span class="field-label-opt">(optional)</span>
                  </label>
                  <input type="text" id="fieldNotes" class="field-input"
                         placeholder="e.g. no onions, extra spice…"
                         maxlength="200" autocomplete="off">
                </div>
              </div>
            </section>

            <section class="checkout-section" aria-labelledby="co-delivery-h">
              <h2 class="checkout-section-title" id="co-delivery-h">Delivery Option</h2>
              <div class="checkout-pay-options" id="deliveryOptions" role="radiogroup" aria-label="Delivery type">
                ${deliveryOpts}
              </div>
            </section>

            <section class="checkout-section" aria-labelledby="co-pay-h">
              <h2 class="checkout-section-title" id="co-pay-h">Payment</h2>
              <div class="checkout-pay-options" id="paymentOptions" role="radiogroup" aria-label="Payment method">
                ${paymentBlock}
              </div>
            </section>

          </div>

          <aside class="checkout-summary" aria-label="Order summary">
            <h2 class="checkout-section-title">Order Summary</h2>
            <div class="summary-items" id="summaryItems"></div>
            <div class="summary-total-row">
              <span>Subtotal</span>
              <span id="summarySubtotal">₹0</span>
            </div>
            <div class="summary-total-row">
              <span>Delivery</span>
              <span id="summaryDelivery">₹0</span>
            </div>
            ${gstPct > 0 ? `
            <div class="summary-total-row">
              <span id="summaryGstLabel">GST (${gstPct}%)</span>
              <span id="summaryTax">₹0</span>
            </div>` : ''}
            <div class="summary-total-row summary-total-row--grand">
              <span>Total</span>
              <span id="summaryTotal" class="summary-total-val">₹0</span>
            </div>
            <button class="btn-primary place-order-btn" id="placeOrderBtn"
                    data-action="place-order">
              Place Order
            </button>
            <div class="place-order-note" id="placeOrderNote" aria-live="polite"></div>
            ${O.termsNote ? `<p class="terms-note">${Kravon.esc(O.termsNote)}</p>` : ''}
          </aside>
        </div>
      </div>`;
  }

  /* ── Confirmation screen ──────────────────────────────────── */
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
            <div class="confirm-sub" id="confirmSub">Your order is being prepared.</div>
            <div class="confirm-id" id="confirmOrderId"></div>
            <div class="confirm-meta" id="confirmMeta">
              <div class="confirm-meta-row">
                <span class="confirm-meta-key">Name</span>
                <span class="confirm-meta-val" id="confirmName">—</span>
              </div>
              <div class="confirm-meta-row">
                <span class="confirm-meta-key">Total</span>
                <span class="confirm-meta-val" id="confirmTotal">—</span>
              </div>
              <div class="confirm-meta-row">
                <span class="confirm-meta-key">Payment</span>
                <span class="confirm-meta-val" id="confirmPayment">—</span>
              </div>
              <div class="confirm-meta-row">
                <span class="confirm-meta-key">ETA</span>
                <span class="confirm-meta-val" id="confirmETA">${Kravon.esc(O.deliveryEta || '45–60 min')}</span>
              </div>
            </div>
            <div class="confirm-actions">
              <button class="confirm-wa-btn" data-action="track-order" aria-label="Track order on WhatsApp">
                <svg width="16" height="16" aria-hidden="true"><use href="#icon-wa"/></svg>
                Track on WhatsApp
              </button>
              <button class="new-order-btn" data-action="new-order" aria-label="Start new order">
                Order Again
              </button>
            </div>
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
              <p class="review-google-msg">We're so glad you enjoyed it! Please share on Google — it helps us a lot.</p>
              <a class="btn-primary review-google-btn" id="reviewGoogleLink"
                 href="#" target="_blank" rel="noopener noreferrer">
                Leave a Google Review ↗
              </a>
            </div>
            <div class="review-thanks" id="reviewThanks" style="display:none" aria-live="polite">
              Thank you for the feedback 🙏
            </div>
          </div>

        </div>
      </div>`;
  }

  /* ── Cart drawer ──────────────────────────────────────────── */
  function buildCartDrawer() {
    const cfg    = C.orders || {};
    const gstPct = cfg.gstRate ? Math.round(cfg.gstRate * 100) : 0;

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
            <span>Subtotal</span>
            <span id="cartSubtotal">₹0</span>
          </div>
          <div class="cart-total-row">
            <span>Delivery</span>
            <span id="cartDelivery">₹0</span>
          </div>
          ${gstPct > 0 ? `
          <div class="cart-total-row">
            <span>GST (${gstPct}%)</span>
            <span id="cartTax">₹0</span>
          </div>` : ''}
          <div class="cart-total-row cart-total-row--grand">
            <span>Total</span>
            <span id="cartTotalVal" class="cart-total-val">₹0</span>
          </div>
          <div class="free-delivery-bar" id="freeDeliveryBar" style="display:none">
            <div class="free-delivery-bar-fill" id="freeDeliveryBarFill"></div>
          </div>
          <div class="free-delivery-note" id="freeDeliveryNote"></div>
          <div class="cart-min-note" id="cartMinNote"></div>
          <button class="btn-primary" style="width:100%;justify-content:center" data-action="go-checkout">
            Proceed to Checkout →
          </button>
        </div>
      </div>`;
  }

  /* ── Customisation modal ──────────────────────────────────── */
  function buildCustomModal() {
    return `
      <div class="modal-overlay" id="ordersCustomModal"
           role="dialog" aria-modal="true"
           aria-labelledby="ordersModalItemName" aria-hidden="true">
        <div class="modal">
          <div class="modal-header">
            <div>
              <div class="modal-title" id="ordersModalItemName"></div>
              <div class="modal-item-desc" id="ordersModalItemDesc" style="display:none"></div>
              <div class="modal-price" id="ordersModalItemPrice"></div>
            </div>
            <button class="modal-close" data-action="orders-close-modal"
                    aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <div class="modal-section" id="ordersModalVariantsSection" style="display:none">
              <span class="modal-section-label">Options</span>
              <div id="ordersModalVariants"></div>
            </div>
            <div class="modal-section" id="ordersModalCustomizationsSection" style="display:none">
              <span class="modal-section-label">Customizations</span>
              <div id="ordersModalCustomizations"></div>
            </div>
            <div class="modal-section">
              <span class="modal-section-label">Add-ons</span>
              <div id="ordersModalAddons"></div>
            </div>
            <div class="modal-section">
              <span class="modal-section-label">Spice Level</span>
              <div class="spice-options" id="ordersSpiceOptions"></div>
            </div>
            <div class="modal-section">
              <span class="modal-section-label">Special Instructions</span>
              <input type="text" id="ordersSpecialInput" class="form-input"
                     placeholder="e.g. no pickles, extra sauce…"
                     maxlength="120" autocomplete="off">
              <div class="special-input-meta">
                <span id="ordersSpecialCharCount" class="char-count">120</span>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <div class="modal-qty" role="group" aria-label="Quantity">
              <button class="modal-qty-btn" data-action="orders-modal-qty-dec"
                      aria-label="Decrease">−</button>
              <span class="modal-qty-num" id="ordersModalQty" aria-live="polite">1</span>
              <button class="modal-qty-btn" data-action="orders-modal-qty-inc"
                      aria-label="Increase">+</button>
            </div>
            <button class="btn-primary modal-add-btn" id="ordersModalAddBtn"
                    data-action="orders-modal-confirm">
              Add to Order
            </button>
          </div>
        </div>
      </div>`;
  }

  /* ── Main init ────────────────────────────────────────────── */
  function initOrdersRenderer() {
    C = window.CONFIG;
    O = C.orders || {};
    M = window.MENU || window.CATEGORIES || [];

    _ordersCtrl = ItemControls.makeRenderer({
      getQty:       id => OrdersCart.getQtyById(id),
      isCustomKey:  'customise',
      idAttr:       'item-id',
      addBtnCls:    'add-btn',
      ctrlCls:      'item-qty-ctrl',
      decCls:       'qty-btn',
      incCls:       'qty-btn',
      countCls:     'qty-num',
      countTag:     'span',
      addAction:    'add-item',
      customAction: 'open-modal',
      decAction:    'dec-item',
      incAction:    'inc-item',
      addLabel:     '+ Add',
      keepCustom:   true,
      customBtnCls: 'add-btn add-btn--customise',
      customLabel:  'Customise',
      bothWrapCls:  'item-ctrl-both',
    });

    ItemControls.applyAccent(C.brand?.accent, 0.07, 0.2);

    document.title = `${C.brand.name} — Order Direct`;
    const descEl = $('pageDesc');
    if (descEl) descEl.content = `${C.brand.name} — ${C.brand.tagline}`;

    const app = $('app');
    app.innerHTML = [
      buildScreenOrdering(),
      buildScreenCheckout(),
      buildScreenConfirm(),
      buildCartDrawer(),
      buildCustomModal(),
    ].join('');

    showScreen('screenOrdering', false);
    history.replaceState({ screen: 'screenOrdering' }, '', window.location.href);

    Kravon.renderFooter(C.brand, C.contact, C.footer);
    Kravon.renderDemoBanner(C.demo);
    Kravon.scrollReveal();
  }

  /* ── Screen management ────────────────────────────────────── */
  function showScreen(id, pushState) {
    const screens = ['screenOrdering', 'screenCheckout', 'screenConfirm'];
    screens.forEach(s => {
      const el = document.getElementById(s);
      if (el) el.style.display = s === id ? '' : 'none';
    });

    const mobileBar = $('mobileCartBar');
    if (mobileBar) mobileBar.style.display = id === 'screenOrdering' ? '' : 'none';

    const cartDrawer  = $('cartDrawer');
    const cartOverlay = $('cartOverlay');
    if (cartDrawer)  { cartDrawer.style.display = 'none'; cartDrawer.setAttribute('aria-hidden', 'true'); }
    if (cartOverlay) { cartOverlay.style.display = 'none'; cartOverlay.setAttribute('aria-hidden', 'true'); }
    document.body.style.overflow = '';

    if (pushState !== false) {
      history.pushState({ screen: id }, '', window.location.href);
    }
  }

  /* ── Item button state update ─────────────────────────────── */
  function updateItemBtn(id) {
    const el   = document.getElementById(`itemctrl_${id}`);
    const item = _findMenuItem(id);
    if (el && item) el.innerHTML = _ordersCtrl(item);
  }

  /* ── Cart drawer render ───────────────────────────────────── */
  function renderCartDrawer() {
    const items    = OrdersCart.getItems();
    const totals   = OrdersCart.getTotals();
    const listEl   = $('cartItemsList');
    const footerEl = $('cartFooter');
    const mobileCount = $('mobileCartCount');
    const mobileTotal = $('mobileCartTotal');
    const navCount    = $('navCartCount');

    if (!listEl) return;

    if (items.length === 0) {
      listEl.innerHTML = `<div class="cart-empty">Your cart is empty</div>`;
      if (footerEl) footerEl.style.display = 'none';
    } else {
      listEl.innerHTML = items.map((item, idx) => {
        const isCustomisable = (window.MENU || []).some(cat =>
          cat.items.some(i => String(i.id) === String(item.id) && (i.customise || i.is_customizable))
        );
        const hasDupe = items.filter(i => i.id === item.id).length > 1;
        const displayName = hasDupe && item.note ? `${item.name} · ${item.note}` : item.name;
        return `
        <div class="cart-item" aria-label="${Kravon.esc(displayName)}, ₹${item.price * item.qty}">
          <div class="cart-item-info">
            <span class="cart-item-name">${Kravon.esc(displayName)}</span>
            ${item.note && !hasDupe ? `<span class="cart-item-note">${Kravon.esc(item.note)}</span>` : ''}
          </div>
          <div class="cart-item-right">
            <div class="cart-item-qty" role="group"
                 aria-label="Quantity for ${Kravon.esc(item.name)}">
              <button class="qty-btn" data-action="cart-dec"
                      data-idx="${idx}" aria-label="Remove one">−</button>
              <span aria-live="polite">${item.qty}</span>
              <button class="qty-btn" data-action="cart-inc"
                      data-idx="${idx}" aria-label="Add one">+</button>
            </div>
            <span class="cart-item-price">₹${item.price * item.qty}</span>
            ${isCustomisable ? `<button class="edit-btn" data-action="edit-cart-item" data-idx="${idx}" aria-label="Edit ${Kravon.esc(item.name)}">Edit</button>` : ''}
          </div>
        </div>`;
      }).join('');

      if (footerEl) {
        footerEl.style.display = '';
        const subEl   = $('cartSubtotal');
        const delEl   = $('cartDelivery');
        const taxEl   = $('cartTax');
        const totalEl = $('cartTotalVal');
        const minEl   = $('cartMinNote');
        const freeBar = $('freeDeliveryBar');
        const freeFill = $('freeDeliveryBarFill');
        const freeNote = $('freeDeliveryNote');

        if (subEl)   subEl.textContent   = `₹${totals.sub}`;
        if (delEl)   delEl.textContent   = totals.freeDelivery ? 'Free' : `₹${totals.del}`;
        if (taxEl)   taxEl.textContent   = `₹${totals.tax}`;
        if (totalEl) totalEl.textContent = `₹${totals.total}`;

        if (minEl) {
          minEl.textContent = totals.belowMin
            ? `Min order ₹${totals.minOrder}. Add ₹${totals.minOrder - totals.sub} more.`
            : '';
        }

        const cfg = OrdersCart.getConfig();
        if (cfg.freeDelivery && freeBar && freeFill && freeNote) {
          if (!totals.freeDelivery) {
            const pct = Math.min(100, Math.round((totals.sub / cfg.freeDelivery) * 100));
            const needed = cfg.freeDelivery - totals.sub;
            freeBar.style.display   = '';
            freeFill.style.width    = pct + '%';
            freeNote.textContent    = `Add ₹${needed} more for free delivery`;
          } else {
            freeBar.style.display   = 'none';
            freeNote.textContent    = '🎉 Free delivery applied!';
          }
        }
      }
    }

    const count = totals.count;
    if (navCount)    navCount.textContent    = count;
    if (mobileCount) mobileCount.textContent = count;
    if (mobileTotal) mobileTotal.textContent = `₹${totals.total}`;

    const mobileBar = $('mobileCartBar');
    if (mobileBar) mobileBar.style.display = count > 0 ? '' : 'none';
  }

  /* ── Summary in checkout screen ───────────────────────────── */
  function renderCheckoutSummary() {
    const items   = OrdersCart.getItems();
    const totals  = OrdersCart.getTotals();
    const listEl  = $('summaryItems');

    if (listEl) {
      listEl.innerHTML = items.map(i => `
        <div class="summary-item">
          <span>${i.qty}× ${Kravon.esc(i.name)}${i.note ? ` <span class="summary-item-note">${Kravon.esc(i.note)}</span>` : ''}</span>
          <span>₹${i.price * i.qty}</span>
        </div>`
      ).join('');
    }

    const subEl   = $('summarySubtotal');
    const delEl   = $('summaryDelivery');
    const taxEl   = $('summaryTax');
    const totalEl = $('summaryTotal');
    if (subEl)   subEl.textContent   = `₹${totals.sub}`;
    if (delEl)   delEl.textContent   = totals.freeDelivery ? 'Free' : `₹${totals.del}`;
    if (taxEl)   taxEl.textContent   = `₹${totals.tax}`;
    if (totalEl) totalEl.textContent = `₹${totals.total}`;
  }

  /* ── Private: find menu item by id ───────────────────────── */
  function _findMenuItem(id) {
    for (const cat of (window.MENU || [])) {
      const item = cat.items.find(i => String(i.id) === String(id));
      if (item) return item;
    }
    return null;
  }

  window.initOrdersRenderer = initOrdersRenderer;
  window.OrdersRenderer = {
    showScreen,
    updateItemBtn,
    renderCartDrawer,
    renderCheckoutSummary,
  };

})();
