/* ═══════════════════════════════════════════════════════════
   TABLES — MODAL.JS
   Customisation modal: add-ons, spice level, special instructions.
   Shown only for items where customisable === true.
   Works identically for dine-in and takeaway — both are walk-ins.

   Depends on: TablesCart, window.ADDONS, window.SPICE_LEVELS, window.MENU
   ═══════════════════════════════════════════════════════════ */
const TablesModal = (() => {
  'use strict';

  /* ── Private state ── */
  let _editingIdx = -1;
  let _modalQty   = 1;
  let _modalItem  = { id: '', name: '', price: 0 };

  /* ── Build add-on rows ── */
  function buildAddons() {
    const container = document.getElementById('tablesModalAddons');
    if (!container) return;

    const addons = window.ADDONS || [];
    const section = container.closest('.modal-section');

    if (!addons.length) {
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';

    container.innerHTML = addons.map(a => `
      <div class="option-row">
        <div>
          <div class="option-label">${_esc(a.label)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="option-price"${a.price === 0 ? ' style="color:rgba(255,255,255,0.2);"' : ''}>
            ${a.price === 0 ? 'Free' : '+₹' + a.price}
          </span>
          <button type="button"
                  class="option-toggle"
                  data-action="tables-toggle-addon"
                  data-price="${a.price}"
                  aria-label="Toggle ${_esc(a.label)}"></button>
        </div>
      </div>`
    ).join('');
  }

  /* ── Build spice buttons ── */
  function buildSpice() {
    const container = document.getElementById('tablesSpiceOptions');
    if (!container) return;

    const levels  = window.SPICE_LEVELS || [];
    const section = container.closest('.modal-section');

    if (!levels.length) {
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';

    container.innerHTML = levels.map((s, i) => `
      <button class="spice-btn${i === 0 ? ' active' : ''}"
              data-action="tables-set-spice"
              aria-pressed="${i === 0 ? 'true' : 'false'}">
        ${_esc(s)}
      </button>`
    ).join('');
  }

  /* ── Open modal for a new add ── */
  function open(itemId) {
    const item = _findMenuItem(itemId);
    if (!item) return;

    _editingIdx = -1;
    _modalItem  = { id: item.id, name: item.name, price: item.price };
    _modalQty   = 1;

    _setHeader(item.name, item.price);
    _resetOptions();
    _updateBtn();

    const modal = document.getElementById('tablesCustomModal');
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }
    document.body.style.overflow = 'hidden';
  }

  /* ── Close modal ── */
  function close() {
    _editingIdx = -1;
    const modal = document.getElementById('tablesCustomModal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
  }

  /* ── Quantity controls ── */
  function incQty() {
    _modalQty += 1;
    const el = document.getElementById('tablesModalQty');
    if (el) el.textContent = _modalQty;
    _updateBtn();
  }

  function decQty() {
    _modalQty = Math.max(1, _modalQty - 1);
    const el = document.getElementById('tablesModalQty');
    if (el) el.textContent = _modalQty;
    _updateBtn();
  }

  /* ── Addon toggle ── */
  function toggleAddon(btn) {
    btn.classList.toggle('checked');
    _updateBtn();
  }

  /* ── Spice selection ── */
  function setSpice(btn) {
    document.querySelectorAll('#tablesCustomModal .spice-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    _updateBtn();
  }

  /* ── Confirm: build note string, upsert into cart ── */
  function confirm() {
    const levels   = window.SPICE_LEVELS || [];
    const spiceBtn = document.querySelector('#tablesCustomModal .spice-btn.active');
    const spice    = spiceBtn ? spiceBtn.textContent.trim() : (levels[0] || '');

    const extras = [];
    let   addons = 0;
    document.querySelectorAll('#tablesCustomModal .option-toggle.checked').forEach(t => {
      const row   = t.closest('.option-row');
      const label = row ? row.querySelector('.option-label')?.textContent.trim() : '';
      if (label) extras.push(label);
      addons += parseInt(t.dataset.price || '0', 10);
    });

    const special   = (document.getElementById('tablesSpecialInput')?.value || '').trim();
    const noteParts = [
      (spice && spice !== levels[0]) ? 'Spice: ' + spice : '',
      ...extras,
      special,
    ].filter(Boolean);
    const note      = noteParts.join(' · ');
    const unitPrice = _modalItem.price + addons;

    TablesCart.upsertItem(_modalItem.id, _modalItem.name, unitPrice, _modalQty, note);
    close();
    return _modalItem.id;
  }

  /* ── Private helpers ── */
  function _setHeader(name, price) {
    const nameEl  = document.getElementById('tablesModalItemName');
    const priceEl = document.getElementById('tablesModalItemPrice');
    if (nameEl)  nameEl.textContent  = name;
    if (priceEl) priceEl.textContent = TablesCart.fmt(price);
  }

  function _resetOptions() {
    document.querySelectorAll('#tablesCustomModal .option-toggle')
      .forEach(t => t.classList.remove('checked'));
    document.querySelectorAll('#tablesCustomModal .spice-btn').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    });
    const si = document.getElementById('tablesSpecialInput');
    if (si) si.value = '';
    const qtyEl = document.getElementById('tablesModalQty');
    if (qtyEl) qtyEl.textContent = '1';
  }

  function _calcModalPrice() {
    let addons = 0;
    document.querySelectorAll('#tablesCustomModal .option-toggle.checked').forEach(t => {
      addons += parseInt(t.dataset.price || '0', 10);
    });
    return (_modalItem.price + addons) * _modalQty;
  }

  function _updateBtn() {
    const btn = document.getElementById('tablesModalAddBtn');
    if (!btn) return;
    btn.textContent = `Add to Order — ${TablesCart.fmt(_calcModalPrice())}`;
  }

  function _findMenuItem(id) {
    for (const cat of (window.MENU || [])) {
      const item = cat.items.find(i => String(i.id) === String(id));
      if (item) return item;
    }
    return null;
  }

  function _esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── Public init — called from boot after renderer runs ── */
  function init() {
    buildAddons();
    buildSpice();
  }

  return { init, open, close, incQty, decQty, toggleAddon, setSpice, confirm };

})();
