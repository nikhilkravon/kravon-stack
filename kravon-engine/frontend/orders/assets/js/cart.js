/* ═══════════════════════════════════════════════════════════
   CART.JS — Pure cart state. Zero DOM access.
   Depends on: config/config.js (CONFIG)
   ═══════════════════════════════════════════════════════════ */
const Cart = (() => {

  /* ── Private state ── */
  let _items = [];  // [{ id, name, price, qty, note }]

  /* ── Derived CONFIG values used in calculations ── */
  const _cfg = {
    minOrder:         CONFIG.order.minOrder,
    freeDeliveryAt:   CONFIG.orders.freeDeliveryAt,
    deliveryStandard: CONFIG.orders.deliveryStandard,
    deliveryExpress:  CONFIG.orders.deliveryExpress,
    gstRate:          CONFIG.orders.gstRate,
  };

  /* ── Current delivery fee (updated by checkout module) ── */
  let _deliveryFee = _cfg.deliveryStandard;

  /* ── Price calculations ── */
  function calcSubtotal() {
    return _items.reduce((sum, i) => sum + i.price * i.qty, 0);
  }

  function calcTax(sub) {
    return Math.round(sub * _cfg.gstRate);
  }

  function calcDelivery(sub) {
    return sub >= _cfg.freeDeliveryAt ? 0 : _deliveryFee;
  }

  function calcTotal(sub, tax, del) {
    return sub + tax + del;
  }

  /* ── Currency formatter ── */
  function fmt(n) {
    return '₹' + n;
  }

  /* ── Mutation: add item ── */
  function addItem(id, name, price, note) {
    note = note || '';
    const existing = _items.find(i => i.id === String(id) && i.note === note);
    if (existing) {
      existing.qty += 1;
    } else {
      _items.push({ id: String(id), name, price, qty: 1, note });
    }
  }

  /* ── Mutation: change quantity at index ── */
  function changeQty(idx, delta) {
    if (!_items[idx]) return;
    _items[idx].qty += delta;
    if (_items[idx].qty <= 0) _items.splice(idx, 1);
  }

  /* ── Mutation: remove item at index ── */
  function removeItem(idx) {
    _items.splice(idx, 1);
  }

  /* ── Mutation: replace item at index (edit from modal) ── */
  function replaceItem(idx, entry) {
    if (!_items[idx]) return;
    _items[idx] = {
      id:    String(entry.id),
      name:  entry.name,
      price: entry.price,
      qty:   entry.qty,
      note:  entry.note || '',
    };
  }

  /* ── Mutation: upsert from modal (add or merge) ── */
  function upsertItem(id, name, price, qty, note) {
    note = note || '';
    const existing = _items.find(i => i.id === String(id) && i.note === note);
    if (existing) {
      existing.qty += qty;
    } else {
      _items.push({ id: String(id), name, price, qty, note });
    }
  }

  /* ── Mutation: set delivery fee ── */
  function setDeliveryFee(fee) {
    _deliveryFee = fee;
  }

  /* ── Mutation: reset everything ── */
  function clear() {
    _items = [];
    _deliveryFee = _cfg.deliveryStandard;
  }

  /* ── Read: snapshot of items (shallow copy to prevent mutation) ── */
  function getItems() {
    return _items.map(i => Object.assign({}, i));
  }

  /* ── Read: total qty across all entries for a given menu item id ── */
  function getQtyById(id) {
    return _items
      .filter(i => i.id === String(id))
      .reduce((s, i) => s + i.qty, 0);
  }

  /* ── Read: total item count ── */
  function getCount() {
    return _items.reduce((s, i) => s + i.qty, 0);
  }

  /* ── Read: full totals object ── */
  function getTotals() {
    const sub = calcSubtotal();
    const del = calcDelivery(sub);
    const tax = calcTax(sub);
    return {
      sub,
      del,
      tax,
      total: calcTotal(sub, tax, del),
      count: getCount(),
      freeDelivery: del === 0,
      belowMin: sub < _cfg.minOrder,
      toMin: Math.max(0, _cfg.minOrder - sub),
      toFreeDelivery: Math.max(0, _cfg.freeDeliveryAt - sub),
    };
  }

  /* ── Read: config values exposed to other modules ── */
  function getConfig() {
    return Object.assign({}, _cfg);
  }

  /* ── Formatter exposed ── */
  return {
    addItem,
    changeQty,
    removeItem,
    replaceItem,
    upsertItem,
    setDeliveryFee,
    clear,
    getItems,
    getCount,
    getQtyById,
    getTotals,
    getConfig,
    fmt,
  };

})();
