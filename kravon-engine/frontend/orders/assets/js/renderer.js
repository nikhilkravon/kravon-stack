/* ═══════════════════════════════════════════════════════════
   ORDERS — RENDERER.JS
   Builds the entire 3-screen SPA from CONFIG + MENU.
   No content in index.html. Edit config/config.js only.

   Screens:
     screenOrdering  — nav + hero + sidebar + menu grid + direct strip
     screenCheckout  — delivery + payment + summary
     screenConfirm   — confirmation + order ID

   Exposes: window.OrdersRenderer.updateItemBtn(id)
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const C  = window.CONFIG;
  const O  = C.orders;  // orders-specific block
  const M  = window.MENU;
  const $  = id => document.getElementById(id);

  /* ── Escape helper — used for all user-supplied config strings ── */
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── Accent token injection (Orders supports per-client accent colour) ── */
  function applyAccent() {
    const hex = (C.brand?.accent || '#c2d62a').replace('#', '');
    const ri  = parseInt(hex.slice(0, 2), 16);
    const gi  = parseInt(hex.slice(2, 4), 16);
    const bi  = parseInt(hex.slice(4, 6), 16);
    const r   = document.documentElement;
    r.style.setProperty('--accent',        `#${hex}`);
    r.style.setProperty('--accent-subtle', `rgba(${ri},${gi},${bi},0.06)`);
    r.style.setProperty('--accent-border', `rgba(${ri},${gi},${bi},0.15)`);
  }

  /* ── Nav ─────────────────────────────────────────────── */
  function buildNav() {
    return `
      <nav class="nav" aria-label="Main navigation">
        <div class="nav-brand">
          <div>
            <div class="nav-logo">${esc(C.brand.name)}</div>
            <div class="nav-logo-sub">${esc(C.brand.tagline)}</div>
          </div>
          <div class="nav-sep" aria-hidden="true"></div>
          <span class="nav-badge">${esc(O.navDirectLabel)}</span>
        </div>
        <div class="nav-actions">
          <button class="nav-cart-btn" id="navCartBtn"
                  data-action="nav-cart" aria-label="View cart">
            <svg width="18" height="18" aria-hidden="true"><use href="#icon-cart"/></svg>
            <span class="cart-count-badge" id="cartCount" aria-live="polite">0</span>
          </button>
          <button class="btn-ghost" id="navHomeBtn"
                  data-action="new-order" style="display:none"
                  aria-label="Start new order">← New Order</button>
        </div>
      </nav>`;
  }

  /* ── Hero ────────────────────────────────────────────── */
  function buildHero() {
    if ((C.hero.stats || []).length > 3) {
      console.warn('Kravon Orders: C.hero.stats has more than 3 entries. Only the first 3 are rendered.');
    }
    const stats = (C.hero.stats || []).slice(0, 3).map((s, i, arr) => {
      const color = s.color ? ` style="color:${esc(s.color)}"` : '';
      const sep   = i < arr.length - 1
        ? '<div class="hero-stat-sep" aria-hidden="true"></div>' : '';
      return `
        <div class="hero-stat">
          <span class="h-stat-num"${color}>${esc(s.num)}</span>
          <span class="h-stat-label">${esc(s.label).replace(/\n/g, '<br>')}</span>
        </div>${sep}`;
    }).join('');

    return `
      <div class="orders-hero" aria-labelledby="hero-heading">
        <div class="orders-hero-inner">
          <div>
            <span class="hero-eyebrow">${esc(C.hero.eyebrow)}</span>
            <h1 class="orders-headline" id="hero-heading">${C.hero.headline}</h1>
            <p class="orders-sub">${esc(C.hero.sub)}</p>
          </div>
          <div class="hero-stats" id="heroStats" aria-label="Key facts">${stats}</div>
        </div>
      </div>`;
  }

  /* ── Sidebar ─────────────────────────────────────────── */
  function buildSidebar() {
    const cats = M.map((cat, i) => `
      <button class="cat-btn${i === 0 ? ' active' : ''}"
              data-action="scroll-to-section"
              data-section-id="${esc(cat.id)}"
              aria-label="Jump to ${esc(cat.name)}">
        ${esc(cat.name)}
        <span class="cat-btn-count">${cat.items.length}</span>
      </button>`).join('');

    const infoRows = `
      <div class="sidebar-info">
        <div class="info-row">
          <span class="info-icon" aria-hidden="true">⏱</span>
          <span class="info-text" id="infoEta">${esc(O.deliveryEta)}</span>
        </div>
        <div class="info-row">
          <span class="info-icon" aria-hidden="true">₹</span>
          <span class="info-text">Min. order ₹${C.order.minOrder}</span>
        </div>
        <div class="info-row">
          <span class="info-icon" aria-hidden="true">◎</span>
          <span class="info-text">${esc(C.contact.deliveryZone)}</span>
        </div>
      </div>`;

    return `
      <aside class="sidebar" aria-label="Menu categories">
        <div class="sidebar-cats" id="sidebarCats">${cats}</div>
        ${infoRows}
      </aside>`;
  }

  /* ── Item card ───────────────────────────────────────── */
  function itemCardHTML(item) {
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

    const isFile = item.image && !(/\p{Emoji}/u).test(item.image) && item.image.length > 2;
    const imgHTML = isFile
      ? `<div class="item-img" style="padding:0;overflow:hidden;">
           <img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy"
                style="width:100%;height:100%;object-fit:cover;display:block;">${badge}
         </div>`
      : `<div class="item-img" style="background:${esc(item.imageBg || '#1e1a12')};">
           ${item.image || ''}${badge}
         </div>`;

    const action = item.customise ? 'open-modal' : 'add-item';

    return `
      <div class="item-card" id="card-${esc(item.id)}">
        ${imgHTML}
        <div class="item-name">${esc(item.name)}</div>
        <div class="item-desc">${esc(item.desc)}</div>
        <div class="item-footer">
          <div class="item-price">₹${item.price}</div>
          <div id="itembtn-${esc(item.id)}">${itemBtnHTML(item)}</div>
        </div>
      </div>`;
  }

  function itemBtnHTML(item) {
    const qty    = Cart.getQtyById(item.id);
    const action = item.customise ? 'open-modal' : 'add-item';
    if (qty === 0) {
      return `
        <button class="add-btn"
                data-action="${action}"
                data-item-id="${esc(String(item.id))}"
                aria-label="Add ${esc(item.name)} to order">
          <svg width="14" height="14" aria-hidden="true"><use href="#icon-plus"/></svg>
          Add
        </button>`;
    }
    return `
      <div class="item-qty-ctrl" role="group" aria-label="${esc(item.name)} quantity">
        <button class="iqc-btn iqc-dec"
                data-action="item-dec"
                data-item-id="${esc(String(item.id))}"
                aria-label="Remove one ${esc(item.name)}">−</button>
        <span class="iqc-count" aria-live="polite">${qty}</span>
        <button class="iqc-btn iqc-inc"
                data-action="${action}"
                data-item-id="${esc(String(item.id))}"
                aria-label="Add another ${esc(item.name)}">+</button>
      </div>`;
  }

  /* ── Public: re-render a single item's button in place ── */
  function updateItemBtn(id) {
    const el = document.getElementById('itembtn-' + id);
    if (!el) return;
    const item = (() => {
      for (const cat of window.MENU) {
        const found = cat.items.find(i => String(i.id) === String(id));
        if (found) return found;
      }
      return null;
    })();
    if (!item) return;
    el.innerHTML = itemBtnHTML(item);
  }

  /* ── Menu grid ───────────────────────────────────────── */
  function buildMenu() {
    return M.map(cat => `
      <div class="menu-cat-section" id="${esc(cat.id)}">
        <div class="menu-cat-heading">
          ${esc(cat.name)}
          <span class="menu-cat-count-label">
            ${cat.items.length} item${cat.items.length !== 1 ? 's' : ''}${cat.subtitle ? ' · ' + esc(cat.subtitle) : ''}
          </span>
        </div>
        <div class="menu-grid">
          ${cat.items.map(itemCardHTML).join('')}
        </div>
      </div>`).join('');
  }

  /* ── Direct advantage strip ──────────────────────────── */
  function buildDirectStrip() {
    const items = O.directAdvantages.map(a => `
      <div class="direct-item">
        <span class="direct-item-icon" aria-hidden="true">${esc(a.icon)}</span>
        <div class="direct-item-title">${esc(a.title)}</div>
        <div class="direct-item-body">${esc(a.body)}</div>
      </div>`).join('');

    return `
      <section class="direct-sec" id="directSection" aria-label="Why order direct">
        <div class="wrap">
          <div class="direct-inner">${items}</div>
        </div>
      </section>`;
  }

  /* ── Cart panel ──────────────────────────────────────── */
  function buildCartPanel() {
    return `
      <aside class="cart-panel" id="cartPanel" aria-label="Your order">
        <div class="cart-header" data-action="toggle-mobile-cart"
             aria-expanded="false" aria-controls="cartBody">
          <span class="cart-header-title">Your Order</span>
          <span class="cart-item-count" id="cartItemCount" aria-live="polite">0 items</span>
          <button class="cart-close-btn" id="cartCloseBtn"
                  data-action="close-mobile-cart"
                  style="display:none" aria-label="Close cart">✕</button>
        </div>
        <div class="cart-body" id="cartBody">
          <div class="cart-empty" id="cartEmpty" aria-label="Cart empty">
            <div class="cart-empty-icon" aria-hidden="true">🛒</div>
            <div class="cart-empty-text" id="cartEmptyText">${esc(O.cartEmptyText)}</div>
          </div>
          <div id="cartItems" role="list" aria-label="Cart items" aria-live="polite"></div>

          <!-- Delivery form -->
          <div class="cart-delivery-form" id="cartDeliveryForm" style="display:none"
               aria-label="Delivery details">
            <div class="form-section-label">Delivery Details</div>
            <div class="form-row">
              <label class="form-label" for="fieldName">Name</label>
              <input class="form-input" id="fieldName" type="text"
                     placeholder="${esc(O.form.namePlaceholder)}"
                     autocomplete="name" required>
            </div>
            <div class="form-row">
              <label class="form-label" for="fieldPhone">Phone</label>
              <input class="form-input" id="fieldPhone" type="tel"
                     placeholder="${esc(O.form.phonePlaceholder)}"
                     autocomplete="tel" inputmode="numeric" required>
            </div>
            <div class="form-row">
              <label class="form-label" for="fieldAddress">Address</label>
              <input class="form-input" id="fieldAddress" type="text"
                     placeholder="${esc(O.form.addressPlaceholder)}"
                     autocomplete="street-address" required>
            </div>
            <div class="form-grid-2">
              <div class="form-row">
                <label class="form-label" for="fieldLocality">Locality</label>
                <input class="form-input" id="fieldLocality" type="text"
                       placeholder="${esc(O.form.localityPlaceholder)}"
                       autocomplete="address-level2" required>
              </div>
              <div class="form-row">
                <label class="form-label" for="fieldLandmark">Landmark <small>(optional)</small></label>
                <input class="form-input" id="fieldLandmark" type="text"
                       placeholder="${esc(O.form.landmarkPlaceholder)}"
                       autocomplete="off">
              </div>
            </div>
          </div>

          <!-- Cart footer -->
          <div class="cart-footer" id="cartFooter" style="display:none">
            <div class="cart-totals">
              <div class="cart-totals-row">
                <span>Subtotal</span>
                <span id="cartSubtotal">₹0</span>
              </div>
              <div class="cart-totals-row">
                <span>Delivery</span>
                <span id="cartDelivery">₹49</span>
              </div>
              <div class="cart-totals-row">
                <span id="cartGstLabel">GST (5%)</span>
                <span id="cartTax">₹0</span>
              </div>
              <div class="cart-totals-row cart-total-line">
                <span>Total</span>
                <span id="cartTotal">₹0</span>
              </div>
            </div>
            <p class="min-order-note" id="minOrderNote"></p>
            <button class="btn-primary checkout-btn" id="checkoutBtn"
                    data-action="go-to-checkout" aria-label="Proceed to checkout">
              Proceed to Checkout →
            </button>
            <p class="terms-note" id="termsNote">${esc(O.termsNote)}</p>
          </div>
        </div>
      </aside>`;
  }

  /* ── Ordering screen ─────────────────────────────────── */
  function buildScreenOrdering() {
    return `
      <div class="screen active" id="screenOrdering">
        ${buildHero()}
        <div class="ordering-layout wrap">
          <div class="ordering-main">
            ${buildSidebar()}
            <main class="menu-main" aria-label="Menu">
              <div id="menuMount">${buildMenu()}</div>
              ${buildDirectStrip()}
            </main>
          </div>
          ${buildCartPanel()}
        </div>
      </div>`;
  }

  /* ── Checkout screen ─────────────────────────────────── */
  function buildScreenCheckout() {
    const gstPct = Math.round(O.gstRate * 100);

    const deliveryOpts = [
      { type: 'standard', name: O.deliveryStandardLabel, sub: O.deliveryStandardSub, price: O.deliveryStandard },
      { type: 'express',  name: O.deliveryExpressLabel,  sub: O.deliveryExpressSub,  price: O.deliveryExpress  },
    ].map((o, i) => `
      <div class="delivery-opt${i === 0 ? ' selected' : ''}"
           data-action="select-delivery"
           data-delivery-type="${esc(o.type)}"
           role="radio" aria-checked="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? 0 : -1}">
        <div class="delivery-opt-left">
          <div class="radio-circle" aria-hidden="true"><div class="radio-fill"></div></div>
          <div>
            <div class="delivery-opt-name">${esc(o.name)}</div>
            <div class="delivery-opt-sub">${esc(o.sub)}</div>
          </div>
        </div>
        <span class="delivery-opt-price">₹${o.price}</span>
      </div>`).join('');

    const payOpts = O.paymentMethods.map((m, i) => `
      <div class="pay-opt${i === 0 ? ' selected' : ''}"
           data-action="select-payment"
           role="radio" aria-checked="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? 0 : -1}">
        <div class="radio-circle" aria-hidden="true"><div class="radio-fill"></div></div>
        <div class="pay-opt-icon">${esc(m.icon)}</div>
        <div>
          <div class="pay-opt-name">${esc(m.label)}</div>
          <div class="pay-opt-sub">${esc(m.sub)}</div>
        </div>
      </div>`).join('');

    return `
      <div class="screen" id="screenCheckout">
        <div class="checkout-layout wrap">
          <div class="checkout-main">
            <button class="back-btn" data-action="go-back" aria-label="Back to menu">← Back</button>
            <h2 class="checkout-heading">Checkout</h2>

            <div class="checkout-section" aria-labelledby="delivery-heading">
              <div class="checkout-section-title" id="delivery-heading">Delivery Option</div>
              <div id="deliveryOptions" role="radiogroup" aria-label="Delivery type">
                ${deliveryOpts}
              </div>
            </div>

            <div class="checkout-section" aria-labelledby="payment-heading">
              <div class="checkout-section-title" id="payment-heading">Payment Method</div>
              <div id="paymentOptions" role="radiogroup" aria-label="Payment method">
                ${payOpts}
              </div>
              <div class="gateway-note" id="gatewayNote">
                <div class="razorpay-label">${esc(O.gatewayNote.label)}</div>
                <div class="razorpay-sub">${esc(O.gatewayNote.body)}</div>
              </div>
            </div>
          </div>

          <div class="checkout-summary" aria-label="Order summary">
            <div class="summary-header">Order Summary</div>
            <div id="summaryItems" role="list" aria-label="Summary items"></div>
            <div class="summary-totals">
              <div class="summary-row">
                <span>Subtotal</span><span id="summarySubtotal">₹0</span>
              </div>
              <div class="summary-row">
                <span>Delivery</span><span id="summaryDelivery">₹49</span>
              </div>
              <div class="summary-row">
                <span id="summaryGstLabel">GST (${gstPct}%)</span>
                <span id="summaryTax">₹0</span>
              </div>
              <div class="summary-row summary-total-line">
                <span>Total</span><span id="summaryTotal">₹0</span>
              </div>
            </div>
            <button class="btn-primary place-order-btn"
                    data-action="place-order" aria-label="Place order">
              Place Order →
            </button>
            <p class="terms-note">${esc(O.termsNote)}</p>
          </div>
        </div>
      </div>`;
  }

  /* ── Confirmation screen ─────────────────────────────── */
  function buildScreenConfirm() {
    const phone    = C.contact.waNumber;
    const displayPhone = '+' + phone.slice(0, 2) + ' ' + phone.slice(2, 7) + ' ' + phone.slice(7);

    return `
      <div class="screen" id="screenConfirm">
        <div class="confirm-layout wrap">
          <div class="confirm-card">
            <div class="confirm-check" aria-hidden="true">
              <svg width="32" height="32"><use href="#icon-check"/></svg>
            </div>
            <h2 class="confirm-headline" id="confirmHeadline">${O.confirmHeadline}</h2>
            <p class="confirm-sub" id="confirmSub">${esc(O.confirmSub)}</p>
            <div class="confirm-meta">
              <div class="confirm-meta-row">
                <span class="confirm-meta-key">Order ID</span>
                <span class="confirm-meta-val" id="confirmOrderId">—</span>
              </div>
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
                <span class="confirm-meta-val" id="confirmETA">—</span>
              </div>
              <div class="confirm-meta-row">
                <span class="confirm-meta-key">Kitchen</span>
                <span class="confirm-meta-val" id="confirmContactPhone">${esc(displayPhone)}</span>
              </div>
            </div>
            <p class="confirm-wa-note" id="confirmWaNote">${esc(O.confirmWaNote)}</p>
            <div class="confirm-actions">
              <button class="btn-primary" data-action="track-order" aria-label="Track order on WhatsApp">
                <svg width="16" height="16" aria-hidden="true"><use href="#icon-wa"/></svg>
                Track on WhatsApp
              </button>
              <button class="btn-ghost" data-action="new-order" aria-label="Start new order">
                New Order
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ── Mount ───────────────────────────────────────────── */
  function mount() {
    document.title = C.meta.title;
    $('pageDesc')?.setAttribute('content', C.hero.sub);

    applyAccent();

    const app = $('app');
    app.innerHTML =
      buildNav() +
      buildScreenOrdering() +
      buildScreenCheckout() +
      buildScreenConfirm();

    Kravon.renderDemoBanner({
      show:  C.demo.show,
      text:  C.demo.text,
      label: C.demo.label,
    });

    Kravon.renderUpgrade({
      show:        O.upgradeBridge?.show,
      label:       O.upgradeBridge?.label,
      headline:    `${O.upgradeBridge?.headline}<br><strong>${O.upgradeBridge?.headlineStrong}</strong>`,
      productLine: O.upgradeBridge?.productLine,
      ctaLabel:    O.upgradeBridge?.ctaText,
      ctaUrl:      O.upgradeBridge?.ctaHref,
    });

    Kravon.renderFooter(
      { name: C.brand.name, year: C.brand.year },
      { city: C.contact.city,  phone: '+' + C.contact.waNumber },
      {
        privacyNote:  O.footerDataNote,
        poweredBy:    O.poweredByText,
        poweredLabel: O.poweredByLabel,
        poweredUrl:   O.poweredByLink,
      }
    );

    Kravon.scrollReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /* ── Public: refresh a single item's Add button ───────── */
  window.OrdersRenderer = {
    itemBtnHTML,
    updateItemBtn,
    esc,
  };

})();
