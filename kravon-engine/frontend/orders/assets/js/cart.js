/* ═══════════════════════════════════════════════════════════
   ORDERS — CART.JS
   Thin shim around the shared KravonCart engine.

   All logic lives in shared/js/cart.js.
   This file preserves the window.Cart API that Orders modules
   (ui.js, checkout.js, modal.js, behaviour.js) depend on.

   Cart.init() reads delivery + GST config from window.CONFIG
   after KravonAPI.loadConfig() resolves in boot.js.
   ═══════════════════════════════════════════════════════════ */

const Cart = (() => {
  const c = KravonCart.create();
  return {
    init()                               { c.init(); },
    addItem(id, name, price, note)       { c.addItem(id, name, price, note); },
    upsertItem(id, name, price, qty, note) { c.upsertItem(id, name, price, qty, note); },
    replaceItem(idx, entry)              { c.replaceItem(idx, entry); },
    changeQty(idx, delta)                { c.changeQty(idx, delta); },
    removeItem(idx)                      { c.removeItem(idx); },
    setDeliveryFee(fee)                  { c.setDeliveryFee(fee); },
    clear()                              { c.clear(); },
    getItems()                           { return c.getItems(); },
    getQtyById(id)                       { return c.getQtyById(id); },
    getCount()                           { return c.getCount(); },
    getTotals()                          { return c.getTotals(); },
    getConfig()                          { return c.getConfig(); },
    fmt(n)                               { return c.fmt(n); },
  };
})();
