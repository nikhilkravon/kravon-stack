/* ═══════════════════════════════════════════════════════════
   PRESENCE — CUSTOMIZATION-MODAL.JS
   Modal UI for customizing menu items before adding to cart.
   
   Usage:
   CustomizationModal.open(menuItem, (customizedItem) => {
     EnhancedCart.add(customizedItem);
   });
   ═══════════════════════════════════════════════════════════ */

const CustomizationModal = (function () {
  'use strict';

  const API_BASE = typeof KRAVON_API_URL !== 'undefined'
    ? KRAVON_API_URL
    : (new URLSearchParams(window.location.search).get('api') || 'http://localhost:3000');
  const SLUG = typeof RESTAURANT_SLUG_ENV !== 'undefined'
    ? RESTAURANT_SLUG_ENV
    : (new URLSearchParams(window.location.search).get('slug') || '');

  let _modal = null;
  let _currentItem = null;
  let _selectedVariant = null;
  let _selectedCustomizations = {};
  let _onConfirm = null;

  function _esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function _buildVariantSection(item) {
    if (!item.has_variants || !item.variants || item.variants.length === 0) {
      return '';
    }

    const variantHtml = item.variants.map(v => `
      <label class="cust-radio-label">
        <input type="radio" name="variant" value="${v.id}" data-name="${_esc(v.name)}" data-price="${v.price}" />
        <span class="cust-radio-text">${_esc(v.name)} — ${window.Kravon?.formatCurrency(v.price) || `₹${v.price}`}</span>
      </label>
    `).join('');

    return `
      <div class="cust-group">
        <label class="cust-group-label">Size/Portion <span class="cust-required">*</span></label>
        <div class="cust-options">
          ${variantHtml}
        </div>
      </div>
    `;
  }

  function _buildCustomizationGroups(groups) {
    if (!groups || groups.length === 0) return '';

    return groups.map(group => {
      const isRadio = group.group_type === 'radio';
      const inputType = isRadio ? 'radio' : 'checkbox';
      const inputName = `custom-${group.id}`;

      const optionsHtml = (group.options || []).map(opt => `
        <label class="cust-option-label">
          <input 
            type="${inputType}" 
            name="${inputName}" 
            value="${opt.id}" 
            data-name="${_esc(opt.name)}"
            data-price="${opt.price_modifier}"
            ${opt.is_default ? 'checked' : ''}
          />
          <span class="cust-option-text">
            ${_esc(opt.name)}
            ${opt.price_modifier !== 0 ? ` (+₹${opt.price_modifier})` : ''}
          </span>
        </label>
      `).join('');

      const requiredClass = group.is_required ? 'cust-required' : '';
      return `
        <div class="cust-group">
          <label class="cust-group-label">
            ${_esc(group.name)}
            ${group.is_required ? '<span class="cust-required">*</span>' : ''}
          </label>
          <div class="cust-options">
            ${optionsHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  function _buildModal(item, customizations) {
    const variantSection = _buildVariantSection(item);
    const customizationGroups = _buildCustomizationGroups(customizations);
    const basePrice = item.price || (item.variants && item.variants[0]?.price) || 0;

    const html = `
      <div class="cust-overlay"></div>
      <div class="cust-panel">
        <div class="cust-header">
          <button class="cust-close" aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <h2 class="cust-title">${item.name}</h2>
        </div>

        <div class="cust-body">
          ${item.description ? `<p class="cust-description">${item.description}</p>` : ''}
          
          <form id="customizationForm">
            ${variantSection}
            ${customizationGroups}

            <div class="cust-group">
              <label class="cust-group-label">Special Instructions (optional)</label>
              <textarea 
                id="specialNote" 
                class="cust-textarea" 
                placeholder="e.g., No onions, Extra spicy"
                maxlength="500"
              ></textarea>
            </div>
          </form>
        </div>

        <div class="cust-footer">
          <div class="cust-price-display">
            <span class="cust-price-label">Total</span>
            <span class="cust-price-value" id="priceDisplay">₹${basePrice}</span>
          </div>
          <div class="cust-quantity">
            <button type="button" class="cust-qty-btn" id="qtyMinus">−</button>
            <input type="number" id="quantity" value="1" min="1" max="99" readonly />
            <button type="button" class="cust-qty-btn" id="qtyPlus">+</button>
          </div>
          <button type="button" class="cust-add-btn" id="addBtn">Add to Cart</button>
        </div>
      </div>
    `;

    _modal = _el('div', 'cust-modal', html);
    return _modal;
  }

  function _calculateTotal() {
    let basePrice = _selectedVariant?.price || _currentItem.price || 0;
    let customizationModifier = 0;

    Object.entries(_selectedCustomizations).forEach(([groupId, selectedOptions]) => {
      selectedOptions.forEach(optId => {
        const group = _currentItem.customizations?.find(g => g.id === groupId);
        const option = group?.options?.find(o => o.id === optId);
        if (option) customizationModifier += option.price_modifier || 0;
      });
    });

    const qty = parseInt(document.getElementById('quantity')?.value || 1);
    const total = (basePrice + customizationModifier) * qty;
    
    const priceDisplay = document.getElementById('priceDisplay');
    if (priceDisplay) {
      priceDisplay.textContent = `₹${total.toFixed(2)}`;
    }
  }

  function _collectSelections() {
    const formEl = document.getElementById('customizationForm');
    if (!formEl) return { variant: null, customizations: {} };

    // Variant selection
    const variantRadio = formEl.querySelector('input[name="variant"]:checked');
    _selectedVariant = variantRadio ? {
      id: variantRadio.value,
      name: variantRadio.dataset.name,
      price: parseFloat(variantRadio.dataset.price)
    } : null;

    // Customization selections
    _selectedCustomizations = {};
    formEl.querySelectorAll('[name^="custom-"]').forEach(input => {
      if (input.checked) {
        const groupId = input.name.replace('custom-', '');
        if (!_selectedCustomizations[groupId]) {
          _selectedCustomizations[groupId] = [];
        }
        _selectedCustomizations[groupId].push(input.value);
      }
    });

    return {
      variant: _selectedVariant,
      customizations: _selectedCustomizations
    };
  }

  function _attachEventListeners() {
    const overlay = _modal.querySelector('.cust-overlay');
    const closeBtn = _modal.querySelector('.cust-close');
    const addBtn = _modal.querySelector('#addBtn');
    const qtyMinus = _modal.querySelector('#qtyMinus');
    const qtyPlus = _modal.querySelector('#qtyPlus');
    const quantityInput = _modal.querySelector('#quantity');

    overlay.addEventListener('click', () => close());
    closeBtn.addEventListener('click', () => close());

    // Quantity buttons
    qtyMinus.addEventListener('click', () => {
      const qty = parseInt(quantityInput.value);
      if (qty > 1) quantityInput.value = qty - 1;
      _calculateTotal();
    });

    qtyPlus.addEventListener('click', () => {
      const qty = parseInt(quantityInput.value);
      if (qty < 99) quantityInput.value = qty + 1;
      _calculateTotal();
    });

    // Variant and customization selection changes
    _modal.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
      input.addEventListener('change', () => {
        _collectSelections();
        _calculateTotal();
      });
    });

    // Add to cart
    addBtn.addEventListener('click', () => {
      _collectSelections();

      // Build customization array for cart
      const customizations = Object.entries(_selectedCustomizations).map(([groupId, optionIds]) => {
        const group = _currentItem.customizations?.find(g => g.id === groupId);
        return {
          groupId: groupId,
          groupName: group?.name || 'Customization',
          selections: optionIds.map(optId => {
            const option = group?.options?.find(o => o.id === optId);
            return {
              optionId: optId,
              optionName: option?.name || 'Option',
              priceModifier: option?.price_modifier || 0
            };
          })
        };
      });

      const customizedItem = {
        menuItemId: _currentItem.id,
        name: _currentItem.name,
        quantity: parseInt(quantityInput.value),
        variant: _selectedVariant,
        customizations: customizations,
        specialNote: document.getElementById('specialNote')?.value || '',
        basePrice: _selectedVariant?.price || _currentItem.price || 0
      };

      if (_onConfirm) {
        _onConfirm(customizedItem);
      }

      close();
    });
  }

  /**
   * Fetch menu item details with variants and customizations
   */
  async function _fetchItemDetails(menuItemId) {
    try {
      const response = await fetch(`${API_BASE}/v1/restaurants/${SLUG}/menu/items/${menuItemId}`);
      if (!response.ok) throw new Error('Failed to fetch item details');
      return await response.json();
    } catch (err) {
      console.error('Error fetching item details:', err);
      // Return basic item if fetch fails
      return _currentItem;
    }
  }

  /**
   * Open customization modal for a menu item
   * @param {Object} item - Basic menu item { id, name, price, has_variants?, is_customizable? }
   * @param {Function} onConfirm - Callback with customized item ready for cart
   */
  async function open(item, onConfirm) {
    _currentItem = item;
    _onConfirm = onConfirm;
    _selectedVariant = null;
    _selectedCustomizations = {};

    // Fetch full item details (variants, customizations)
    if (item.has_variants || item.is_customizable) {
      const fullItem = await _fetchItemDetails(item.id);
      _currentItem = { ...item, ...fullItem };
    }

    // Build and open modal
    const modalEl = _buildModal(_currentItem, _currentItem.customizations || []);
    document.body.appendChild(modalEl);

    _attachEventListeners();

    // Trigger initial price calculation
    setTimeout(() => _calculateTotal(), 0);
  }

  /**
   * Close modal
   */
  function close() {
    if (_modal && _modal.parentNode) {
      _modal.parentNode.removeChild(_modal);
    }
    _modal = null;
    _currentItem = null;
    _onConfirm = null;
  }

  return {
    open,
    close
  };

})();
