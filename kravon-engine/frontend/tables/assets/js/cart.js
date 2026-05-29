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
    addItem(id, name, price, note)       { c.addItem(id, name, price, note); },
    upsertItem(id, name, price, qty, note) { c.upsertItem(id, name, price, qty, note); },
    replaceItem(idx, entry)              { c.replaceItem(idx, entry); },
    changeQty(idx, delta)                { c.changeQty(idx, delta); },
    removeItem(idx)                      { c.removeItem(idx); },
    clear()                              { c.clear(); },
    getItems()                           { return c.getItems(); },
    getQtyById(id)                       { return c.getQtyById(id); },
    getCount()                           { return c.getCount(); },
    getTotals()                          { return c.getTotals(); },
    fmt(n)                               { return c.fmt(n); },
  };
})();
