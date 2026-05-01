/**
 * CHECKOUT-BOOT — presence/checkout-boot.js
 * Initializes the checkout page after all scripts are loaded.
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof CheckoutPresence !== 'undefined') {
      CheckoutPresence.init();
    }
  });

})();
