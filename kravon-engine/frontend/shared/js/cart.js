/* ═══════════════════════════════════════════════════════════
   KRAVON SHARED — CART.JS
   The single cart engine for all Kravon products.

   Usage:
     const c = KravonCart.create();
     c.init();           // reads delivery/GST from window.CONFIG.orders
     c.configure(cfg);   // direct config for Tables (no delivery) or custom setup

   Item shape: { cartItemId, id, name, price, qty, note }

   Products create one instance in their product cart.js:
     Orders  → Cart     = shim that calls c.init() after CONFIG loads
     Tables  → TablesCart = shim that calls c.configure({}) (no delivery)
     Presence → EnhancedCart = shim with API translation layer
   ═══════════════════════════════════════════════════════════ */

window.KravonCart = (() => {
  'use strict';

  function create() {
    let _items = [];
    let _cfg = {
      minOrder:         0,
      deliveryStandard: 0,
      deliveryExpress:  0,
      freeDeliveryAt:   Infinity,
      gstRate:          0,
    };
    let _deliveryFee = 0;
    const _subs = [];

    function _notify() {
      _subs.forEach(fn => fn());
    }

    function _genId() {
      return 'ci' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /* ── Configuration ────────────────────────────────────── */

    // Reads delivery + GST from window.CONFIG (Orders compat)
    function init() {
      const C = window.CONFIG || {};
      const O = C.orders || {};
      _cfg = {
        minOrder:         (C.order || {}).minOrder    || 0,
        deliveryStandard: O.deliveryStandard           || 0,
        deliveryExpress:  O.deliveryExpress            || 0,
        freeDeliveryAt:   O.freeDeliveryAt             || Infinity,
        gstRate:          O.gstRate                    || 0,
      };
      _deliveryFee = _cfg.deliveryStandard;
      _items = [];
    }

    // Direct config — used by Tables (no delivery) and Presence
    function configure(cfg) {
      _cfg = {
        minOrder:         cfg.minOrder         ?? 0,
        deliveryStandard: cfg.deliveryStandard  ?? 0,
        deliveryExpress:  cfg.deliveryExpress   ?? 0,
        freeDeliveryAt:   cfg.freeDeliveryAt    ?? Infinity,
        gstRate:          cfg.gstRate           ?? 0,
      };
      _deliveryFee = _cfg.deliveryStandard;
      _items = [];
    }

    /* ── Subscription ─────────────────────────────────────── */

    function subscribe(fn) {
      _subs.push(fn);
    }

    /* ── Mutations ────────────────────────────────────────── */

    function addItem(id, name, price, note) {
      note = note || '';
      const existing = _items.find(i => i.id === String(id) && i.note === note);
      if (existing) {
        existing.qty += 1;
      } else {
        _items.push({ cartItemId: _genId(), id: String(id), name, price, qty: 1, note });
      }
      _notify();
    }

    function upsertItem(id, name, price, qty, note) {
      note = note || '';
      const existing = _items.find(i => i.id === String(id) && i.note === note);
      if (existing) {
        existing.qty += qty;
      } else {
        _items.push({ cartItemId: _genId(), id: String(id), name, price, qty, note });
      }
      _notify();
    }

    function changeQty(idx, delta) {
      if (!_items[idx]) return;
      _items[idx].qty += delta;
      if (_items[idx].qty <= 0) _items.splice(idx, 1);
      _notify();
    }

    // Address a specific entry by its stable cartItemId (used by Presence drawer)
    function setQtyByCartItemId(cartItemId, newQty) {
      if (newQty <= 0) {
        _items = _items.filter(i => i.cartItemId !== cartItemId);
      } else {
        const item = _items.find(i => i.cartItemId === cartItemId);
        if (item) item.qty = newQty;
      }
      _notify();
    }

    function removeItem(idx) {
      _items.splice(idx, 1);
      _notify();
    }

    function replaceItem(idx, entry) {
      if (!_items[idx]) return;
      _items[idx] = {
        cartItemId: _items[idx].cartItemId,
        id:    String(entry.id),
        name:  entry.name,
        price: entry.price,
        qty:   entry.qty,
        note:  entry.note || '',
      };
      _notify();
    }

    function setDeliveryFee(fee) {
      _deliveryFee = fee;
    }

    function clear() {
      _items = [];
      _deliveryFee = _cfg.deliveryStandard;
      _notify();
    }

    /* ── Reads ────────────────────────────────────────────── */

    function getItems() {
      return _items.map(i => Object.assign({}, i));
    }

    function getItemByCartItemId(cartItemId) {
      const item = _items.find(i => i.cartItemId === cartItemId);
      return item ? Object.assign({}, item) : null;
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
      const sub = _items.reduce((s, i) => s + i.price * i.qty, 0);
      const del = sub >= _cfg.freeDeliveryAt ? 0 : _deliveryFee;
      const tax = Math.round(sub * _cfg.gstRate);
      return {
        sub,
        del,
        tax,
        total:          sub + del + tax,
        count:          getCount(),
        freeDelivery:   del === 0,
        belowMin:       sub < _cfg.minOrder,
        toMin:          Math.max(0, _cfg.minOrder - sub),
        toFreeDelivery: Math.max(0, _cfg.freeDeliveryAt - sub),
        freeDeliveryAt: _cfg.freeDeliveryAt,
      };
    }

    // Returns the raw config — consumed by Checkout to build delivery option UI
    function getConfig() {
      return Object.assign({}, _cfg);
    }

    function fmt(n) { return '₹' + n; }

    return {
      init,
      configure,
      subscribe,
      addItem,
      upsertItem,
      changeQty,
      setQtyByCartItemId,
      removeItem,
      replaceItem,
      setDeliveryFee,
      clear,
      getItems,
      getItemByCartItemId,
      getQtyById,
      getCount,
      getTotals,
      getConfig,
      fmt,
    };
  }

  return { create };

})();
