/* ═══════════════════════════════════════════════════════════
   MODAL.JS — Customisation modal (add-ons, spice, qty).
   Owns its own state: editingIdx, modalQty, modalItem.
   Depends on: config/config.js (ADDONS, SPICE_LEVELS, MENU, CONFIG)
               cart.js (Cart)
   ═══════════════════════════════════════════════════════════ */
const Modal = (() => {

  /* ── Private state ── */
  let _editingIdx = -1;
  let _modalQty   = 1;
  let _modalItem  = { id: '', name: '', price: 0 };

  /* ── Build add-on rows from ADDONS config ── */
  function buildAddons() {
    const container = document.getElementById('modalAddons');
    if (!container) return;

    container.innerHTML = ADDONS.map(a => `
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
                  data-action="toggle-addon"
                  data-price="${a.price}"
                  aria-label="Toggle ${_esc(a.label)}"></button>
        </div>
      </div>`
    ).join('');
  }

  /* ── Build spice buttons from SPICE_LEVELS config ── */
  function buildSpice() {
    const container = document.getElementById('spiceOptions');
    if (!container) return;

    container.innerHTML = SPICE_LEVELS.map((s, i) => `
      <button class="spice-btn${i === 0 ? ' active' : ''}"
              data-action="set-spice"
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

    document.getElementById('customModal').classList.add('open');
    document.getElementById('customModal').setAttribute('aria-hidden', 'false');
  }

  /* ── Open modal to edit an existing cart entry ── */
  function openEdit(idx) {
    const cartItems = Cart.getItems();
    const entry     = cartItems[idx];
    if (!entry) return;

    /* Derive base price from MENU (ignore add-on price already in entry.price) */
    const menuItem = _findMenuItem(entry.id);
    const basePrice = menuItem ? menuItem.price : entry.price;

    _editingIdx = idx;
    _modalItem  = { id: entry.id, name: entry.name, price: basePrice };
    _modalQty   = entry.qty;

    _setHeader(entry.name, basePrice);
    _resetOptions();

    /* Re-apply saved note parts */
    if (entry.note) {
      entry.note.split(' · ').forEach(part => {
        /* Spice match */
        document.querySelectorAll('.spice-btn').forEach(b => {
          if (b.textContent.trim() === part.replace('Spice: ', '')) {
            document.querySelectorAll('.spice-btn').forEach(x => {
              x.classList.remove('active');
              x.setAttribute('aria-pressed', 'false');
            });
            b.classList.add('active');
            b.setAttribute('aria-pressed', 'true');
          }
        });
        /* Add-on match */
        document.querySelectorAll('.option-toggle').forEach(t => {
          const label = t.closest('.option-row')
            ?.querySelector('.option-label')?.textContent.trim();
          if (label === part) t.classList.add('checked');
        });
        /* Special instructions */
        const knownParts = [
          ...ADDONS.map(a => a.label),
          ...SPICE_LEVELS,
          ...SPICE_LEVELS.map(s => 'Spice: ' + s),
        ];
        if (!knownParts.includes(part)) {
          const specialInput = document.getElementById('specialInput');
          if (specialInput) specialInput.value = part;
        }
      });
    }

    document.getElementById('modalQty').textContent = _modalQty;
    _updateBtn();
    document.getElementById('customModal').classList.add('open');
    document.getElementById('customModal').setAttribute('aria-hidden', 'false');
  }

  /* ── Close modal ── */
  function close() {
    _editingIdx = -1;
    document.getElementById('customModal').classList.remove('open');
    document.getElementById('customModal').setAttribute('aria-hidden', 'true');
  }

  /* ── Quantity controls ── */
  function incQty() {
    _modalQty += 1;
    document.getElementById('modalQty').textContent = _modalQty;
    _updateBtn();
  }

  function decQty() {
    _modalQty = Math.max(1, _modalQty - 1);
    document.getElementById('modalQty').textContent = _modalQty;
    _updateBtn();
  }

  /* ── Addon toggle (called from delegated click in main.js) ── */
  function toggleAddon(btn) {
    btn.classList.toggle('checked');
    _updateBtn();
  }

  /* ── Spice selection ── */
  function setSpice(btn) {
    document.querySelectorAll('.spice-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    _updateBtn();
  }

  /* ── Confirm: add to cart or update existing ── */
  function confirm() {
    const spiceBtn = document.querySelector('.spice-btn.active');
    const spice = spiceBtn ? spiceBtn.textContent.trim() : SPICE_LEVELS[0];

    const extras  = [];
    let   addons  = 0;
    document.querySelectorAll('.option-toggle.checked').forEach(t => {
      const row   = t.closest('.option-row');
      const label = row ? row.querySelector('.option-label')?.textContent.trim() : '';
      if (label) extras.push(label);
      addons += parseInt(t.dataset.price || '0', 10);
    });

    const special  = (document.getElementById('specialInput')?.value || '').trim();
    const noteParts = [
      spice !== SPICE_LEVELS[0] ? 'Spice: ' + spice : '',
      ...extras,
      special,
    ].filter(Boolean);
    const note      = noteParts.join(' · ');
    const unitPrice = _modalItem.price + addons;

    if (_editingIdx >= 0) {
      Cart.replaceItem(_editingIdx, {
        id:    _modalItem.id,
        name:  _modalItem.name,
        price: unitPrice,
        qty:   _modalQty,
        note,
      });
    } else {
      Cart.upsertItem(_modalItem.id, _modalItem.name, unitPrice, _modalQty, note);
    }

    _editingIdx = -1;
    close();
    return _modalItem.id; // return id so caller can refresh the card button
  }

  /* ── Private helpers ── */
  function _setHeader(name, price) {
    const nameEl  = document.getElementById('modalItemName');
    const priceEl = document.getElementById('modalItemPrice');
    if (nameEl)  nameEl.textContent  = name;
    if (priceEl) priceEl.textContent = Cart.fmt(price);
  }

  function _resetOptions() {
    document.querySelectorAll('.option-toggle').forEach(t => t.classList.remove('checked'));
    document.querySelectorAll('.spice-btn').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    });
    const specialInput = document.getElementById('specialInput');
    if (specialInput) specialInput.value = '';
    document.getElementById('modalQty').textContent = '1';
  }

  function _calcModalPrice() {
    let addons = 0;
    document.querySelectorAll('.option-toggle.checked').forEach(t => {
      addons += parseInt(t.dataset.price || '0', 10);
    });
    return (_modalItem.price + addons) * _modalQty;
  }

  function _updateBtn() {
    const btn = document.getElementById('modalAddBtn');
    if (!btn) return;
    const label = _editingIdx >= 0 ? 'Update Order' : 'Add to Order';
    btn.textContent = `${label} — ${Cart.fmt(_calcModalPrice())}`;
  }

  function _findMenuItem(id) {
    for (const cat of MENU) {
      const item = cat.items.find(i => String(i.id) === String(id));
      if (item) return item;
    }
    return null;
  }

  function _esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Public init ── */
  function init() {
    buildAddons();
    buildSpice();
  }

  return {
    init,
    open,
    openEdit,
    close,
    incQty,
    decQty,
    toggleAddon,
    setSpice,
    confirm,
  };

})();
