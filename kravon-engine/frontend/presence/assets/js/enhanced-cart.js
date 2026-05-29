/* ═══════════════════════════════════════════════════════════
   PRESENCE — ENHANCED-CART.JS
   Compatibility shim — wraps the shared KravonCart engine
   behind the EnhancedCart API that presence/behaviour.js uses.

   External API (unchanged from before):
     EnhancedCart.subscribe(fn)
     EnhancedCart.add({ menuItemId, name, quantity, variant?,
                        customizations?, specialNote?, basePrice })
     EnhancedCart.updateQuantity(cartItemId, newQty)
     EnhancedCart.remove(cartItemId)
     EnhancedCart.clear()
     EnhancedCart.items()   → [{ cartItemId, menuItemId, name,
                                  quantity, basePrice, totalPrice,
                                  specialNote, variant, customizations }]
     EnhancedCart.getItem(cartItemId)
     EnhancedCart.count()
     EnhancedCart.total()

   Internal: delegates to KravonCart.create() (shared/js/cart.js).
   Presence has no delivery fee or GST — it is pure item total.
   ═══════════════════════════════════════════════════════════ */

const EnhancedCart = (() => {
  'use strict';

  const _cart = KravonCart.create();
  _cart.configure({
    minOrder:         0,
    deliveryStandard: 0,
    deliveryExpress:  0,
    freeDeliveryAt:   Infinity,
    gstRate:          0,
  });

  /* ── Shape translation ────────────────────────────────── */
  function _toEnhanced(item) {
    return {
      cartItemId:     item.cartItemId,
      menuItemId:     item.id,
      name:           item.name,
      quantity:       item.qty,
      basePrice:      item.price,
      totalPrice:     item.price * item.qty,
      specialNote:    item.note || '',
      variant:        null,
      customizations: [],
    };
  }

  /* ── Subscribe ────────────────────────────────────────── */
  function subscribe(fn) {
    _cart.subscribe(fn);
  }

  /* ── Add item ─────────────────────────────────────────── */
  function add(item) {
    const basePrice = (item.variant && item.variant.price != null)
      ? item.variant.price
      : (item.basePrice || 0);

    const custMod = (item.customizations || []).reduce((sum, group) =>
      sum + (group.selections || []).reduce((s, sel) => s + (sel.priceModifier || 0), 0), 0);

    const unitPrice = basePrice + custMod;
    const note      = item.specialNote || '';

    _cart.addItem(item.menuItemId, item.name, unitPrice, note);
  }

  /* ── Update quantity by stable cartItemId ─────────────── */
  function updateQuantity(cartItemId, newQty) {
    _cart.setQtyByCartItemId(cartItemId, newQty);
  }

  /* ── Remove by cartItemId ─────────────────────────────── */
  function remove(cartItemId) {
    _cart.setQtyByCartItemId(cartItemId, 0);
  }

  /* ── Clear ────────────────────────────────────────────── */
  function clear() {
    _cart.clear();
  }

  /* ── Read: all items in EnhancedCart shape ────────────── */
  function items() {
    return _cart.getItems().map(_toEnhanced);
  }

  /* ── Read: single item by cartItemId ──────────────────── */
  function getItem(cartItemId) {
    const item = _cart.getItemByCartItemId(cartItemId);
    return item ? _toEnhanced(item) : null;
  }

  /* ── Read: aggregates ─────────────────────────────────── */
  function count() {
    return _cart.getCount();
  }

  function total() {
    return _cart.getTotals().sub;
  }

  /* ── Order payload for API / WhatsApp checkout ─────────── */
  function getOrderPayload() {
    return _cart.getItems().map(item => ({
      menuItemId:     item.id,
      quantity:       item.qty,
      variant:        null,
      customizations: [],
      specialNote:    item.note || '',
    }));
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
  };

})();
