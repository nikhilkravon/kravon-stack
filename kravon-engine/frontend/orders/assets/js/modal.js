/* ═══════════════════════════════════════════════════════════
   ORDERS — MODAL.JS
   Customisation modal (variants, add-ons, spice, qty).
   Adapted from Tables modal; uses OrdersCart and
   the ordersCustomModal IDs set by renderer.js.
   ═══════════════════════════════════════════════════════════ */
const OrdersModal = (() => {
  'use strict';

  let _editingIdx  = -1;
  let _modalQty    = 1;
  let _modalItem   = { id: '', name: '', price: 0 };
  let _currentItem = null;

  /* ── API fetch for full item details ─────────────────────── */
  async function _fetchItemDetails(itemId) {
    try {
      const _q   = new URLSearchParams(window.location.search);
      const base = (typeof KRAVON_API_URL !== 'undefined' && !KRAVON_API_URL.startsWith('%%'))
        ? KRAVON_API_URL
        : (_q.get('api') || 'http://localhost:3000');
      const slug = (typeof RESTAURANT_SLUG_ENV !== 'undefined' && !RESTAURANT_SLUG_ENV.startsWith('%%'))
        ? RESTAURANT_SLUG_ENV
        : (_q.get('slug') || '');
      const res = await fetch(`${base}/v1/restaurants/${slug}/config/items/${itemId}`);
      if (!res.ok) throw new Error('item fetch failed');
      return await res.json();
    } catch (err) {
      console.error('[orders:modal] fetchItemDetails:', err.message);
      return null;
    }
  }

  /* ── Populate modal sections ─────────────────────────────── */
  function _buildVariants(item) {
    const container = document.getElementById('ordersModalVariants');
    const section   = document.getElementById('ordersModalVariantsSection');
    if (!container || !section) return;
    const variants = item?.variants || [];
    if (!variants.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    container.innerHTML = variants.map((v, i) => `
      <div class="option-row">
        <label>
          <input type="radio" name="ordersVariant" value="${Kravon.esc(v.id)}"
                 data-name="${Kravon.esc(v.name)}" data-price="${v.price}"
                 ${i === 0 ? 'checked' : ''}>
          <span class="option-label">${Kravon.esc(v.name)}</span>
        </label>
        <span class="option-price">₹${v.price}</span>
      </div>`).join('');
  }

  function _buildCustomizations(item) {
    const container = document.getElementById('ordersModalCustomizations');
    const section   = document.getElementById('ordersModalCustomizationsSection');
    if (!container || !section) return;
    const groups = item?.customizations || [];
    if (!groups.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    container.innerHTML = groups.map(group => {
      const isRadio   = group.group_type === 'radio';
      const inputType = isRadio ? 'radio' : 'checkbox';
      const name      = `ordersCustom-${group.id}`;
      const options   = (group.options || []).map(opt => `
        <div class="option-row">
          <label>
            <input type="${inputType}" name="${name}" value="${Kravon.esc(opt.id)}"
                   data-name="${Kravon.esc(opt.name)}"
                   data-price="${opt.price_modifier || 0}"
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

  function _buildAddons() {
    const container = document.getElementById('ordersModalAddons');
    if (!container) return;
    const addons  = window.ADDONS || [];
    const section = container.closest('.modal-section');
    if (!addons.length) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = '';
    container.innerHTML = addons.map(a => `
      <div class="option-row" data-action="orders-toggle-addon">
        <div>
          <div class="option-label">${Kravon.esc(a.label)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="option-price"${a.price === 0 ? ' style="color:rgba(255,255,255,0.2)"' : ''}>
            ${a.price === 0 ? 'Free' : '+₹' + a.price}
          </span>
          <button type="button" class="option-toggle"
                  data-action="orders-toggle-addon"
                  data-price="${a.price}"
                  aria-label="Toggle ${Kravon.esc(a.label)}"></button>
        </div>
      </div>`).join('');
  }

  function _buildSpice() {
    const container = document.getElementById('ordersSpiceOptions');
    if (!container) return;
    const levels  = window.SPICE_LEVELS || [];
    const section = container.closest('.modal-section');
    if (!levels.length) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = '';
    container.innerHTML = levels.map((s, i) => `
      <button class="spice-btn${i === 0 ? ' active' : ''}"
              data-action="orders-set-spice"
              aria-pressed="${i === 0 ? 'true' : 'false'}">
        ${Kravon.esc(s)}
      </button>`).join('');
  }

  /* ── Open modal for new item ─────────────────────────────── */
  async function open(itemId) {
    const item = _findMenuItem(itemId);
    if (!item) return;

    // If exactly one cart entry exists for this item, edit it instead
    const cartItems    = OrdersCart.getItems();
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
    _populate();
  }

  /* ── Open modal to edit a cart entry ─────────────────────── */
  async function openEdit(idx) {
    const cartItems = OrdersCart.getItems();
    const entry     = cartItems[idx];
    if (!entry) return;

    const menuItem   = _findMenuItem(entry.id);
    const basePrice  = menuItem ? menuItem.price : entry.price;

    _editingIdx  = idx;
    _modalQty    = entry.qty;
    _currentItem = menuItem || { id: entry.id, name: entry.name, price: basePrice };

    if (_currentItem.has_variants || _currentItem.customise || _currentItem.is_customizable) {
      const full = await _fetchItemDetails(entry.id);
      if (full) _currentItem = { ..._currentItem, ...full };
    }

    _modalItem = { id: entry.id, name: entry.name, price: basePrice };
    _populate();

    // Re-apply saved note
    if (entry.note) {
      const parts = entry.note.split(' · ');
      parts.forEach(part => {
        document.querySelectorAll('input[name="ordersVariant"]').forEach(input => {
          if (input.dataset.name?.trim() === part) input.checked = true;
        });
        document.querySelectorAll('.spice-btn').forEach(b => {
          if (b.textContent.trim() === part.replace('Spice: ', '')) {
            document.querySelectorAll('.spice-btn').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
            b.classList.add('active'); b.setAttribute('aria-pressed', 'true');
          }
        });
        document.querySelectorAll('.option-toggle').forEach(t => {
          const label = t.closest('.option-row')?.querySelector('.option-label')?.textContent.trim();
          if (label === part) t.classList.add('checked');
        });
        document.querySelectorAll('#ordersModalCustomizations input[name^="ordersCustom-"]').forEach(input => {
          if (input.dataset.name?.trim() === part) input.checked = true;
        });
        const specialInput = document.getElementById('ordersSpecialInput');
        const knownParts = [
          ...(window.ADDONS || []).map(a => a.label),
          ...(window.SPICE_LEVELS || []),
          ...(window.SPICE_LEVELS || []).map(s => 'Spice: ' + s),
        ];
        if (!knownParts.includes(part) && specialInput && !specialInput.value) {
          specialInput.value = part;
        }
      });
    }

    document.getElementById('ordersModalQty').textContent = _modalQty;
    _updateBtn();
    _showModal();
  }

  function _populate() {
    _setHeader(_currentItem.name, _currentItem.price, _currentItem.desc);
    _buildVariants(_currentItem);
    _buildCustomizations(_currentItem);
    _buildAddons();
    _buildSpice();
    _resetOptions();
    _updateBtn();
    _showModal();
  }

  /* ── Close ───────────────────────────────────────────────── */
  function close() {
    _editingIdx  = -1;
    _modalQty    = 1;
    _modalItem   = { id: '', name: '', price: 0 };
    _currentItem = null;
    const modal = document.getElementById('ordersCustomModal');
    if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
  }

  /* ── Reset internal state without touching DOM modal ────── */
  function resetIfItem(itemId) {
    if (_currentItem && String(_currentItem.id) === String(itemId)) {
      close();
    }
  }

  /* ── Qty ─────────────────────────────────────────────────── */
  function incQty() {
    _modalQty += 1;
    document.getElementById('ordersModalQty').textContent = _modalQty;
    _updateBtn();
  }
  function decQty() {
    if (_modalQty <= 1) { close(); return; }
    _modalQty -= 1;
    document.getElementById('ordersModalQty').textContent = _modalQty;
    _updateBtn();
  }

  /* ── Addon / spice ───────────────────────────────────────── */
  function toggleAddon(btn) {
    const toggle = btn.closest('.option-row')?.querySelector('.option-toggle');
    if (!toggle) return;
    toggle.classList.toggle('checked');
    _updateBtn();
  }
  function setSpice(btn) {
    document.querySelectorAll('.spice-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
    btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
    _updateBtn();
  }

  /* ── Confirm ─────────────────────────────────────────────── */
  function confirm() {
    const levels   = window.SPICE_LEVELS || [];
    const spiceBtn = document.querySelector('#ordersSpiceOptions .spice-btn.active');
    const spice    = spiceBtn ? spiceBtn.textContent.trim() : (levels[0] || '');

    const extras  = [];
    let   addons  = 0;

    const variantRadio = document.querySelector('input[name="ordersVariant"]:checked');
    const variant = variantRadio ? {
      id:    variantRadio.value,
      name:  variantRadio.dataset.name || '',
      price: parseFloat(variantRadio.dataset.price || '0'),
    } : null;

    document.querySelectorAll('#ordersModalCustomizations input[name^="ordersCustom-"]:checked').forEach(input => {
      const label = input.dataset.name || input.value;
      if (label) extras.push(label);
      addons += parseFloat(input.dataset.price || '0');
    });
    document.querySelectorAll('#ordersCustomModal .option-toggle.checked').forEach(t => {
      const label = t.closest('.option-row')?.querySelector('.option-label')?.textContent.trim();
      if (label) extras.push(label);
      addons += parseInt(t.dataset.price || '0', 10);
    });

    const special    = (document.getElementById('ordersSpecialInput')?.value || '').trim();
    const noteParts  = [
      variant ? variant.name : '',
      spice && spice !== (levels[0] || '') ? 'Spice: ' + spice : '',
      ...extras,
      special,
    ].filter(Boolean);
    const note       = noteParts.join(' · ');
    const unitPrice  = (variant ? variant.price : _modalItem.price) + addons;

    if (_editingIdx >= 0) {
      OrdersCart.replaceItem(_editingIdx, {
        id:    _modalItem.id,
        name:  _modalItem.name,
        price: unitPrice,
        qty:   _modalQty,
        note,
      });
    } else {
      OrdersCart.upsertItem(_modalItem.id, _modalItem.name, unitPrice, _modalQty, note);
    }

    _editingIdx = -1;
    close();
    return _modalItem.id;
  }

  /* ── Private helpers ─────────────────────────────────────── */
  function _showModal() {
    const modal = document.getElementById('ordersCustomModal');
    if (modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
  }

  function _setHeader(name, price, desc) {
    const nameEl  = document.getElementById('ordersModalItemName');
    const priceEl = document.getElementById('ordersModalItemPrice');
    const descEl  = document.getElementById('ordersModalItemDesc');
    if (nameEl)  nameEl.textContent  = name;
    if (priceEl) priceEl.textContent = `₹${price}`;
    if (descEl)  { descEl.textContent = desc || ''; descEl.style.display = desc ? '' : 'none'; }
  }

  function _resetOptions() {
    document.querySelectorAll('#ordersCustomModal .option-toggle').forEach(t => t.classList.remove('checked'));
    document.querySelectorAll('#ordersSpiceOptions .spice-btn').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    });
    document.querySelectorAll('input[name="ordersVariant"]').forEach((input, i) => { input.checked = i === 0; });
    document.querySelectorAll('#ordersModalCustomizations input[name^="ordersCustom-"]').forEach(input => {
      input.checked = input.defaultChecked || false;
    });
    const specialInput = document.getElementById('ordersSpecialInput');
    if (specialInput) specialInput.value = '';
    const qtyEl = document.getElementById('ordersModalQty');
    if (qtyEl) qtyEl.textContent = '1';
    _modalQty = 1;
  }

  function _calcModalPrice() {
    const variantRadio = document.querySelector('input[name="ordersVariant"]:checked');
    const basePrice = variantRadio ? parseFloat(variantRadio.dataset.price || '0') : _modalItem.price;
    let addons = 0;
    document.querySelectorAll('#ordersModalCustomizations input[name^="ordersCustom-"]:checked').forEach(input => {
      addons += parseFloat(input.dataset.price || '0');
    });
    document.querySelectorAll('#ordersCustomModal .option-toggle.checked').forEach(t => {
      addons += parseInt(t.dataset.price || '0', 10);
    });
    return (basePrice + addons) * _modalQty;
  }

  function _updateBtn() {
    const btn = document.getElementById('ordersModalAddBtn');
    if (!btn) return;
    const label = _editingIdx >= 0 ? 'Update Order' : 'Add to Order';
    btn.textContent = `${label} — ₹${_calcModalPrice()}`;
  }

  function _findMenuItem(id) {
    for (const cat of (window.MENU || [])) {
      const item = cat.items.find(i => String(i.id) === String(id));
      if (item) return item;
    }
    return null;
  }

  /* ── Init ────────────────────────────────────────────────── */
  function init() {
    // Live char counter
    const specialInput = document.getElementById('ordersSpecialInput');
    const charCount    = document.getElementById('ordersSpecialCharCount');
    if (specialInput && charCount) {
      const max = parseInt(specialInput.getAttribute('maxlength') || '120', 10);
      specialInput.addEventListener('input', () => {
        const remaining = max - specialInput.value.length;
        charCount.textContent = remaining;
        charCount.classList.toggle('char-count--warn', remaining < 20);
      });
    }

    // Update price on variant/customization change
    document.addEventListener('change', e => {
      const target = e.target;
      if (!target.closest('#ordersCustomModal')) return;
      if (target.matches('input[name="ordersVariant"], #ordersModalCustomizations input[name^="ordersCustom-"]')) {
        _updateBtn();
      }
    });
  }

  return { init, open, openEdit, close, resetIfItem, incQty, decQty, toggleAddon, setSpice, confirm };

})();
