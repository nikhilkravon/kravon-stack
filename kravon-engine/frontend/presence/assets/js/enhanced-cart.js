/* ═══════════════════════════════════════════════════════════
   PRESENCE — ENHANCED-CART.JS
   Enhanced cart state management with variants & customizations.
   
   Structure per cart item:
   {
     cartItemId: "unique-id-per-add",
     menuItemId: "uuid",
     name: "Biryani",
     quantity: 2,
     variant: { id, name, price },
     customizations: [
       { groupId, groupName, selections: [{ optionId, optionName, priceModifier }] }
     ],
     specialNote: "No onions",
     basePrice: 250,           // variant.price or item.price
     customizationTotal: 110,  // sum of price modifiers × quantity
     totalPrice: 720          // (basePrice + customizationTotal) × quantity
   }
   ═══════════════════════════════════════════════════════════ */

const EnhancedCart = (function () {
  'use strict';

  let _items = [];      // Array of cart items with full details
  const _subs = [];

  function _notify() {
    _subs.forEach(fn => fn());
  }

  function _generateCartItemId() {
    return `cart-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function _recalculatePrices(item) {
    const basePrice = item.variant?.price || item.basePrice || 0;
    const customizationModifier = item.customizations.reduce((sum, group) => {
      return sum + group.selections.reduce((s, sel) => s + (sel.priceModifier || 0), 0);
    }, 0);
    
    item.customizationTotal = customizationModifier * item.quantity;
    item.totalPrice = (basePrice + customizationModifier) * item.quantity;
    return item;
  }

  // ── Public API ──────────────────────────────────────────

  function subscribe(fn) {
    _subs.push(fn);
  }

  /**
   * Add item with full customization data
   * @param {Object} item - { menuItemId, name, quantity, variant?, customizations?, specialNote? }
   * @returns cartItemId for reference
   */
  function add(item) {
    const cartItem = {
      cartItemId: _generateCartItemId(),
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity || 1,
      variant: item.variant || null,
      customizations: item.customizations || [],
      specialNote: item.specialNote || '',
      basePrice: item.variant?.price || item.basePrice || 0,
      customizationTotal: 0,
      totalPrice: 0
    };
    
    _recalculatePrices(cartItem);
    _items.push(cartItem);
    _notify();
    return cartItem.cartItemId;
  }

  /**
   * Update quantity of existing cart item
   */
  function updateQuantity(cartItemId, newQuantity) {
    const item = _items.find(i => i.cartItemId === cartItemId);
    if (!item) return;
    
    if (newQuantity <= 0) {
      remove(cartItemId);
      return;
    }
    
    item.quantity = newQuantity;
    _recalculatePrices(item);
    _notify();
  }

  /**
   * Remove item from cart
   */
  function remove(cartItemId) {
    _items = _items.filter(i => i.cartItemId !== cartItemId);
    _notify();
  }

  /**
   * Clear entire cart
   */
  function clear() {
    _items = [];
    _notify();
  }

  /**
   * Get all items
   */
  function items() {
    return JSON.parse(JSON.stringify(_items));
  }

  /**
   * Get single item
   */
  function getItem(cartItemId) {
    return _items.find(i => i.cartItemId === cartItemId);
  }

  /**
   * Calculate total count (sum of quantities)
   */
  function count() {
    return _items.reduce((sum, item) => sum + item.quantity, 0);
  }

  /**
   * Calculate grand total (sum of all totalPrice)
   */
  function total() {
    return _items.reduce((sum, item) => sum + item.totalPrice, 0);
  }

  /**
   * Get order payload for API submission
   * Format: [{menuItemId, variant?, customizations?, quantity, specialNote}]
   */
  function getOrderPayload() {
    return _items.map(item => ({
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      variant: item.variant ? { id: item.variant.id, name: item.variant.name } : null,
      customizations: item.customizations.map(group => ({
        groupId: group.groupId,
        selections: group.selections.map(sel => ({
          optionId: sel.optionId,
          optionName: sel.optionName,
          priceModifier: sel.priceModifier
        }))
      })),
      specialNote: item.specialNote
    }));
  }

  /**
   * Get summary for display
   */
  function getSummary() {
    return {
      itemCount: count(),
      lineItems: _items.length,
      subtotal: total(),
      tax: 0,  // Will be calculated at checkout
      total: total()
    };
  }

  // ── Migration from old cart (for backwards compatibility) ──
  function migrateFromSimpleCart(simpleItems) {
    _items = Object.entries(simpleItems).map(([menuItemId, quantity]) => {
      return {
        cartItemId: _generateCartItemId(),
        menuItemId: menuItemId,
        name: `Item ${menuItemId}`,
        quantity: quantity,
        variant: null,
        customizations: [],
        specialNote: '',
        basePrice: 0,
        customizationTotal: 0,
        totalPrice: 0
      };
    });
    _notify();
  }

  return {
    subscribe,
    add,
    updateQuantity,
    remove,
    clear,
    items,
    getItem,
    count,
    total,
    getOrderPayload,
    getSummary,
    migrateFromSimpleCart
  };

})();
