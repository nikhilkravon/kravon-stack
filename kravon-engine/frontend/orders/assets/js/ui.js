/* ═══════════════════════════════════════════════════════════
   ORDERS — UI.JS
   Cart panel render, screen transitions, mobile cart,
   toast, scroll-to-section, cart flash.
   renderer.js owns all initial DOM construction.
   This module owns all runtime DOM mutations.
   ═══════════════════════════════════════════════════════════ */

const UI = (function () {
  'use strict';

  let _mobileCartOpen = false;
  let _toastTimer     = null;

  const _customisableIds = new Set(
    window.MENU.flatMap(c => c.items.filter(i => i.customise).map(i => String(i.id)))
  );

  /* ── Helpers ──────────────────────────────────────────── */
  function _$(id) { return document.getElementById(id); }
  function _setText(id, text) { const el = _$(id); if (el) el.textContent = text; }

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── Render cart panel ────────────────────────────────── */
  function renderCart() {
    const items  = Cart.getItems();
    const totals = Cart.getTotals();
    const cfg    = Cart.getConfig();

    /* Nav badge */
    const ccEl = _$('cartCount');
    if (ccEl) {
      ccEl.textContent = totals.count;
      ccEl.classList.toggle('visible', totals.count > 0);
    }

    _setText('cartItemCount', totals.count + ' item' + (totals.count === 1 ? '' : 's'));

    /* Empty state */
    const emptyEl = _$('cartEmpty');
    if (emptyEl) emptyEl.style.display = items.length ? 'none' : 'flex';

    /* Item rows */
    const cartItemsEl = _$('cartItems');
    if (cartItemsEl) {
      cartItemsEl.innerHTML = items.map((item, idx) => {
        const editBtn = _customisableIds.has(item.id)
          ? `<button class="edit-btn" data-action="edit-item"
                     data-idx="${idx}" aria-label="Edit ${esc(item.name)}">Edit</button>` : '';
        const noteHtml = item.note
          ? `<div class="cart-item-note">${esc(item.note)}</div>` : '';
        return `
          <div class="cart-item" role="listitem">
            <div class="cart-item-top">
              <div class="cart-item-name">${esc(item.name)}</div>
              <div class="cart-item-price">${Cart.fmt(item.price * item.qty)}</div>
            </div>
            <div class="cart-item-controls">
              <button class="qty-btn" data-action="change-qty"
                      data-idx="${idx}" data-delta="-1" aria-label="Decrease">−</button>
              <div class="qty-display" aria-live="polite">${item.qty}</div>
              <button class="qty-btn" data-action="change-qty"
                      data-idx="${idx}" data-delta="1" aria-label="Increase">+</button>
              <button class="remove-btn" data-action="remove-item"
                      data-idx="${idx}" aria-label="Remove ${esc(item.name)}">Remove</button>
              ${editBtn}
            </div>
            ${noteHtml}
          </div>`;
      }).join('');
    }

    /* Delivery form + footer visibility */
    const formEl   = _$('cartDeliveryForm');
    const footerEl = _$('cartFooter');
    if (formEl)   formEl.style.display   = items.length ? 'block' : 'none';
    if (footerEl) footerEl.style.display = items.length ? 'block' : 'none';

    if (items.length) {
      _setText('cartSubtotal', Cart.fmt(totals.sub));
      _setText('cartDelivery', totals.freeDelivery ? 'Free' : Cart.fmt(totals.del));
      _setText('cartTax',      Cart.fmt(totals.tax));
      _setText('cartTotal',    Cart.fmt(totals.total));

      const noteEl = _$('minOrderNote');
      if (noteEl) {
        if (totals.belowMin) {
          noteEl.textContent = `Add ₹${totals.toMin} more to place your order`;
          noteEl.classList.add('warn');
        } else if (totals.toFreeDelivery > 0) {
          noteEl.textContent = `Add ₹${totals.toFreeDelivery} more for free delivery`;
          noteEl.classList.remove('warn');
        } else {
          noteEl.textContent = 'Free delivery applied ✓';
          noteEl.classList.remove('warn');
        }
      }

      const checkoutBtn = _$('checkoutBtn');
      if (checkoutBtn) {
        checkoutBtn.disabled = totals.belowMin;
        checkoutBtn.setAttribute('aria-disabled', String(totals.belowMin));
      }
    }

    _updateMobileCartBar(totals.count, totals.total);
  }

  /* ── Mobile cart bar ──────────────────────────────────── */
  function _updateMobileCartBar(count, total) {
    const bar      = _$('mobileCartBar');
    const isMobile = window.innerWidth <= 800;
    const onOrder  = _$('screenOrdering')?.classList.contains('active');

    if (isMobile && count > 0 && onOrder) {
      bar.style.display = 'flex';
      _setText('mobileCartCount', count);
      _setText('mobileCartTotal', Cart.fmt(total));
      document.body.style.paddingBottom = '64px';
    } else {
      bar.style.display = 'none';
      const onCheckout = _$('screenCheckout')?.classList.contains('active');
      if (!onCheckout) document.body.style.paddingBottom = '';
    }
  }

  /* ── Mobile cart open/close ───────────────────────────── */
  function openMobileCart() {
    _mobileCartOpen = true;
    _$('cartPanel')?.classList.add('open');
    _$('cartOverlay')?.classList.add('open');
    _$('cartOverlay')?.removeAttribute('aria-hidden');
    const closeBtn = _$('cartCloseBtn');
    if (closeBtn) closeBtn.style.display = 'block';
    _$('mobileCartBar').style.display = 'none';
    document.body.style.overflow = 'hidden';
    document.querySelector('.cart-header')?.setAttribute('aria-expanded', 'true');
  }

  function closeMobileCart() {
    _mobileCartOpen = false;
    _$('cartPanel')?.classList.remove('open');
    _$('cartOverlay')?.classList.remove('open');
    _$('cartOverlay')?.setAttribute('aria-hidden', 'true');
    const closeBtn = _$('cartCloseBtn');
    if (closeBtn) closeBtn.style.display = 'none';
    document.body.style.overflow = '';
    document.querySelector('.cart-header')?.setAttribute('aria-expanded', 'false');
    const totals = Cart.getTotals();
    _updateMobileCartBar(totals.count, totals.total);
  }

  function toggleMobileCart() {
    if (window.innerWidth > 800) return;
    _mobileCartOpen ? closeMobileCart() : openMobileCart();
  }

  function handleNavCart() {
    if (window.innerWidth <= 800) {
      openMobileCart();
    } else {
      _$('cartPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ── Cart panel flash ─────────────────────────────────── */
  function flashCartPanel() {
    const p = _$('cartPanel');
    if (!p) return;
    p.style.transition = 'box-shadow 0.3s';
    p.style.boxShadow  = '0 0 0 1px var(--accent)';
    setTimeout(() => { p.style.boxShadow = ''; }, 600);
  }

  /* ── Screen transitions ───────────────────────────────── */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
    window.scrollTo(0, 0);
    closeMobileCart();

    const isOrdering = id === 'screenOrdering';
    const isConfirm  = id === 'screenConfirm';

    const upgradeEl = _$('upgradeSection');
    if (upgradeEl) upgradeEl.style.display = isOrdering ? '' : 'none';
    if (!isOrdering) document.body.style.paddingBottom = '';

    const navCartBtn = _$('navCartBtn');
    const navHomeBtn = _$('navHomeBtn');
    if (navCartBtn) navCartBtn.style.display = isConfirm ? 'none' : '';
    if (navHomeBtn) navHomeBtn.style.display  = isConfirm ? ''     : 'none';

    const totals = Cart.getTotals();
    _updateMobileCartBar(totals.count, totals.total);
  }

  /* ── Sidebar scroll ───────────────────────────────────── */
  function scrollToSection(sectionId, btn) {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const el = document.getElementById(sectionId);
    if (!el) return;
    const navH = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--nav-height'), 10
    ) || 60;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - navH - 12, behavior: 'smooth' });
  }

  /* ── Toast ────────────────────────────────────────────── */
  function showToast(msg, duration) {
    Kravon.toast(msg, duration);
  }

  /* ── Resize ───────────────────────────────────────────── */
  function onResize() {
    const totals = Cart.getTotals();
    _updateMobileCartBar(totals.count, totals.total);
    if (window.innerWidth > 800) closeMobileCart();
  }

  return {
    renderCart,
    flashCartPanel,
    showScreen,
    scrollToSection,
    showToast,
    openMobileCart,
    closeMobileCart,
    toggleMobileCart,
    handleNavCart,
    onResize,
  };

})();
