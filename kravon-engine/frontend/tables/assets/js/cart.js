/* ═══════════════════════════════════════════════════════════
   TABLES — CART.JS
   Thin shim around the shared KravonCart engine.

   All logic lives in shared/js/cart.js.
   This file preserves the window.TablesCart API that Tables
   modules (renderer.js, modal.js, checkout.js, behaviour.js)
   depend on.

   Tables has no delivery fees and no GST — configure() sets
   these to zero rather than reading from window.CONFIG.
   ═══════════════════════════════════════════════════════════ */

const TablesCart = (() => {
  const c = KravonCart.create();

  function _storageKey(slug, sessionId) {
    return `kravon:table-cart:${slug}:${sessionId}`;
  }

  return {
    init() {
      // Tables: no delivery fee, no GST, no minimum order
      c.configure({
        minOrder:         0,
        deliveryStandard: 0,
        deliveryExpress:  0,
        freeDeliveryAt:   Infinity,
        gstRate:          0,
      });
    },

    /** Persist current cart to localStorage. Call after every mutation. */
    save(slug, sessionId) {
      if (!slug || !sessionId) return;
      try {
        localStorage.setItem(_storageKey(slug, sessionId), JSON.stringify(c.getItems()));
      } catch (_) {}
    },

    /** Restore cart from localStorage. Call once on boot after session is confirmed open. */
    restore(slug, sessionId) {
      if (!slug || !sessionId) return;
      try {
        const raw = localStorage.getItem(_storageKey(slug, sessionId));
        if (!raw) return;
        const items = JSON.parse(raw);
        if (!Array.isArray(items) || !items.length) return;
        c.clear();
        for (const item of items) {
          c.upsertItem(item.id, item.name, item.price, item.qty, item.note || null);
        }
      } catch (_) {}
    },

    /** Remove persisted cart for this session (order placed / session closed / paid). */
    clearPersisted(slug, sessionId) {
      if (!slug || !sessionId) return;
      try { localStorage.removeItem(_storageKey(slug, sessionId)); } catch (_) {}
    },

    addItem(id, name, price, note)         { c.addItem(id, name, price, note); },
    upsertItem(id, name, price, qty, note) { c.upsertItem(id, name, price, qty, note); },
    replaceItem(idx, entry)                { c.replaceItem(idx, entry); },
    changeQty(idx, delta)                  { c.changeQty(idx, delta); },
    removeItem(idx)                        { c.removeItem(idx); },
    clear()                                { c.clear(); },
    getItems()                             { return c.getItems(); },
    getQtyById(id)                         { return c.getQtyById(id); },
    getCount()                             { return c.getCount(); },
    getTotals()                            { return c.getTotals(); },
    fmt(n)                                 { return c.fmt(n); },
  };
})();
