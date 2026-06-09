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
  let _editingIdx  = -1;
  let _modalQty    = 1;
  let _modalItem   = { id: '', name: '', price: 0 };
  let _currentItem = null;

  const API_BASE = typeof KRAVON_API_URL !== 'undefined'
    ? KRAVON_API_URL
    : (new URLSearchParams(window.location.search).get('api') || 'http://localhost:3000');
  const SLUG = typeof RESTAURANT_SLUG_ENV !== 'undefined'
    ? RESTAURANT_SLUG_ENV
    : (new URLSearchParams(window.location.search).get('slug') || '');

  async function _fetchItemDetails(itemId) {
    try {
      const res = await fetch(`${API_BASE}/v1/restaurants/${SLUG}/config/items/${itemId}`);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  function _buildVariants(item) {
    const container = document.getElementById('tablesModalVariants');
    const section   = document.getElementById('tablesModalVariantsSection');
    if (!container || !section) return;
    const variants = item?.variants || [];
    if (!variants.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    container.innerHTML = variants.map((v, i) => `
      <div class="option-row">
        <label>
          <input type="radio" name="tables-variant" value="${Kravon.esc(v.id)}"
                 data-name="${Kravon.esc(v.name)}" data-price="${v.price}" ${i === 0 ? 'checked' : ''}>
          <span class="option-label">${Kravon.esc(v.name)}</span>
        </label>
        <span class="option-price">₹${v.price}</span>
      </div>`).join('');
  }

  function _buildCustomizations(item) {
    const container = document.getElementById('tablesModalCustomizations');
    const section   = document.getElementById('tablesModalCustomizationsSection');
    if (!container || !section) return;
    const groups = item?.customizations || [];
    if (!groups.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    container.innerHTML = groups.map(group => {
      const inputType = group.group_type === 'radio' ? 'radio' : 'checkbox';
      const name = `tables-custom-${group.id}`;
      const options = (group.options || []).map(opt => `
        <div class="option-row">
          <label>
            <input type="${inputType}" name="${name}" value="${Kravon.esc(opt.id)}"
                   data-name="${Kravon.esc(opt.name)}" data-price="${opt.price_modifier || 0}"
                   ${opt.is_default ? 'checked' : ''}>
            <span class="option-label">${Kravon.esc(opt.name)}</span>
          </label>
          <span class="option-price">${opt.price_modifier ? `+₹${opt.price_modifier}` : '₹0'}</span>
        </div>`).join('');
      return `
        <div class="modal-group">
          <div class="modal-group-label">${Kravon.esc(group.name)}${group.is_required ? ' *' : ''}</div>
          ${options}
        </div>`;
    }).join('');
  }

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
          <div class="option-label">${Kravon.esc(a.label)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="option-price"${a.price === 0 ? ' style="color:rgba(255,255,255,0.2);"' : ''}>
            ${a.price === 0 ? 'Free' : '+₹' + a.price}
          </span>
          <button type="button"
                  class="option-toggle"
                  data-action="tables-toggle-addon"
                  data-price="${a.price}"
                  aria-label="Toggle ${Kravon.esc(a.label)}"></button>
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
        ${Kravon.esc(s)}
      </button>`
    ).join('');
  }

  /* ── Open modal for a new add ── */
  async function open(itemId) {
    const item = _findMenuItem(itemId);
    if (!item) return;

    // If exactly one cart entry exists for this item, edit it in place
    const cartItems    = TablesCart.getItems();
    const matchIndices = cartItems.reduce((acc, ci, i) => {
      if (String(ci.id) === String(itemId)) acc.push(i);
      return acc;
    }, []);
    if (matchIndices.length === 1) { openEdit(matchIndices[0]); return; }

    _editingIdx  = -1;
    _modalQty    = 1;
    _currentItem = item;

    if (item.has_variants || item.customise || item.is_customizable) {
      const full = await _fetchItemDetails(item.id);
      if (full) _currentItem = { ...item, ...full };
    }

    _modalItem = { id: _currentItem.id, name: _currentItem.name, price: _currentItem.price };
    _setHeader(_currentItem.name, _currentItem.price, _currentItem.desc);
    _buildVariants(_currentItem);
    _buildCustomizations(_currentItem);
    buildAddons();
    buildSpice();
    _resetOptions();
    _updateBtn();

    const modal = document.getElementById('tablesCustomModal');
    if (modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
    document.body.style.overflow = 'hidden';
  }

  /* ── Open modal to edit an existing cart entry ── */
  async function openEdit(idx) {
    const cartItems = TablesCart.getItems();
    const entry     = cartItems[idx];
    if (!entry) return;

    const menuItem  = _findMenuItem(entry.id);
    const basePrice = menuItem ? menuItem.price : entry.price;

    _editingIdx  = idx;
    _modalItem   = { id: entry.id, name: entry.name, price: basePrice };
    _modalQty    = entry.qty;
    _currentItem = menuItem || { id: entry.id, name: entry.name, price: basePrice };

    if (_currentItem.has_variants || _currentItem.customise || _currentItem.is_customizable) {
      const full = await _fetchItemDetails(entry.id);
      if (full) _currentItem = { ..._currentItem, ...full };
    }

    _setHeader(entry.name, basePrice, menuItem?.desc);
    _buildVariants(_currentItem);
    _buildCustomizations(_currentItem);
    buildAddons();
    buildSpice();
    _resetOptions();

    if (entry.note) {
      const levels = window.SPICE_LEVELS || [];
      entry.note.split(' · ').forEach(part => {
        document.querySelectorAll('#tablesCustomModal .spice-btn').forEach(b => {
          if (b.textContent.trim() === part.replace('Spice: ', '')) {
            document.querySelectorAll('#tablesCustomModal .spice-btn').forEach(x => {
              x.classList.remove('active'); x.setAttribute('aria-pressed', 'false');
            });
            b.classList.add('active'); b.setAttribute('aria-pressed', 'true');
          }
        });
        document.querySelectorAll('#tablesCustomModal .option-toggle').forEach(t => {
          const label = t.closest('.option-row')?.querySelector('.option-label')?.textContent.trim();
          if (label === part) t.classList.add('checked');
        });
        const knownParts = [
          ...(window.ADDONS || []).map(a => a.label),
          ...(window.SPICE_LEVELS || []),
          ...(window.SPICE_LEVELS || []).map(s => 'Spice: ' + s),
        ];
        if (!knownParts.includes(part)) {
          const si = document.getElementById('tablesSpecialInput');
          if (si) si.value = part;
        }
      });
    }

    const qtyEl = document.getElementById('tablesModalQty');
    if (qtyEl) qtyEl.textContent = _modalQty;
    _updateBtn();

    const modal = document.getElementById('tablesCustomModal');
    if (modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
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

    // Variant selection
    const variantRadio = document.querySelector('#tablesCustomModal input[name="tables-variant"]:checked');
    const variant = variantRadio ? {
      id: variantRadio.value, name: variantRadio.dataset.name || '',
      price: parseFloat(variantRadio.dataset.price || '0'),
    } : null;
    if (variant) extras.push(variant.name);

    // Customization groups
    document.querySelectorAll('#tablesModalCustomizations input[name^="tables-custom-"]:checked').forEach(input => {
      const label = input.dataset.name || input.value;
      if (label) extras.push(label);
      addons += parseFloat(input.dataset.price || '0');
    });

    // Add-on toggles
    document.querySelectorAll('#tablesCustomModal .option-toggle.checked').forEach(t => {
      const row   = t.closest('.option-row');
      const label = row ? row.querySelector('.option-label')?.textContent.trim() : '';
      if (label) extras.push(label);
      addons += parseInt(t.dataset.price || '0', 10);
    });

    const special   = (document.getElementById('tablesSpecialInput')?.value || '').trim();
    const noteParts = [
      variant ? variant.name : '',
      (spice && spice !== (levels[0] || '')) ? 'Spice: ' + spice : '',
      ...extras.filter(e => e !== (variant?.name || '')),
      special,
    ].filter(Boolean);
    const note      = noteParts.join(' · ');
    const unitPrice = (variant ? variant.price : _modalItem.price) + addons;

    if (_editingIdx >= 0) {
      TablesCart.replaceItem(_editingIdx, { id: _modalItem.id, name: _modalItem.name, price: unitPrice, qty: _modalQty, note });
    } else {
      TablesCart.upsertItem(_modalItem.id, _modalItem.name, unitPrice, _modalQty, note);
    }
    _editingIdx = -1;
    close();
    return _modalItem.id;
  }

  /* ── Private helpers ── */
  function _setHeader(name, price, desc) {
    const nameEl  = document.getElementById('tablesModalItemName');
    const priceEl = document.getElementById('tablesModalItemPrice');
    const descEl  = document.getElementById('tablesModalItemDesc');
    if (nameEl)  nameEl.textContent  = name;
    if (priceEl) priceEl.textContent = TablesCart.fmt(price);
    if (descEl) {
      descEl.textContent = desc || '';
      descEl.style.display = desc ? '' : 'none';
    }
  }

  function _resetOptions() {
    document.querySelectorAll('#tablesCustomModal .option-toggle')
      .forEach(t => t.classList.remove('checked'));
    document.querySelectorAll('#tablesCustomModal .spice-btn').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    });
    document.querySelectorAll('#tablesCustomModal input[name="tables-variant"]').forEach((r, i) => {
      r.checked = i === 0;
    });
    document.querySelectorAll('#tablesModalCustomizations input[name^="tables-custom-"]').forEach(r => {
      r.checked = r.defaultChecked || false;
    });
    const si = document.getElementById('tablesSpecialInput');
    if (si) si.value = '';
    const qtyEl = document.getElementById('tablesModalQty');
    if (qtyEl) qtyEl.textContent = '1';
  }

  function _calcModalPrice() {
    let addons = 0;
    const variantRadio = document.querySelector('#tablesCustomModal input[name="tables-variant"]:checked');
    const basePrice = variantRadio ? parseFloat(variantRadio.dataset.price || '0') : _modalItem.price;
    document.querySelectorAll('#tablesModalCustomizations input[name^="tables-custom-"]:checked').forEach(i => {
      addons += parseFloat(i.dataset.price || '0');
    });
    document.querySelectorAll('#tablesCustomModal .option-toggle.checked').forEach(t => {
      addons += parseInt(t.dataset.price || '0', 10);
    });
    return (basePrice + addons) * _modalQty;
  }

  function _updateBtn() {
    const btn = document.getElementById('tablesModalAddBtn');
    if (!btn) return;
    const label = _editingIdx >= 0 ? 'Update Order' : 'Add to Order';
    btn.textContent = `${label} — ${TablesCart.fmt(_calcModalPrice())}`;
  }

  function _findMenuItem(id) {
    for (const cat of (window.MENU || [])) {
      const item = cat.items.find(i => String(i.id) === String(id));
      if (item) return item;
    }
    return null;
  }

  /* ── Public init — called from boot after renderer runs ── */
  function init() {
    buildAddons();
    buildSpice();

    // Live char counter
    const specialInput = document.getElementById('tablesSpecialInput');
    const charCount    = document.getElementById('tablesSpecialCharCount');
    if (specialInput && charCount) {
      const max = parseInt(specialInput.getAttribute('maxlength') || '120', 10);
      specialInput.addEventListener('input', () => {
        const remaining = max - specialInput.value.length;
        charCount.textContent = remaining;
        charCount.classList.toggle('char-count--warn', remaining < 20);
      });
    }

    // Update price button when variant or customization inputs change
    document.addEventListener('change', e => {
      if (!e.target.closest('#tablesCustomModal')) return;
      if (e.target.matches('input[name="tables-variant"], input[name^="tables-custom-"]')) {
        _updateBtn();
      }
    });
  }

  return { init, open, openEdit, close, incQty, decQty, toggleAddon, setSpice, confirm };

})();
