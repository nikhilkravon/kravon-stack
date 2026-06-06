/* ═══════════════════════════════════════════════════════════
   MODAL.JS — Customisation modal (add-ons, spice, qty).
   Owns its own state: editingIdx, modalQty, modalItem.
   Depends on: config/config.js (ADDONS, SPICE_LEVELS, MENU, CONFIG)
               cart.js (Cart)
   ═══════════════════════════════════════════════════════════ */
const Modal = (() => {

  /* ── Private state ── */
  const API_BASE = typeof KRAVON_API_URL !== 'undefined'
    ? KRAVON_API_URL
    : (new URLSearchParams(window.location.search).get('api') || 'http://localhost:3000');
  const SLUG = typeof RESTAURANT_SLUG_ENV !== 'undefined'
    ? RESTAURANT_SLUG_ENV
    : (new URLSearchParams(window.location.search).get('slug') || '');

  let _editingIdx = -1;
  let _modalQty   = 1;
  let _modalItem  = { id: '', name: '', price: 0 };
  let _currentItem = null;

  /* ── Build add-on rows from ADDONS config ── */
  function buildAddons() {
    const container = document.getElementById('modalAddons');
    if (!container) return;

    const addons  = window.ADDONS || [];
    const section = container.closest('.modal-section');

    if (!addons.length) {
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';

    container.innerHTML = addons.map(a => `
      <div class="option-row" data-action="toggle-addon">
        <div>
          <div class="option-label">${Kravon.esc(a.label)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="option-price"${a.price === 0 ? ' style="color:rgba(255,255,255,0.2);"' : ''}>
            ${a.price === 0 ? 'Free' : '+₹' + a.price}
          </span>
          <button type="button"
                  class="option-toggle"
                  data-action="toggle-addon"
                  data-price="${a.price}"
                  aria-label="Toggle ${Kravon.esc(a.label)}"></button>
        </div>
      </div>`
    ).join('');
  }

  /* ── Build spice buttons from SPICE_LEVELS config ── */
  function buildSpice() {
    const container = document.getElementById('spiceOptions');
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
              data-action="set-spice"
              aria-pressed="${i === 0 ? 'true' : 'false'}">
        ${Kravon.esc(s)}
      </button>`
    ).join('');
  }

  function buildVariants(item) {
    const container = document.getElementById('modalVariants');
    const section   = document.getElementById('modalVariantsSection');
    if (!container || !section) return;

    const variants = item?.variants || [];
    if (!variants.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    container.innerHTML = variants.map((v, i) => `
      <div class="option-row">
        <label>
          <input type="radio" name="variant" value="${Kravon.esc(v.id)}"
                 data-name="${Kravon.esc(v.name)}"
                 data-price="${v.price}"
                 ${i === 0 ? 'checked' : ''}>
          <span class="option-label">${Kravon.esc(v.name)}</span>
        </label>
        <span class="option-price">₹${v.price}</span>
      </div>`).join('');
  }

  function buildCustomizations(item) {
    const container = document.getElementById('modalCustomizations');
    const section   = document.getElementById('modalCustomizationsSection');
    if (!container || !section) return;

    const groups = item?.customizations || [];
    if (!groups.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    container.innerHTML = groups.map(group => {
      const isRadio   = group.group_type === 'radio';
      const inputType = isRadio ? 'radio' : 'checkbox';
      const name      = `custom-${group.id}`;

      const options = (group.options || []).map(opt => `
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
          <div class="modal-group-label">
            ${Kravon.esc(group.name)}${group.is_required ? ' *' : ''}
          </div>
          ${options}
        </div>`;
    }).join('');
  }

  async function _fetchItemDetails(itemId) {
    try {
      const response = await fetch(`${API_BASE}/v1/restaurants/${SLUG}/config/items/${itemId}`);
      if (!response.ok) throw new Error('Failed to fetch item details');
      return await response.json();
    } catch (err) {
      console.error('[orders modal] Failed to fetch item details:', err.message);
      return null;
    }
  }

  /* ── Open modal for a new add ── */
  async function open(itemId) {
    const item = _findMenuItem(itemId);
    if (!item) return;

    // If exactly one cart entry exists for this item, edit it in place
    // to prevent duplicate line items with conflicting customisations.
    const cartItems    = Cart.getItems();
    const matchIndices = cartItems.reduce((acc, ci, i) => {
      if (String(ci.id) === String(itemId)) acc.push(i);
      return acc;
    }, []);

    if (matchIndices.length === 1) {
      openEdit(matchIndices[0]);
      return;
    }

    _editingIdx = -1;
    _modalQty   = 1;
    _currentItem = item;

    if (item.has_variants || item.customise || item.is_customizable) {
      const fullItem = await _fetchItemDetails(item.id);
      if (fullItem) {
        _currentItem = { ...item, ...fullItem };
      }
    }

    _modalItem  = { id: _currentItem.id, name: _currentItem.name, price: _currentItem.price };

    _setHeader(_currentItem.name, _currentItem.price, _currentItem.desc);
    buildVariants(_currentItem);
    buildCustomizations(_currentItem);
    buildAddons();
    buildSpice();
    _resetOptions();
    _updateBtn();

    document.getElementById('customModal').classList.add('open');
    document.getElementById('customModal').setAttribute('aria-hidden', 'false');
  }

  /* ── Open modal to edit an existing cart entry ── */
  async function openEdit(idx) {
    const cartItems = Cart.getItems();
    const entry     = cartItems[idx];
    if (!entry) return;

    /* Derive base price from MENU (ignore add-on price already in entry.price) */
    const menuItem = _findMenuItem(entry.id);
    const basePrice = menuItem ? menuItem.price : entry.price;

    _editingIdx = idx;
    _modalQty   = entry.qty;
    _currentItem = menuItem || { id: entry.id, name: entry.name, price: basePrice };

    if (_currentItem.has_variants || _currentItem.customise || _currentItem.is_customizable) {
      const fullItem = await _fetchItemDetails(entry.id);
      if (fullItem) {
        _currentItem = { ..._currentItem, ...fullItem };
      }
    }

    _modalItem  = { id: entry.id, name: entry.name, price: basePrice };

    _setHeader(entry.name, basePrice, _currentItem.desc);
    buildVariants(_currentItem);
    buildCustomizations(_currentItem);
    buildAddons();
    buildSpice();
    _resetOptions();

    /* Re-apply saved note parts */
    if (entry.note) {
      const parts = entry.note.split(' · ');
      parts.forEach(part => {
        /* Variant match */
        document.querySelectorAll('input[name="variant"]').forEach(input => {
          if (input.dataset.name && input.dataset.name.trim() === part) {
            input.checked = true;
          }
        });
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
        /* Customization match */
        document.querySelectorAll('#modalCustomizations input[name^="custom-"]').forEach(input => {
          if (input.dataset.name && input.dataset.name.trim() === part) {
            input.checked = true;
          }
        });
        /* Special instructions */
        const knownParts = [
          ...(window.ADDONS || []).map(a => a.label),
          ...(window.SPICE_LEVELS || []),
          ...(window.SPICE_LEVELS || []).map(s => 'Spice: ' + s),
          ...Array.from(document.querySelectorAll('#modalCustomizations input[name^="custom-"]'))
                 .map(input => input.dataset.name?.trim()).filter(Boolean),
          ...Array.from(document.querySelectorAll('input[name="variant"]'))
                 .map(input => input.dataset.name?.trim()).filter(Boolean),
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
    const row = btn.closest('.option-row');
    if (!row) return;
    const toggle = row.querySelector('.option-toggle');
    if (!toggle) return;
    toggle.classList.toggle('checked');
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
    const levels   = window.SPICE_LEVELS || [];
    const spiceBtn = document.querySelector('.spice-btn.active');
    const spice    = spiceBtn ? spiceBtn.textContent.trim() : (levels[0] || '');

    const extras  = [];
    let   addons  = 0;
    const variantRadio = document.querySelector('input[name="variant"]:checked');
    const variant = variantRadio ? {
      id:    variantRadio.value,
      name:  variantRadio.dataset.name || '',
      price: parseFloat(variantRadio.dataset.price || '0'),
    } : null;

    document.querySelectorAll('#modalCustomizations input[name^="custom-"]:checked').forEach(input => {
      const label = input.dataset.name || input.value;
      if (label) extras.push(label);
      addons += parseFloat(input.dataset.price || '0');
    });

    document.querySelectorAll('.option-toggle.checked').forEach(t => {
      const row   = t.closest('.option-row');
      const label = row ? row.querySelector('.option-label')?.textContent.trim() : '';
      if (label) extras.push(label);
      addons += parseInt(t.dataset.price || '0', 10);
    });

    const special  = (document.getElementById('specialInput')?.value || '').trim();
    const noteParts = [
      variant ? variant.name : '',
      (spice && spice !== (levels[0] || '')) ? 'Spice: ' + spice : '',
      ...extras,
      special,
    ].filter(Boolean);
    const note      = noteParts.join(' · ');
    const unitPrice = (variant ? variant.price : _modalItem.price) + addons;

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
  function _setHeader(name, price, desc) {
    const nameEl  = document.getElementById('modalItemName');
    const priceEl = document.getElementById('modalItemPrice');
    const descEl  = document.getElementById('modalItemDesc');
    if (nameEl)  nameEl.textContent  = name;
    if (priceEl) priceEl.textContent = Cart.fmt(price);
    if (descEl) {
      descEl.textContent = desc || '';
      descEl.style.display = desc ? '' : 'none';
    }
  }

  function _resetOptions() {
    document.querySelectorAll('.option-toggle').forEach(t => t.classList.remove('checked'));
    document.querySelectorAll('.spice-btn').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    });
    document.querySelectorAll('input[name="variant"]').forEach((input, i) => {
      input.checked = i === 0;
    });
    document.querySelectorAll('#modalCustomizations input[name^="custom-"]').forEach(input => {
      input.checked = input.defaultChecked || false;
    });
    const specialInput = document.getElementById('specialInput');
    if (specialInput) specialInput.value = '';
    document.getElementById('modalQty').textContent = '1';
  }

  function _calcModalPrice() {
    let addons = 0;
    const variantRadio = document.querySelector('input[name="variant"]:checked');
    const basePrice = variantRadio ? parseFloat(variantRadio.dataset.price || '0') : _modalItem.price;

    document.querySelectorAll('#modalCustomizations input[name^="custom-"]:checked').forEach(input => {
      addons += parseFloat(input.dataset.price || '0');
    });
    document.querySelectorAll('.option-toggle.checked').forEach(t => {
      addons += parseInt(t.dataset.price || '0', 10);
    });
    return (basePrice + addons) * _modalQty;
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

  /* ── Public init ── */
  function init() {
    buildAddons();
    buildSpice();

    // Live char counter for special instructions
    const specialInput = document.getElementById('specialInput');
    const charCount    = document.getElementById('specialCharCount');
    if (specialInput && charCount) {
      const max = parseInt(specialInput.getAttribute('maxlength') || '120', 10);
      specialInput.addEventListener('input', () => {
        const remaining = max - specialInput.value.length;
        charCount.textContent = remaining;
        charCount.classList.toggle('char-count--warn', remaining < 20);
      });
    }

    document.addEventListener('change', (event) => {
      const target = event.target;
      if (!target.closest('#customModal')) return;
      if (target.matches('input[name="variant"], #modalCustomizations input[name^="custom-"]')) {
        _updateBtn();
      }
    });
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
