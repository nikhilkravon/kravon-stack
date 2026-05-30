/* ═══════════════════════════════════════════════════════════
   SHARED — ITEM-CONTROLS.JS
   Shared item-card utilities used across Orders, Presence,
   and Tables.

   Exposes: window.ItemControls
     .badgeHTML(item)               badge span for a menu item
     .applyAccent(hex, sa, ba)      inject --accent CSS vars
     .makeRenderer(cfg)             factory → ctrlHTML(item)

   makeRenderer config:
     getQty(id)     function        qty from the product cart
     isCustomKey    string          item property ('customise'|'customisable')
     idAttr         string          data-attr name ('id'|'item-id')
     addBtnCls      string          CSS class for add button
     ctrlCls        string          CSS class for qty-ctrl wrapper
     decCls         string          CSS class for dec button
     incCls         string          CSS class for inc button
     countCls       string          CSS class for count element
     countTag       string          tag for count ('span'|'div', default 'span')
     addAction      string          data-action for add (non-customisable)
     customAction   string          data-action for add (customisable)
     decAction      string          data-action for dec
     incAction      string          data-action for inc (non-customisable)
     addLabel       string          innerHTML for add button

     keepCustom     bool            Tables: show Customise btn alongside qty
     customBtnCls   string          Tables: CSS class for always-visible customise btn
     customLabel    string          Tables: label for customise button
     bothWrapCls    string          Tables: wrapper CSS when both are shown
   ═══════════════════════════════════════════════════════════ */

window.ItemControls = (function () {
  'use strict';

  /* ── Badge span ──────────────────────────────────────────── */
  function badgeHTML(item) {
    if (!item.badge) return '';
    const presets = {
      top:  'background:rgba(232,160,32,0.9);color:#111;',
      veg:  'background:rgba(61,122,40,0.85);',
      hot:  'background:rgba(217,58,43,0.9);',
      save: 'background:var(--accent);color:#111;',
    };
    const css = presets[item.badgeStyle] ||
      (item.badgeStyle ? `background:${Kravon.esc(item.badgeStyle)};` : '');
    return `<span class="item-badge" style="${css}">${Kravon.esc(item.badge)}</span>`;
  }

  /* ── Accent CSS vars ─────────────────────────────────────── */
  function applyAccent(hex, subtleAlpha, borderAlpha) {
    const clean = (hex || '#c2d62a').replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const root = document.documentElement;
    root.style.setProperty('--accent',        `#${clean}`);
    root.style.setProperty('--accent-subtle', `rgba(${r},${g},${b},${subtleAlpha || 0.06})`);
    root.style.setProperty('--accent-border', `rgba(${r},${g},${b},${borderAlpha || 0.15})`);
  }

  /* ── Add / qty control factory ───────────────────────────── */
  function makeRenderer(cfg) {
    const tag = cfg.countTag || 'span';

    return function ctrlHTML(item) {
      const id       = Kravon.esc(String(item.id));
      const name     = Kravon.esc(item.name);
      const qty      = cfg.getQty(item.id);
      const isCustom = cfg.isCustomKey ? !!item[cfg.isCustomKey] : false;

      /* Tables keepCustom: "Customise" always visible, qty alongside when > 0 */
      if (cfg.keepCustom && isCustom) {
        const customBtn = `<button class="${cfg.customBtnCls}"
                                   data-action="${cfg.customAction}"
                                   data-${cfg.idAttr}="${id}"
                                   aria-label="Customise ${name}">${cfg.customLabel || 'Customise'}</button>`;
        if (qty === 0) return customBtn;
        return `<div class="${cfg.bothWrapCls}">
          <div class="${cfg.ctrlCls}" role="group" aria-label="Quantity for ${name}">
            <button class="${cfg.decCls}" data-action="${cfg.decAction}" data-${cfg.idAttr}="${id}" aria-label="Decrease quantity">−</button>
            <${tag} class="${cfg.countCls}" aria-live="polite">${qty}</${tag}>
            <button class="${cfg.incCls}" data-action="${cfg.incAction}" data-${cfg.idAttr}="${id}" aria-label="Increase quantity">+</button>
          </div>
          ${customBtn}
        </div>`;
      }

      /* Standard: toggle between add button and qty control */
      if (qty === 0) {
        const action = isCustom ? cfg.customAction : cfg.addAction;
        return `<button class="${cfg.addBtnCls}"
                        data-action="${action}"
                        data-${cfg.idAttr}="${id}"
                        aria-label="Add ${name}">${cfg.addLabel || 'Add'}</button>`;
      }

      const plusAction = isCustom ? cfg.customAction : cfg.incAction;
      return `
        <div class="${cfg.ctrlCls}" role="group" aria-label="Quantity for ${name}">
          <button class="${cfg.decCls}" data-action="${cfg.decAction}" data-${cfg.idAttr}="${id}" aria-label="Decrease quantity">−</button>
          <${tag} class="${cfg.countCls}" aria-live="polite">${qty}</${tag}>
          <button class="${cfg.incCls}" data-action="${plusAction}" data-${cfg.idAttr}="${id}" aria-label="Increase quantity">+</button>
        </div>`;
    };
  }

  return { badgeHTML, applyAccent, makeRenderer };

})();
