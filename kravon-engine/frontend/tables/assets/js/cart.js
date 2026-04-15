/* ═══════════════════════════════════════════════════════════
   TABLES — CART.JS
   Pure cart state for the Tables product.
   No delivery fee. No GST. Subtotal is total.

   Mirrors Orders cart API so modal.js can be shared cleanly.
   ═══════════════════════════════════════════════════════════ */
const TablesCart = (() => {

  let _items = [];  // [{ id, name, price, qty, note }]

  function init() {
    _items = [];
  }

  /* ── Calculations ─── */
  function calcSubtotal() {
    return _items.reduce((sum, i) => sum + i.price * i.qty, 0);
  }

  function fmt(n) { return '₹' + n; }

  /* ── Mutations ─── */
  function addItem(id, name, price, note) {
    note = note || '';
    const existing = _items.find(i => i.id === String(id) && i.note === note);
    if (existing) {
      existing.qty += 1;
    } else {
      _items.push({ id: String(id), name, price, qty: 1, note });
    }
  }

  /* ── Upsert from modal (add qty N, or merge if same note) ── */
  function upsertItem(id, name, price, qty, note) {
    note = note || '';
    const existing = _items.find(i => i.id === String(id) && i.note === note);
    if (existing) {
      existing.qty += qty;
    } else {
      _items.push({ id: String(id), name, price, qty, note });
    }
  }

  /* ── Replace item at index (edit from cart drawer) ── */
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

  function changeQty(idx, delta) {
    if (!_items[idx]) return;
    _items[idx].qty += delta;
    if (_items[idx].qty <= 0) _items.splice(idx, 1);
  }

  function removeItem(idx) {
    _items.splice(idx, 1);
  }

  function clear() {
    _items = [];
  }

  /* ── Reads ─── */
  function getItems() {
    return _items.map(i => Object.assign({}, i));
  }

  function getQtyById(id) {
    return _items
      .filter(i => i.id === String(id))
      .reduce((s, i) => s + i.qty, 0);
  }

  function getCount() {
    return _items.reduce((s, i) => s + i.qty, 0);
  }

  function getTotals() {
    const sub = calcSubtotal();
    return {
      sub,
      total: sub,
      count: getCount(),
    };
  }

  return {
    init,
    addItem,
    upsertItem,
    replaceItem,
    changeQty,
    removeItem,
    clear,
    getItems,
    getCount,
    getQtyById,
    getTotals,
    fmt,
  };

})();
