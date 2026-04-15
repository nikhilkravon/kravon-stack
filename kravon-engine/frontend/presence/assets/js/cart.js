/* ═══════════════════════════════════════════════════════════
   PRESENCE — CART.JS
   Pure state module. No DOM. No side effects.
   Exposes a clean API consumed by behaviour.js.
   ═══════════════════════════════════════════════════════════ */

const Cart = (function () {
  'use strict';

  let _state = {};          // { itemId: qty }
  const _subs = [];

  function _notify() { _subs.forEach(fn => fn()); }

  function subscribe(fn) { _subs.push(fn); }

  function add(id) {
    _state[String(id)] = 1;
    _notify();
  }

  function change(id, delta) {
    const key  = String(id);
    const next = (_state[key] || 0) + delta;
    if (next <= 0) { delete _state[key]; }
    else           { _state[key] = next;  }
    _notify();
  }

  function qty(id)   { return _state[String(id)] || 0; }
  function count()   { return Object.values(_state).reduce((a, b) => a + b, 0); }
  function items()   { return { ..._state }; }

  function total() {
    return Object.entries(_state).reduce((sum, [id, q]) => {
      const item = window.MENU.find(m => String(m.id) === id);
      return sum + (item ? item.price * q : 0);
    }, 0);
  }

  return { subscribe, add, change, qty, count, total, items };

})();
